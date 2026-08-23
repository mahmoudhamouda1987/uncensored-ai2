'use client';

import { useState, useEffect, useRef } from 'react';
import { createTask, setStepState, completeTask, failTask } from '../../lib/tasks';
import { put, get } from '../../lib/localdb';

export function DocumentEditor({ doc, onUpdated }) {
    const [sections, setSections] = useState(doc.sections || []);
    const [activeIdx, setActiveIdx] = useState(0);
    const [generating, setGenerating] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [savedAt, setSavedAt] = useState(null);
    const cancelRef = useRef(false);

    useEffect(() => {
        setSections(doc.sections || []);
    }, [doc]);

    async function persist(updated) {
        const record = { ...doc, sections: updated, updatedAt: Date.now() };
        await put('artifacts', { id: doc.id, kind: 'document', title: record.title, description: record.description, prompt: doc.prompt, sections: updated, createdAt: doc.createdAt || Date.now(), updatedAt: record.updatedAt });
        setSavedAt(new Date().toLocaleTimeString());
        onUpdated?.(record);
    }

    async function generateAll() {
        if (generating) return;
        cancelRef.current = false;
        setGenerating(true);
        const taskId = createTask({
            title: `Writing "${doc.title}"`,
            steps: sections.map((s) => s.title),
        });
        let working = [...sections];

        for (let i = 0; i < working.length; i++) {
            if (cancelRef.current) break;
            if (working[i].content && working[i].content.length > 200) {
                setStepState(taskId, working[i].title, 'done');
                continue;
            }
            setStepState(taskId, working[i].title, 'active');
            setStatusText(`Writing section ${i + 1}/${working.length}: ${working[i].title}`);
            setActiveIdx(i);
            setSections(working.map((s, j) => (j === i ? { ...s, generation: 'active' } : s)));

            try {
                const res = await fetch('/api/document/section', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: doc.title, description: doc.description, sections: working, index: i }),
                });
                if (!res.ok) throw new Error(await res.text());
                const data = await res.json();
                working = working.map((s, j) => (j === i ? {
                    ...s,
                    content: data.content,
                    status: data.completeness?.meetsTarget ? 'written' : 'written-short',
                    generation: undefined,
                } : s));
                setStepState(taskId, working[i].title, 'done');
                setSections([...working]);
                await persist(working);
            } catch (e) {
                setStepState(taskId, working[i].title, 'failed');
                setStatusText(`Section ${i + 1} failed: ${String(e.message).slice(0, 120)}. Retrying once...`);
                try {
                    const retry = await fetch('/api/document/section', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: doc.title, description: doc.description, sections: working, index: i }),
                    });
                    if (!retry.ok) throw new Error(await retry.text());
                    const data2 = await retry.json();
                    working = working.map((s, j) => (j === i ? { ...s, content: data2.content, status: 'written', generation: undefined } : s));
                    setStepState(taskId, working[i].title, 'done');
                    setSections([...working]);
                    await persist(working);
                } catch {
                    failTask(taskId, `Failed at section ${i + 1}`);
                    setGenerating(false);
                    return;
                }
            }
        }

        completeTask(taskId);
        setStatusText('');
        setGenerating(false);
    }

    function exportMarkdown() {
        const md = [
            `# ${doc.title}`,
            doc.description ? `_${doc.description}_` : '',
            '',
            ...sections.flatMap((s) => [s.content || `## ${s.index + 1}. ${s.title}\n\n_(not yet written)_`, '']),
        ].join('\n');
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${doc.title.replace(/[^a-z0-9-_ ]/gi, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function updateActiveContent(value) {
        const next = sections.map((s, i) => (i === activeIdx ? { ...s, content: value } : s));
        setSections(next);
        clearTimeout(updateActiveContent._t);
        updateActiveContent._t = setTimeout(() => persist(next), 800);
    }

    const active = sections[activeIdx];
    const writtenCount = sections.filter((s) => s.content).length;

    return (
        <div className="flex h-full">
            <div className="w-64 border-r border-[#2a2a3e]/60 flex flex-col bg-[#0c0c12]">
                <div className="px-4 py-3 border-b border-[#2a2a3e]/60">
                    <h3 className="text-sm font-medium text-white truncate">{doc.title}</h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">{writtenCount}/{sections.length} sections · {savedAt ? `saved ${savedAt}` : 'autosaves'}</p>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                    {sections.map((s, i) => (
                        <button
                            key={s.index}
                            onClick={() => setActiveIdx(i)}
                            className={`w-full text-left px-4 py-2 text-xs flex items-start gap-2 transition-colors ${i === activeIdx ? 'bg-[#141420] text-white' : 'text-gray-400 hover:bg-[#10101a] hover:text-gray-200'}`}
                        >
                            <span className={`mt-0.5 ${s.content ? 'text-emerald-400' : s.generation === 'active' ? 'text-indigo-400 animate-pulse' : 'text-gray-600'}`}>{s.content ? '\u2713' : s.generation === 'active' ? '\u25CF' : '\u25CB'}</span>
                            <span className="flex-1">{s.index + 1}. {s.title}</span>
                        </button>
                    ))}
                </div>
                <div className="p-3 space-y-2 border-t border-[#2a2a3e]/60">
                    <button
                        onClick={generateAll}
                        disabled={generating}
                        className="w-full py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-all"
                    >
                        {generating ? 'Writing...' : writtenCount === sections.length ? 'Rewrite Missing' : `Write All ${sections.length} Sections`}
                    </button>
                    {generating && statusText && <p className="text-[10px] text-indigo-300 leading-snug">{statusText}</p>}
                    <button onClick={exportMarkdown} className="w-full py-2 rounded-lg bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 text-xs transition-colors">Export Markdown</button>
                    {generating && <button onClick={() => { cancelRef.current = true; }} className="w-full py-2 rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-300 text-xs transition-colors">Pause</button>}
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0">
                {active ? (
                    <>
                        <div className="px-6 py-4 border-b border-[#2a2a3e]/60 bg-[#0c0c12]">
                            <h2 className="text-base font-medium text-white">{active.index + 1}. {active.title}</h2>
                            {active.objectives && <p className="text-xs text-gray-500 mt-1">{active.objectives}</p>}
                            {active.keyPoints.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {active.keyPoints.map((k, i) => (
                                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[#141420] border border-[#2a2a3e] text-gray-400">{k}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <textarea
                            value={active.content}
                            onChange={(e) => updateActiveContent(e.target.value)}
                            placeholder={active.generation === 'active' ? 'AI is writing this section...' : 'Section content will appear here — or type your own.'}
                            readOnly={active.generation === 'active'}
                            className="flex-1 w-full resize-none bg-transparent px-6 py-5 text-sm text-gray-200 leading-relaxed font-mono focus:outline-none placeholder-gray-700"
                        />
                        <div className="px-6 py-2 border-t border-[#2a2a3e]/60 flex items-center justify-between text-[11px] text-gray-600">
                            <span>{active.content ? `${active.content.trim().split(/\s+/).length} words` : 'empty'}</span>
                            <span>target ~{active.targetWords} words</span>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">No sections</div>
                )}
            </div>
        </div>
    );
}
