'use client';

import { useState, useRef, useEffect } from 'react';
import { MarkdownRenderer } from '../../app/MarkdownRenderer';

function downloadBlob(content, filename, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function ImageCard({ artifact }) {
    const [zoomed, setZoomed] = useState(false);
    const [loaded, setLoaded] = useState(false);
    return (
        <div className="rounded-xl border border-[#2a2a3e] bg-[#101018] overflow-hidden">
            <div className="relative bg-black/40 flex items-center justify-center min-h-[200px]">
                {!loaded && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#141420] to-[#0d0d15]" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={artifact.url}
                    alt={artifact.prompt || 'Generated image'}
                    onLoad={() => setLoaded(true)}
                    onClick={() => setZoomed(true)}
                    className={`max-h-96 w-auto cursor-zoom-in transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#2a2a3e] bg-[#0c0c14]">
                <span className="text-xs text-gray-500 font-mono">{artifact.provider} · {artifact.width}×{artifact.height}</span>
                <div className="flex gap-2">
                    <button onClick={() => setZoomed(true)} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 hover:text-white transition-colors">View</button>
                    <a href={artifact.url} download="image.png" target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors">Download</a>
                </div>
            </div>
            {zoomed && (
                <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-8 cursor-zoom-out" onClick={() => setZoomed(false)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={artifact.url} alt={artifact.prompt} className="max-w-full max-h-full object-contain" />
                </div>
            )}
        </div>
    );
}

export function AudioCard({ artifact }) {
    const [idx, setIdx] = useState(0);
    const segments = artifact.segments || [];
    const current = segments[idx];
    if (!current) return null;
    return (
        <div className="rounded-xl border border-[#2a2a3e] bg-[#101018] p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 font-mono">{artifact.provider} · voice: {artifact.voice}{segments.length > 1 ? ` · part ${idx + 1}/${segments.length}` : ''}</span>
                <a href={current.url} download={`audio-${idx + 1}.mp3`} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors">Download MP3</a>
            </div>
            <audio controls src={current.url} onEnded={() => { if (idx + 1 < segments.length) setIdx(idx + 1); }} className="w-full h-10" />
            {segments.length > 1 && (
                <div className="flex gap-1.5 flex-wrap">
                    {segments.map((_, i) => (
                        <button key={i} onClick={() => setIdx(i)} className={`w-7 h-7 rounded-lg text-xs ${i === idx ? 'bg-indigo-600 text-white' : 'bg-[#1a1a2e] text-gray-400 hover:bg-[#2a2a3e]'}`}>{i + 1}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function WebCard({ artifact, onOpenWorkspace }) {
    const consoleHook = `<script>(function(){var send=function(level,args){try{parent.postMessage({__wbConsole:true,level:level,message:Array.from(args).map(function(a){try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(' ')},'*')}catch(e){}};['log','warn','error','info'].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);o.apply(console,arguments)}});window.addEventListener('error',function(e){send('error',[e.message+' ('+ (e.filename||'inline')+':'+e.lineno+')'])});})();<\/script>`;
    const html = artifact.html.includes('<head>') ? artifact.html.replace('<head>', '<head>' + consoleHook) : consoleHook + artifact.html;
    const sizeKb = Math.round(new Blob([artifact.html]).size / 1024);
    return (
        <div className="rounded-xl border border-[#2a2a3e] bg-[#101018] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2a3e] bg-[#0c0c14]">
                <span className="text-sm text-gray-300 truncate">{artifact.name}</span>
                <span className="text-xs text-gray-500 font-mono ml-2 whitespace-nowrap">{sizeKb} KB</span>
            </div>
            <iframe
                title={artifact.name}
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                srcDoc={html}
                className="w-full h-96 bg-white"
            />
            <div className="flex gap-2 px-4 py-2.5 border-t border-[#2a2a3e] bg-[#0c0c14]">
                <button onClick={() => onOpenWorkspace?.(artifact)} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 hover:text-white transition-colors">Open Workspace</button>
                <button onClick={() => downloadBlob(artifact.html, `${artifact.name.replace(/[^a-z0-9-_ ]/gi, '_')}.html`, 'text/html')} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors">Download HTML</button>
                {onSaveLocal && <button onClick={() => onSaveLocal(artifact)} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700/70 hover:bg-emerald-600 text-white transition-colors">Save to Laptop</button>}
                <button onClick={() => navigator.clipboard.writeText(artifact.html)} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 hover:text-white transition-colors">Copy Source</button>
            </div>
        </div>
    );
}

export function CodeCard({ artifact, onOpenWorkspace, onSaveLocal }) {
    const [activeFile, setActiveFile] = useState(0);
    const file = artifact.files[activeFile];
    return (
        <div className="rounded-xl border border-[#2a2a3e] bg-[#101018] overflow-hidden">
            <div className="flex overflow-x-auto border-b border-[#2a2a3e] bg-[#0c0c14]">
                {artifact.files.map((f, i) => (
                    <button key={i} onClick={() => setActiveFile(i)} className={`px-4 py-2 text-xs whitespace-nowrap border-r border-[#2a2a3e] font-mono ${i === activeFile ? 'bg-[#141420] text-white' : 'text-gray-500 hover:text-gray-300'}`}>{f.name}</button>
                ))}
            </div>
            <pre className="p-4 text-xs leading-relaxed text-gray-300 overflow-x-auto max-h-72 font-mono"><code>{file.content}</code></pre>
            <div className="flex gap-2 px-4 py-2.5 border-t border-[#2a2a3e] bg-[#0c0c14] items-center flex-wrap">
                <button onClick={() => onOpenWorkspace?.(artifact)} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 hover:text-white transition-colors">Open in IDE</button>
                <button onClick={() => downloadBlob(file.content, file.name)} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors">Download File</button>
                {onSaveLocal && <button onClick={() => onSaveLocal(artifact)} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700/70 hover:bg-emerald-600 text-white transition-colors">Save to Laptop</button>}
                <button onClick={() => navigator.clipboard.writeText(file.content)} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 hover:text-white transition-colors">Copy</button>
                <span className="ml-auto text-[11px] text-gray-600">{artifact.files.length} files</span>
            </div>
        </div>
    );
}

