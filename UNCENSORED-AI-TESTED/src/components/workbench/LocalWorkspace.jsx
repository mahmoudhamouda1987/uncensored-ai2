'use client';

import { useState, useEffect, useRef } from 'react';

function loadToken() {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('wb_agent_token') || '';
}

export function LocalWorkspace({ notify, onAgentChange }) {
    const [token, setToken] = useState(loadToken);
    const [draftToken, setDraftToken] = useState('');
    const [status, setStatus] = useState({ connected: false });
    const [folderDraft, setFolderDraft] = useState('');
    const [tree, setTree] = useState([]);
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState([]);
    const [running, setRunning] = useState(false);
    const outRef = useRef(null);

    async function call(path, body) {
        const res = await fetch(`http://127.0.0.1:7777${path}`, {
            method: body ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json', 'X-Agent-Token': token },
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `Agent error ${res.status}`);
        return data;
    }

    async function ping(t) {
        try {
            const res = await fetch('http://127.0.0.1:7777/ping', { headers: { 'X-Agent-Token': t } });
            const data = await res.json();
            if (data.ok) {
                setStatus({ connected: true, workspace: data.workspace, platform: data.platform });
                onAgentChange?.(true, t);
                if (data.workspace) refreshTree();
                return;
            }
        } catch { }
        setStatus({ connected: false });
        onAgentChange?.(false, null);
    }

    async function refreshTree() {
        try {
            const data = await call('/tree', {});
            setTree(data.tree);
        } catch (e) {
            notify?.(`Tree failed: ${e.message}`, 'error');
        }
    }

    useEffect(() => {
        ping(token);
        const iv = setInterval(() => ping(token), 8000);
        return () => clearInterval(iv);
    }, [token]);

    useEffect(() => { outRef.current?.scrollTo(0, outRef.current.scrollHeight); }, [output]);

    async function runCommand(cmd) {
        if (!cmd.trim() || running) return;
        setRunning(true);
        setOutput((o) => [...o, { kind: 'cmd', text: `$ ${cmd}` }]);
        try {
            const r = await call('/run', { command: cmd });
            const text = [r.stdout, r.stderr && `\n[stderr]\n${r.stderr}`, `\n[exit ${r.code}${r.timedOut ? ', timed out' : ''} in ${(r.durationMs / 1000).toFixed(1)}s]`].filter(Boolean).join('');
            setOutput((o) => [...o.slice(-200), { kind: r.code === 0 ? 'out' : 'err', text }]);
        } catch (e) {
            setOutput((o) => [...o, { kind: 'err', text: e.message }]);
        }
        setRunning(false);
        refreshTree();
    }

    if (!status.connected) {
        return (
            <div className="p-5 space-y-4 max-w-lg">
                <div className="rounded-xl border border-[#2a2a3e]/60 bg-[#0c0c12] p-4">
                    <h4 className="text-sm font-medium text-white mb-2">Local Agent not detected</h4>
                    <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
                        Run this once on your laptop to give the workbench real access to a project folder,
                        file writing, and shell commands (tests, builds, git):
                    </p>
                    <pre className="text-[11px] bg-[#0a0a10] border border-[#1f2733] rounded-lg p-3 text-emerald-300 overflow-x-auto">cd your-project-folder
npx github:mahmoudhamouda1987/uncensored-ai2#local-agent</pre>
                    <p className="text-[10px] text-gray-600 mt-2">It binds to 127.0.0.1 only and prints a pairing token.</p>
                </div>
                <div>
                    <label className="text-[11px] text-gray-400 block mb-1.5">Pairing token from the agent window</label>
                    <div className="flex gap-2">
                        <input
                            value={draftToken}
                            onChange={(e) => setDraftToken(e.target.value)}
                            placeholder="Paste token..."
                            className="flex-1 px-3 py-2 rounded-lg bg-[#0c0c14] border border-[#2a2a3e] text-xs font-mono text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#4a4a6e]"
                        />
                        <button
                            onClick={() => { const t = draftToken.trim(); if (t) { localStorage.setItem('wb_agent_token', t); setToken(t); } }}
                            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs transition-colors"
                            disabled={!draftToken.trim()}
                        >Pair</button>
                    </div>
                    {token && <p className="text-[10px] text-red-400 mt-2">Saved token was rejected — is the agent still running?</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="px-4 py-3 border-b border-[#2a2a3e]/50 flex items-center gap-2 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-gray-300">Connected · {status.platform}</span>
                {!status.workspace ? (
                    <div className="flex gap-2 ml-auto">
                        <input
                            value={folderDraft}
                            onChange={(e) => setFolderDraft(e.target.value)}
                            placeholder="C:\path\to\project"
                            className="w-56 px-2.5 py-1.5 rounded-md bg-[#0c0c14] border border-[#2a2a3e] text-[11px] font-mono text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#4a4a6e]"
                        />
                        <button
                            onClick={async () => { try { await call('/folder', { path: folderDraft }); await ping(token); notify?.('Workspace folder set', 'success'); } catch (e) { notify?.(e.message, 'error'); } }}
                            className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px]"
                        >Set Folder</button>
                    </div>
                ) : (
                    <span className="ml-auto text-[11px] font-mono text-gray-500 truncate max-w-56" title={status.workspace}>{status.workspace}</span>
                )}
            </div>

            <div className="flex flex-1 min-h-0">
                <div className="w-60 border-r border-[#2a2a3e]/50 overflow-y-auto bg-[#0c0c12]">
                    <div className="flex items-center justify-between px-3 py-2 sticky top-0 bg-[#0c0c12] border-b border-[#1f2733]">
                        <span className="text-[10px] uppercase tracking-wider text-gray-600">Files ({tree.filter((t) => t.type === 'file').length})</span>
                        <button onClick={refreshTree} className="text-[10px] text-indigo-400 hover:text-indigo-300">Refresh</button>
                    </div>
                    {tree.map((node) => (
                        <div key={node.path} className={`px-3 py-1 text-[11px] font-mono truncate ${node.type === 'dir' ? 'text-gray-500' : 'text-gray-300'}`}
                            style={{ paddingLeft: `${12 + (node.path.split('/').length - 1) * 12}px` }}>
                            {node.type === 'dir' ? '\u25B8' : '\u2022'} {node.path.split('/').pop()}
                        </div>
                    ))}
                    {tree.length === 0 && status.workspace && <p className="px-3 py-2 text-[11px] text-gray-600">Empty or unreadable.</p>}
                </div>

                <div className="flex-1 flex flex-col min-w-0 bg-[#08080c]">
                    <div className="flex gap-1.5 px-4 pt-3 pb-2 flex-wrap border-b border-[#1f2733]">
                        {['ls', 'npm install', 'npm test', 'npm run build', 'git status'].map((quick) => (
                            <button key={quick} onClick={() => runCommand(quick)} disabled={running}
                                className="text-[11px] px-3 py-1.5 rounded-lg bg-[#141420] border border-[#2a2a3e] text-gray-300 hover:border-[#4a4a6e] disabled:opacity-40 transition-colors">
                                {quick}
                            </button>
                        ))}
                    </div>
                    <div ref={outRef} className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed space-y-1">
                        {output.length === 0 && <p className="text-gray-700">Run a command to see output here.</p>}
                        {output.map((line, i) => (
                            <pre key={i} className={`whitespace-pre-wrap break-all ${line.kind === 'cmd' ? 'text-indigo-300' : line.kind === 'err' ? 'text-red-400' : 'text-gray-300'}`}>{line.text}</pre>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1f2733]">
                        <span className="text-emerald-400 font-mono text-xs">$</span>
                        <input
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { runCommand(command); setCommand(''); } }}
                            placeholder="shell command..."
                            disabled={running}
                            className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-700 focus:outline-none font-mono"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

export async function agentWriteFiles(token, files, notify) {
    for (const f of files) {
        const res = await fetch('http://127.0.0.1:7777/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Agent-Token': token },
            body: JSON.stringify({ path: f.name, content: f.content }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(`${f.name}: ${data.error || res.status}`);
        notify?.(`Wrote ${f.name} (${data.bytes} bytes)`, 'success');
    }
}
