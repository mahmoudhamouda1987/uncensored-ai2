'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IoIosSend } from 'react-icons/io';
import { IoSettingsSharp, IoClose, IoAdd, IoFolderOpen, IoChatbubble, IoImage, IoMusicalNotes, IoVideocam, IoCodeSlash, IoGlobe, IoDocument, IoGrid, IoLink, IoListSharp, IoNotifications, IoSearch } from 'react-icons/io5';
import { MarkdownRenderer } from '../../app/MarkdownRenderer';
import { Turnstile } from '@marsidev/react-turnstile';
import { v4 as uuidv4 } from 'uuid';

import {
    createProject, createConversation, saveMessage, loadMessages,
    getAll, getByIndex, put as dbPut, get as dbGet, remove as dbRemove, estimateUsage, uid,
} from '../../lib/localdb';
import { subscribeTasks, getTasks } from '../../lib/tasks';
import { streamWithAutoContinue } from '../../lib/autocontinue';
import { writeDocumentSections } from '../../lib/docpipeline';
import { ImageCard, AudioCard, WebCard, CodeCard, DocumentCard, StoryboardCard } from './ArtifactCards';
import { VideoStudio } from './VideoStudio';
import { DocumentEditor } from './DocumentEditor';
import { CodeWorkspace, WebPreviewWorkspace } from './CodeWorkspace';
import { Connections } from './Connections';

const MODES = [
    { id: 'auto', label: 'Ask', icon: IoChatbubble },
    { id: 'image', label: 'Image', icon: IoImage },
    { id: 'audio', label: 'Audio', icon: IoMusicalNotes },
    { id: 'video', label: 'Video', icon: IoVideocam },
    { id: 'code', label: 'Code', icon: IoCodeSlash },
    { id: 'web', label: 'Web', icon: IoGlobe },
    { id: 'document', label: 'Doc', icon: IoDocument },
];

const TEXT_EXTRACTABLE = /\.(txt|md|markdown|csv|json|xml|html|css|js|jsx|ts|tsx|py|java|c|cpp|h|rs|go|rb|php|sh|yml|yaml|toml|ini|sql)$/i;