const STEP_ICONS = { done: '\u2713', active: '\u25CF', pending: '\u25CB', failed: '\u2717' };
const STEP_COLORS = { done: 'text-emerald-400', active: 'text-indigo-400 animate-pulse', pending: 'text-gray-600', failed: 'text-red-400' };

export function DocumentCard({ artifact, onOpenEditor }) {
    const totalSections = artifact.sections.length;
    const written = artifact.sections.filter(s => s.content).length;
    return (
        <div className="rounded-xl border border-[#2a2a3e] bg-[#101018] p-4">
            <h4 className="font-medium text-white mb-1">{artifact.title}</h4>
            {artifact.description && <p className="text-xs text-gray-500 mb-3">{artifact.description}</p>}
            <div className="space-y-1 mb-3 max-h-44 overflow-y-auto">
                {artifact.sections.slice(0, 12).map((s) => (
                    <div key={s.index} className="flex items-center gap-2 text-xs text-gray-400">
                        <span className={STEP_COLORS[s.status === 'written' ? 'done' : s.generation === 'active' ? 'active' : 'pending']}>{STEP_ICONS[s.status === 'written' ? 'done' : s.generation === 'active' ? 'active' : 'pending']}</span>
                        <span>{s.index + 1}. {s.title}</span>
                    </div>
                ))}
                {totalSections > 12 && <p className="text-xs text-gray-600 pl-6">+{totalSections - 12} more sections</p>}
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{written}/{totalSections} sections written</span>
                <button onClick={() => onOpenEditor?.(artifact)} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors">Open Editor</button>
            </div>
        </div>
    );
}

export function StoryboardCard({ artifact, onOpenStudio }) {
    const [thumbs, setThumbs] = useState({});
    useEffect(() => {
        let cancelled = false;
        artifact.scenes.forEach((scene) => {
            if (!scene.imagePrompt) return;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { if (!cancelled) setThumbs((t) => ({ ...t, [scene.index]: img.src })); };
            img.onerror = () => { };
            import('../../lib/providers-client').then(({ imageUrl }) => {
                img.src = imageUrl(scene.imagePrompt, artifact.aspect || '16:9', scene.index * 7919);
            });
        });
        return () => { cancelled = true; };
    }, [artifact]);
    return (
        <div className="rounded-xl border border-[#2a2a3e] bg-[#101018] p-4">
            <h4 className="font-medium text-white mb-3">{artifact.title}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                {artifact.scenes.map((scene) => (
                    <div key={scene.index} className="rounded-lg overflow-hidden border border-[#2a2a3e] bg-black/40 aspect-video relative">
                        {thumbs[scene.index]
                            ? // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbs[scene.index]} alt={scene.caption} className="w-full h-full object-cover" />
                            : <div className="w-full h-full animate-pulse bg-gradient-to-br from-[#141420] to-[#0d0d15]" />}
                        <span className="absolute top-1 left-1 text-[10px] bg-black/70 px-1.5 rounded text-gray-300">{scene.index + 1} · {scene.durationSec}s</span>
                    </div>
                ))}
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{artifact.scenes.length} scenes · {artifact.aspect}</span>
                <button onClick={() => onOpenStudio?.(artifact)} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors">Render Video</button>
            </div>
        </div>
    );
}