export default function Workbench({ needsVerification, isVerified, turnstileToken, turnstileRef }) {
    const [projects, setProjects] = useState([]);
    const [activeProjectId, setActiveProjectId] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [activeConversationId, setActiveConversationId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [mode, setMode] = useState('auto');
    const [isResponding, setIsResponding] = useState(false);
    const [attachments, setAttachments] = useState([]);
    const [view, setView] = useState('chat');
    const [activeArtifact, setActiveArtifact] = useState(null);
    const [artifacts, setArtifacts] = useState([]);
    const [studioStoryboard, setStudioStoryboard] = useState(null);
    const [showPalette, setShowPalette] = useState(false);
    const [showTasks, setShowTasks] = useState(false);
    const [tasks, setTasks] = useState(getTasks());
    const [notifications, setNotifications] = useState([]);
    const [usage, setUsage] = useState(null);
    const [sidebarGroup, setSidebarGroup] = useState('workspace');
    const chatEndRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => subscribeTasks(setTasks), []);

    useEffect(() => {
        (async () => {
            let projs = await getAll('projects');
            if (projs.length === 0) {
                const p = await createProject({ name: 'Personal Workspace' });
                projs = [p];
            }
            setProjects(projs);
            setActiveProjectId(projs[0].id);
        })();
    }, []);

    useEffect(() => {
        if (!activeProjectId) return;
        (async () => {
            await refreshConversations();
            await refreshArtifacts();
        })();
    }, [activeProjectId]);

    async function refreshConversations() {
        let convs = await getAll('conversations');
        convs = convs.filter((c) => !c.projectId || c.projectId === activeProjectId).sort((a, b) => b.updatedAt - a.updatedAt);
        setConversations(convs);
        if (convs.length > 0) openConversation(convs[0].id);
    }

    async function refreshArtifacts() {
        const all = await getByIndex('artifacts', 'projectId', activeProjectId);
        setArtifacts(all.sort((a, b) => b.createdAt - a.createdAt));
    }

    async function openConversation(id) {
        setActiveConversationId(id);
        const msgs = await loadMessages(id);
        setMessages(msgs.map((m) => ({ ...m, type: m.role === 'user' ? 'user' : 'ai' })));
    }

    async function newConversation() {
        const conv = await createConversation(activeProjectId);
        setConversations((prev) => [conv, ...prev]);
        setActiveConversationId(conv.id);
        setMessages([]);
        setView('chat');
    }

    function notify(text, kind = 'info', artifactId) {
        setNotifications((prev) => [{ id: uid(), text, kind, artifactId, at: Date.now() }, ...prev].slice(0, 20));
    }

    async function handleAttach(files) {
        for (const file of files.slice(0, 5)) {
            const record = { id: uid(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, projectId: activeProjectId };
            try {
                if (TEXT_EXTRACTABLE.test(file.name) || file.type.startsWith('text/')) {
                    record.text = (await file.text()).slice(0, 60000);
                } else if (file.type === 'application/pdf') {
                    try {
                        const pdfjs = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
                        pdfjs.GlobalWorkerOptions.workerSrc = '';
                        const buf = await file.arrayBuffer();
                        const doc = await pdfjs.getDocument({ data: buf }).promise;
                        let text = '';
                        for (let p = 1; p <= Math.min(40, doc.numPages); p++) {
                            const page = await doc.getPage(p);
                            const content = await page.getTextContent();
                            text += content.items.map((it) => it.str).join(' ') + '\n';
                        }
                        record.text = text.slice(0, 80000);
                        record.pdfPages = doc.numPages;
                    } catch {
                        record.extractError = true;
                    }
                } else if (file.type.startsWith('image/')) {
                    record.dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });
                } else if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
                    record.mediaUrl = URL.createObjectURL(file);
                }
            } catch { record.readError = true; }
            setAttachments((prev) => [...prev, record]);
        }
    }

    async function sendMessage(forcedText) {
        const text = (forcedText ?? input).trim();
        if (!text || isResponding) return;
        if (needsVerification && !isVerified) return;

        let convId = activeConversationId;
        if (!convId) {
            const conv = await createConversation(activeProjectId);
            setConversations((prev) => [conv, ...prev]);
            setActiveConversationId(conv.id);
            convId = conv.id;
        }

        let userContent = text;
        if (attachments.length > 0) {
            const notes = attachments.map((a) => `[attached: ${a.name}${a.pdfPages ? `, ${a.pdfPages} pages` : ''}${a.text ? ` — content included` : a.dataUrl ? ' — image (visual inspection unavailable)' : ''}]`).join('\n');
            const extracted = attachments.filter((a) => a.text).map((a) => `\n\n--- FILE: ${a.name} ---\n${a.text}`).join('');
            userContent = `${text}\n${notes}${extracted}`;
        }

        const userMsg = { id: uid(), role: 'user', content: text, attachments: attachments.map(({ id, name, size, type }) => ({ id, name, size, type })) };
        setMessages((prev) => [...prev, { ...userMsg, type: 'user' }]);
        await saveMessage(convId, userMsg);
        setInput('');
        setAttachments([]);
        setIsResponding(true);
        setView('chat');

        const apiMessages = messages
            .concat([userMsg])
            .slice(-10)
            .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

        const aiMsgId = uid();
        setMessages((prev) => [...prev, { id: aiMsgId, role: 'assistant', content: '', artifacts: [], streaming: true }]);

        try {
            const result = await streamWithAutoContinue({
                endpoint: '/api/generate',
                body: {
                    messages: apiMessages,
                    mode,
                    userId: localStorage.getItem('userId') || 'anon',
                    turnstileToken: turnstileToken || undefined,
                },
                onToken: (token, json) => {
                    if (json && json.artifacts !== undefined) {
                        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, content: json.assistantText || '', artifacts: json.artifacts || [], error: !!json.error, streaming: false } : m)));
                        return;
                    }
                    if (token === '__CONTINUE_ROUND__') return;
                    setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, content: (m.content + token).replace(/\u2402CONTINUE\u2402/g, ''), streaming: true } : m)));
                },
            });

            let finalArtifacts = [];
            let finalContent = '';
            if (result.json) {
                finalArtifacts = result.json.artifacts || [];
                finalContent = result.json.assistantText || '';
            } else {
                finalContent = result.text;
            }

            for (const art of finalArtifacts) {
                await dbPut('artifacts', { ...art, id: art.id || uid(), projectId: activeProjectId, createdAt: Date.now() });
            }

            const contextNote = finalArtifacts
                .map((a) => {
                    if (a.kind === 'image') return `[created image via ${a.provider}: "${a.prompt}" ${a.width}x${a.height}]`;
                    if (a.kind === 'document') return `[created document "${a.title}" with ${a.sections.length} sections]`;
                    if (a.kind === 'code') return `[created code project with files: ${(a.files || []).map((f) => f.name).join(', ')}]`;
                    if (a.kind === 'web') return `[created web app "${a.name}"]`;
                    if (a.kind === 'video-storyboard') return `[created video storyboard "${a.title}" with ${a.scenes.length} scenes]`;
                    return '';
                })
                .filter(Boolean)
                .join('\n');

            const aiRecord = {
                id: aiMsgId,
                role: 'assistant',
                content: finalContent + (contextNote ? `\n\n${contextNote}` : ''),
                artifacts: finalArtifacts,
            };
            await saveMessage(convId, aiRecord);
            setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...aiRecord, type: 'ai', streaming: false } : m)));

            for (const art of finalArtifacts) {
                const savedArt = { ...art, projectId: activeProjectId, createdAt: Date.now() };
                setArtifacts((prev) => [savedArt, ...prev]);
                if (art.kind === 'document') {
                    notify(`"${art.title}" outline ready — writing ${art.sections.length} sections...`, 'info', art.id);
                    const res2 = await writeDocumentSections(savedArt, { notify });
                    await dbPut('artifacts', { ...savedArt, sections: res2.sections, updatedAt: Date.now() });
                    setArtifacts((prev) => prev.map((x) => (x.id === art.id ? { ...x, sections: res2.sections } : x)));
                    setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? { ...m, artifacts: m.artifacts.map((a) => (a.id === art.id ? { ...a, sections: res2.sections } : a)) } : m)));
                    if (res2.failure) notify(res2.failure, 'error');
                    else notify(`"${art.title}" complete — all ${res2.sections.length} sections written`, 'success');
                    setView('documents');
                    setActiveArtifact(art.id);
                }
            }
        } catch (e) {
            const friendly = String(e.message || '').includes('too fast')
                ? "Slow down! You're sending messages too fast."
                : String(e.message || '').includes('daily limit')
                    ? "You've hit your daily limit."
                    : e.status === 403
                        ? 'Security check failed. Please wait and retry.'
                        : 'Something went wrong while generating. Please try again.';
            const errRecord = { id: uid(), role: 'assistant', content: friendly };
            await saveMessage(convId, errRecord);
            setMessages((prev) => [...prev, { ...errRecord, type: 'ai' }]);
        } finally {
            setIsResponding(false);
        }
    }

    useEffect(() => {
        requestAnimationFrame(() => chatEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' }));
    }, [messages]);

    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setShowPalette((v) => !v);
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                setShowTasks((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    async function createNewProject() {
        const name = prompt('Project name:');
        if (!name?.trim()) return;
        const p = await createProject({ name: name.trim() });
        setProjects((prev) => [...prev, p]);
        setActiveProjectId(p.id);
    }

    const activeArtifactObj = artifacts.find((a) => a.id === activeArtifact);

    const sidebarItems = {
        workspace: [
            { label: 'Chat', view: 'chat', icon: IoChatbubble, action: newConversation },
            { label: 'Documents', view: 'documents', icon: IoDocument },
            { label: 'Images', view: 'images', icon: IoImage },
            { label: 'Library', view: 'library', icon: IoGrid },
        ],
        developer: [
            { label: 'Connections', view: 'connections', icon: IoLink },
        ],
        management: [
            { label: 'Tasks', view: null, icon: IoListSharp, action: () => setShowTasks(true) },
        ],
    };

    return (
        <div className="flex flex-col h-[100dvh] bg-[#08080c] text-white overflow-hidden">
            {/* ── TOP BAR ── */}
            <header className="h-12 flex items-center gap-3 px-4 border-b border-[#1f2733] bg-[#0a0a10] flex-shrink-0 z-30">
                <span className="font-bold text-sm tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Uncensored AI Studio</span>
                <button onClick={createNewProject} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-[#141420] hover:bg-[#1e1e30] border border-[#2a2a3e] text-gray-300 transition-colors">
                    <IoAdd size={12} /> Project
                </button>
                <select
                    value={activeProjectId || ''}
                    onChange={(e) => setActiveProjectId(e.target.value)}
                    className="text-[11px] bg-[#141420] border border-[#2a2a3e] rounded-md px-2 py-1 text-gray-300 focus:outline-none max-w-44"
                >
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => setShowPalette(true)} className="flex items-center gap-2 ml-auto text-[11px] px-3 py-1.5 rounded-lg bg-[#10101a] border border-[#2a2a3e] text-gray-500 hover:text-gray-300 transition-colors">
                    <IoSearch size={12} /> Search <kbd className="ml-2 px-1 rounded bg-[#1a1a2e] text-[9px]">Ctrl K</kbd>
                </button>
                <button onClick={() => setShowTasks(true)} className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#141420] text-gray-400 transition-colors" title="Tasks (Ctrl+J)">
                    <IoNotifications size={15} />
                    {tasks.some((t) => t.status === 'running') && <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />}
                </button>
                <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#141420] text-gray-400 hover:text-white transition-colors" title="Settings">
                    <IoSettingsSharp size={15} />
                </button>
            </header>

            <div className="flex flex-1 min-h-0">
                {/* ── LEFT SIDEBAR ── */}
                <aside className="w-52 border-r border-[#1f2733] bg-[#0a0a10] flex-shrink-0 hidden md:flex flex-col">
                    <nav className="flex-1 overflow-y-auto py-2">
                        {Object.entries(sidebarItems).map(([group, items]) => (
                            <div key={group} className="mb-3">
                                <p className="px-4 py-1 text-[9px] uppercase tracking-widest text-gray-600">{group}</p>
                                {items.map((item) => (
                                    <button
                                        key={item.label}
                                        onClick={() => (item.action ? item.action() : (setView(item.view), setActiveArtifact(item.view === 'chat' ? null : activeArtifact)))}
                                        className={`w-full flex items-center gap-2.5 px-4 py-2 text-xs transition-colors ${view === item.view ? 'bg-[#141420] text-white border-r-2 border-indigo-500' : 'text-gray-400 hover:bg-[#10101a] hover:text-gray-200'}`}
                                    >
                                        <item.icon size={14} />
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        ))}
                        <div className="mb-2">
                            <p className="px-4 py-1 text-[9px] uppercase tracking-widest text-gray-600">History</p>
                            {conversations.slice(0, 12).map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => { openConversation(c.id); setView('chat'); }}
                                    className={`w-full text-left px-4 py-1.5 text-[11px] truncate transition-colors ${activeConversationId === c.id && view === 'chat' ? 'text-white bg-[#101018]' : 'text-gray-500 hover:text-gray-300'}`}
                                >
                                    {c.title}
                                </button>
                            ))}
                        </div>
                    </nav>
                    <div className="px-4 py-2 border-t border-[#1f2733]">
                        <p className="text-[9px] text-gray-600 leading-relaxed">Local-first workspace.<br />Data lives in this browser.</p>
                    </div>
                </aside>

                {/* ── MAIN WORKSPACE ── */}
                <main
                    className="flex-1 min-w-0 flex flex-col relative"
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); handleAttach(Array.from(e.dataTransfer.files)); }}
                >
                    {view === 'chat' && (
                        <>
                            <div className="flex-1 overflow-y-auto px-6 py-5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                <div className="max-w-3xl mx-auto space-y-5 pb-6">
                                    {messages.length === 0 && (
                                        <div className="text-center py-24 space-y-3">
                                            <h2 className="text-2xl font-semibold bg-gradient-to-b from-neutral-200 to-neutral-500 bg-clip-text text-transparent">What should we create?</h2>
                                            <p className="text-sm text-gray-500">Ask anything — or describe an image, audio clip, video, app or document to build.</p>
                                            <div className="flex flex-wrap justify-center gap-2 mt-6">
                                                {['A logo for my coffee shop', 'Narrate this paragraph as audio', 'A compound interest calculator web app', 'A 10-part guide to personal finance'].map((ex) => (
                                                    <button key={ex} onClick={() => { setInput(ex); }} className="text-xs px-3 py-1.5 rounded-full border border-[#2a2a3e] text-gray-400 hover:border-[#4a4a6e] hover:text-gray-200 transition-colors">{ex}</button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {messages.map((msg, idx) => (
                                        <div key={msg.id || idx} className={`flex w-full ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`leading-relaxed break-words ${msg.type === 'user'
                                                ? 'bg-gradient-to-r from-indigo-600/90 to-purple-600/90 text-white px-5 py-3 rounded-2xl rounded-tr-sm max-w-[85%]'
                                                : 'text-gray-200 flex-1 min-w-0 space-y-3'}`}>
                                                {msg.type === 'user' ? (
                                                    <>
                                                        <span className="whitespace-pre-wrap text-sm">{msg.content}</span>
                                                        {msg.attachments?.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-2">
                                                                {msg.attachments.map((a) => (
                                                                    <span key={a.id} className="text-[10px] px-2 py-0.5 rounded-full bg-black/25 text-indigo-100">{a.name}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        {msg.content && <MarkdownRenderer content={msg.content} />}
                                                        {msg.streaming && !msg.content && (
                                                            <div className="flex items-center gap-1.5 py-2">
                                                                {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                                                            </div>
                                                        )}
                                                        {(msg.artifacts || []).map((art) => renderArtifactCard(art))}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={chatEndRef} />
                                </div>
                            </div>

                            {/* composer */}
                            <div className="border-t border-[#1f2733] bg-[#0a0a10] px-6 py-3 flex-shrink-0">
                                {attachments.length > 0 && (
                                    <div className="max-w-3xl mx-auto mb-2 flex flex-wrap gap-1.5">
                                        {attachments.map((a) => (
                                            <span key={a.id} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-[#141420] border border-[#2a2a3e] text-gray-300">
                                                {a.name}
                                                <button onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}><IoClose size={11} /></button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="max-w-3xl mx-auto">
                                    <div className="flex gap-1.5 mb-2">
                                        {MODES.map((m) => (
                                            <button key={m.id} onClick={() => setMode(m.id)} className={`flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full border transition-all ${mode === m.id ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' : 'border-[#2a2a3e] text-gray-500 hover:border-[#4a4a6e] hover:text-gray-300'}`}>
                                                <m.icon size={11} />{m.label}
                                            </button>
                                        ))}
                                        <button onClick={() => fileInputRef.current?.click()} className="ml-auto text-[11px] px-2.5 py-1 rounded-full border border-dashed border-[#2a2a3e] text-gray-500 hover:border-[#4a4a6e] hover:text-gray-300 transition-colors">Attach</button>
                                        <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { handleAttach(Array.from(e.target.files)); e.target.value = ''; }} />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 flex items-center bg-[#101018] border border-[#2a2a3e] rounded-xl overflow-hidden focus-within:border-[#4a4a6e] transition-colors">
                                            <input
                                                type="text"
                                                placeholder={mode === 'auto' ? 'Describe what you want to create...' : `Create ${mode}...`}
                                                value={input}
                                                onChange={(e) => setInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                                                disabled={isResponding}
                                                className="flex-1 px-4 py-3 bg-transparent text-sm placeholder-gray-600 focus:outline-none"
                                            />
                                        </div>
                                        <button
                                            onClick={() => sendMessage()}
                                            disabled={isResponding || !input.trim()}
                                            className="w-11 h-11 flex items-center justify-center bg-gradient-to-tr from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-[#15151f] disabled:to-[#15151f] disabled:text-gray-700 rounded-full transition-all"
                                        >
                                            <IoIosSend size={18} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {needsVerification && !isVerified && (
                                <div className="pb-3 flex justify-center bg-[#0a0a10]">
                                    <Turnstile ref={turnstileRef} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} onSuccess={(t) => window.__setTurnstileToken?.(t)} options={{ theme: 'dark' }} />
                                </div>
                            )}
                        </>
                    )}

                    {view === 'documents' && (
                        activeArtifactObj?.kind === 'document'
                            ? <DocumentEditor doc={activeArtifactObj} onUpdated={(u) => setArtifacts((prev) => prev.map((a) => (a.id === u.id ? u : a)))} />
                            : <ArtifactListView kind="document" artifacts={artifacts} onOpen={(a) => setActiveArtifact(a.id)} emptyLabel="No documents yet. Ask the AI to write a guide, course or report." />
                    )}
                    {view === 'images' && (
                        <ArtifactListView kind="image" artifacts={artifacts} onOpen={(a) => setActiveArtifact(a.id)} grid emptyLabel="No images yet." >
                            {(a) => <ImageCard artifact={a} />}
                        </ArtifactListView>
                    )}
                    {view === 'library' && (
                        <ArtifactListView artifacts={artifacts} onOpen={(a) => setActiveArtifact(a.id)} grid emptyLabel="Nothing created yet in this project.">
                            {(a) => renderArtifactCard(a, true)}
                        </ArtifactListView>
                    )}
                    {view === 'connections' && <Connections notify={notify} />}
                    {(view === 'code' || view === 'web') && activeArtifactObj && (
                        activeArtifactObj.kind === 'code'
                            ? <CodeWorkspace artifact={activeArtifactObj} />
                            : <WebPreviewWorkspace artifact={activeArtifactObj} />
                    )}
                </main>

                {/* ── RIGHT PANEL ── */}
                <aside className="w-64 border-l border-[#1f2733] bg-[#0a0a10] flex-shrink-0 hidden lg:flex flex-col">
                    <div className="px-4 py-3 border-b border-[#1f2733]">
                        <p className="text-[10px] uppercase tracking-widest text-gray-600">Context</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                        {view === 'chat' && (
                            <>
                                <div className="rounded-lg border border-[#1f2733] bg-[#0c0c12] p-3">
                                    <p className="text-[11px] text-gray-500 leading-relaxed">
                                        Mode: <span className="text-indigo-300">{MODES.find((m) => m.id === mode)?.label}</span><br />
                                        The planner detects your intent automatically. Chips are shortcuts.
                                    </p>
                                </div>
                                <div className="rounded-lg border border-[#1f2733] bg-[#0c0c12] p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Recent Artifacts</p>
                                    {artifacts.length === 0 && <p className="text-[11px] text-gray-600">Nothing yet.</p>}
                                    {artifacts.slice(0, 8).map((a) => (
                                        <button key={a.id} onClick={() => openArtifactInView(a)} className="block w-full text-left text-[11px] text-gray-400 hover:text-white truncate py-0.5">
                                            <span className="text-indigo-400 mr-1">{a.kind}</span>{a.title || a.prompt?.slice(0, 32) || a.name}
                                        </button>
                                    ))}
                                </div>
                                <div className="rounded-lg border border-[#1f2733] bg-[#0c0c12] p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Privacy</p>
                                    <p className="text-[10px] text-gray-500 leading-relaxed">Conversations &amp; artifacts are stored locally (IndexedDB). Generation prompts are processed by the LLM provider.</p>
                                </div>
                            </>
                        )}
                        {view !== 'chat' && activeArtifactObj && (
                            <div className="rounded-lg border border-[#1f2733] bg-[#0c0c12] p-3 space-y-1.5">
                                <p className="text-[10px] uppercase tracking-wider text-gray-600">Properties</p>
                                <Property k="Type" v={activeArtifactObj.kind} />
                                {activeArtifactObj.width && <Property k="Dimensions" v={`${activeArtifactObj.width}×${activeArtifactObj.height}`} />}
                                {activeArtifactObj.provider && <Property k="Provider" v={activeArtifactObj.provider} />}
                                {activeArtifactObj.voice && <Property k="Voice" v={activeArtifactObj.voice} />}
                                {activeArtifactObj.source_prompt && <Property k="Prompt" v={String(activeArtifactObj.source_prompt || activeArtifactObj.prompt).slice(0, 120)} />}
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {/* ── STATUS / JOB BAR ── */}
            <footer className="h-7 flex items-center gap-4 px-4 border-t border-[#1f2733] bg-[#0a0a10] text-[10px] text-gray-500 flex-shrink-0">
                <span className={tasks.some((t) => t.status === 'running') ? 'text-indigo-400' : ''}>
                    {tasks.some((t) => t.status === 'running') ? `${tasks.filter((t) => t.status === 'running').length} task(s) running` : 'Idle'}
                </span>
                <button onClick={() => setShowTasks(true)} className="hover:text-gray-300">Task Center</button>
                <span className="ml-auto">{usage ? `Storage: ${(usage.usage / 1048576).toFixed(1)} MB used` : 'Local storage active'}</span>
            </footer>

            {/* Task drawer */}
            <AnimatePresence>
                {showTasks && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowTasks(false)} />
                        <motion.div initial={{ x: 320 }} animate={{ x: 0 }} exit={{ x: 320 }} transition={{ type: 'spring', bounce: 0, duration: 0.3 }} className="fixed top-0 right-0 bottom-0 z-50 w-80 bg-[#0c0c12] border-l border-[#2a2a3e] overflow-y-auto">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f2733] sticky top-0 bg-[#0c0c12]">
                                <h3 className="text-sm font-medium">Task Center</h3>
                                <button onClick={() => setShowTasks(false)} className="text-gray-500 hover:text-white"><IoClose size={16} /></button>
                            </div>
                            <div className="p-3 space-y-3">
                                {tasks.length === 0 && <p className="text-xs text-gray-600 p-2">No tasks yet.</p>}
                                {tasks.map((task) => (
                                    <div key={task.id} className="rounded-xl border border-[#1f2733] bg-[#101018] p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-200 truncate pr-2">{task.title}</span>
                                            <span className={`text-[10px] ${task.status === 'complete' ? 'text-emerald-400' : task.status === 'failed' ? 'text-red-400' : 'text-indigo-400'}`}>
                                                {task.status === 'running' ? `${task.progress}%` : task.status}
                                            </span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-[#1a1a2e] overflow-hidden">
                                            <div className={`h-full transition-all duration-300 ${task.status === 'failed' ? 'bg-red-500' : 'bg-gradient-to-r from-indigo-500 to-purple-500'}`} style={{ width: `${task.progress}%` }} />
                                        </div>
                                        <div className="space-y-0.5 max-h-36 overflow-y-auto">
                                            {task.steps.slice(0, 20).map((step, i) => (
                                                <p key={i} className={`text-[10px] flex items-center gap-1.5 ${step.state === 'done' ? 'text-emerald-400/80' : step.state === 'active' ? 'text-indigo-300 animate-pulse' : step.state === 'failed' ? 'text-red-400' : 'text-gray-600'}`}>
                                                    {step.state === 'done' ? '\u2713' : step.state === 'active' ? '\u25CF' : step.state === 'failed' ? '\u2717' : '\u25CB'} {step.label}
                                                </p>
                                            ))}
                                        </div>
                                        {task.failureMessage && <p className="text-[10px] text-red-400">{task.failureMessage}</p>}
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Notifications toast stack */}
            <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 space-y-2 pointer-events-none">
                <AnimatePresence>
                    {notifications.slice(0, 3).map((n) => (
                        <motion.div
                            key={n.id}
                            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                            onAnimationComplete={() => setTimeout(() => setNotifications((prev) => prev.filter((x) => x.id !== n.id)), 3500)}
                            className={`pointer-events-auto text-xs px-4 py-2.5 rounded-xl shadow-lg border backdrop-blur ${n.kind === 'error' ? 'bg-red-950/90 border-red-900 text-red-200' : n.kind === 'success' ? 'bg-emerald-950/90 border-emerald-900 text-emerald-200' : 'bg-[#12121c]/95 border-[#2a2a3e] text-gray-200'}`}
                        >
                            {n.text}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Command palette */}
            <AnimatePresence>
                {showPalette && <CommandPalette onClose={() => setShowPalette(false)} actions={paletteActions()} artifacts={artifacts} />}
            </AnimatePresence>

            {studioStoryboard && <VideoStudio storyboard={studioStoryboard} onClose={() => setStudioStoryboard(null)} />}

            <style jsx global>{`
                select option { background: #141420; }
            `}</style>
        </div>
    );

    function paletteActions() {
        return [
            { label: 'New Chat', run: newConversation },
            { label: 'Generate Image', run: () => { setMode('image'); setView('chat'); } },
            { label: 'Generate Audio', run: () => { setMode('audio'); setView('chat'); } },
            { label: 'Create Video', run: () => { setMode('video'); setView('chat'); } },
            { label: 'Write Document', run: () => { setMode('document'); setView('chat'); } },
            { label: 'Build Web App', run: () => { setMode('web'); setView('chat'); } },
            { label: 'Write Code', run: () => { setMode('code'); setView('chat'); } },
            { label: 'Connections', run: () => setView('connections') },
            { label: 'Task Center', run: () => setShowTasks(true) },
            { label: 'Artifact Library', run: () => setView('library') },
        ];
    }

    function openArtifactInView(a) {
        setActiveArtifact(a.id);
        if (a.kind === 'document') setView('documents');
        else if (a.kind === 'code') setView('code');
        else if (a.kind === 'web') setView('web');
        else setView('library');
    }

    function renderArtifactCard(art, compact = false) {
        if (!art) return null;
        switch (art.kind) {
            case 'image': return <ImageCard key={art.id || Math.random()} artifact={art} />;
            case 'audio': return <AudioCard key={art.id || Math.random()} artifact={art} />;
            case 'web': return <WebCard key={art.id || Math.random()} artifact={art} onOpenWorkspace={(a) => { setActiveArtifact(a.id); setArtifacts((prev) => prev.some((x) => x.id === a.id) ? prev : [a, ...prev]); setView('web'); }} />;
            case 'code': return <CodeCard key={art.id || Math.random()} artifact={art} onOpenWorkspace={(a) => { setActiveArtifact(a.id); setArtifacts((prev) => prev.some((x) => x.id === a.id) ? prev : [a, ...prev]); setView('code'); }} />;
            case 'document': return <DocumentCard key={art.id || Math.random()} artifact={art} onOpenEditor={(a) => { setActiveArtifact(a.id); setView('documents'); }} />;
            case 'video-storyboard': return <StoryboardCard key={art.id || Math.random()} artifact={art} onOpenStudio={(sb) => setStudioStoryboard(sb)} />;
            default: return compact ? null : null;
        }
    }
}

function Property({ k, v }) {
    return (
        <div className="flex justify-between gap-2 text-[11px]">
            <span className="text-gray-600 shrink-0">{k}</span>
            <span className="text-gray-300 text-right truncate" title={v}>{v}</span>
        </div>
    );
}

function ArtifactListView({ kind, artifacts, onOpen, grid, emptyLabel, children }) {
    const filtered = kind ? artifacts.filter((a) => a.kind === kind) : artifacts;
    if (filtered.length === 0) {
        return <div className="flex-1 flex items-center justify-center text-sm text-gray-600">{emptyLabel}</div>;
    }
    return (
        <div className="flex-1 overflow-y-auto p-5">
            <div className={grid ? 'grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-5xl' : 'max-w-3xl space-y-4'}>
                {filtered.map((a) => (
                    <div key={a.id} onClick={() => onOpen(a)} className="cursor-pointer">
                        {children ? children(a) : (
                            <div className="rounded-xl border border-[#2a2a3e] bg-[#101018] p-4 hover:border-[#4a4a6e] transition-colors">
                                <p className="text-sm text-white truncate">{a.title || a.name || a.prompt?.slice(0, 60)}</p>
                                <p className="text-[11px] text-gray-500 mt-1">{a.kind} · {new Date(a.createdAt || Date.now()).toLocaleString()}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function CommandPalette({ onClose, actions, artifacts }) {
    const [query, setQuery] = useState('');
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const results = useMemo(() => {
        const q = query.toLowerCase();
        return actions.filter((a) => a.label.toLowerCase().includes(q)).slice(0, 8);
    }, [actions, query]);

    return (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-start justify-center pt-28" onClick={onClose}>
            <div className="w-full max-w-lg bg-[#111118] border border-[#2a2a3e]/70 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && results[0]) { results[0].run(); onClose(); }
                        if (e.key === 'Escape') onClose();
                    }}
                    placeholder="Type a command..."
                    className="w-full px-5 py-4 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none border-b border-[#1f2733]"
                />
                <div className="py-2 max-h-72 overflow-y-auto">
                    {results.map((a) => (
                        <button key={a.label} onClick={() => { a.run(); onClose(); }} className="w-full text-left px-5 py-2.5 text-sm text-gray-300 hover:bg-[#1a1a2e] transition-colors">
                            {a.label}
                        </button>
                    ))}
                    {results.length === 0 && <p className="px-5 py-3 text-xs text-gray-600">No matching commands.</p>}
                </div>
                <div className="px-5 py-2 border-t border-[#1f2733] text-[10px] text-gray-600 flex gap-4">
                    <span>Ctrl+K toggle</span>
                    <span>Esc close</span>
                    <span>Ctrl+J tasks</span>
                </div>
            </div>
        </div>
    );
}
