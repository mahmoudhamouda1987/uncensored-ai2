'use client';

import { useState } from 'react';

const CONNECTIONS = [
    {
        id: 'github',
        name: 'GitHub',
        color: 'from-gray-700 to-gray-900',
        tokenLabel: 'Personal Access Token (classic, repo scope)',
        tokenUrl: 'https://github.com/settings/tokens',
        endpoints: { me: ['login', 'name'], listRepos: null },
    },
    {
        id: 'vercel',
        name: 'Vercel',
        color: 'from-slate-600 to-slate-900',
        tokenLabel: 'Vercel API Token (account or team scope)',
        tokenUrl: 'https://vercel.com/account/tokens',
    },
    {
        id: 'railway',
        name: 'Railway',
        color: 'from-purple-800 to-purple-950',
        tokenLabel: 'Railway Account Token',
        tokenUrl: 'https://railway.app/account/tokens',
    },
    {
        id: 'supabase',
        name: 'Supabase',
        color: 'from-emerald-700 to-emerald-950',
        tokenLabel: 'Supabase Access Token (management API)',
        tokenUrl: 'https://supabase.com/dashboard/account/tokens',
    },
];

const TOKEN_KEY = 'wb_connection_tokens';

function loadTokens() {
    if (typeof localStorage === 'undefined') return {};
    try {
        return JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}');
    } catch {
        return {};
    }
}

export function Connections({ notify }) {
    const [tokens, setTokens] = useState(loadTokens);
    const [drafts, setDrafts] = useState({});
    const [status, setStatus] = useState({});
    const [expanded, setExpanded] = useState({});

    function persistTokens(next) {
        setTokens(next);
        localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
    }

    async function call(service, body) {
        const res = await fetch(`/api/connections/${service}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tokens[service] || ''}`,
            },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    }

    async function connect(conn) {
        const key = conn.id;
        const draft = (drafts[key] || '').trim();
        if (!draft) return;
        setStatus((s) => ({ ...s, [key]: { loading: true } }));
        try {
            let info;
            if (key === 'github') info = await call('github', { action: 'me' });
            else if (key === 'vercel') info = await call('vercel', { action: 'me' });
            else if (key === 'railway') info = await call('railway', { action: 'me' });
            else info = { user: { email: 'token stored' }, name: '' };

            const next = { ...tokens, [key]: draft };
            persistTokens(next);
            setStatus((s) => ({ ...s, [key]: { connected: true, info } }));
            setDrafts((d) => ({ ...d, [key]: '' }));
            notify?.(`${conn.name} connected`, 'success');
        } catch (e) {
            setStatus((s) => ({ ...s, [key]: { error: e.message } }));
        }
    }

    function disconnect(key) {
        const next = { ...tokens };
        delete next[key];
        persistTokens(next);
        setStatus((s) => ({ ...s, [key]: null }));
    }

    async function browse(conn) {
        const key = conn.id;
        setStatus((s) => ({ ...s, [key]: { ...s[key], loadingData: true } }));
        try {
            let data;
            if (key === 'github') data = await call('github', { action: 'listRepos' });
            else if (key === 'vercel') data = await call('vercel', { action: 'listProjects' });
            else if (key === 'railway') data = await call('railway', { action: 'listProjects' });
            else data = await call('supabase', { action: 'listProjects' });
            setStatus((s) => ({ ...s, [key]: { ...s[key], data } }));
        } catch (e) {
            setStatus((s) => ({ ...s, [key]: { ...s[key], error: e.message } }));
        }
    }

    return (
        <div className="p-4 space-y-3 overflow-y-auto h-full">
            <div className="rounded-xl border border-[#2a2a3e]/60 bg-[#0c0c12] p-4">
                <h4 className="text-sm font-medium text-white mb-1">Privacy</h4>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                    Tokens are stored only in this browser (localStorage) and sent directly to your server for each request.
                    Your projects, conversations and artifacts live in this browser's IndexedDB. AI generation requests are
                    processed by the configured LLM provider; connection tokens are never sent to it.
                </p>
            </div>

            {CONNECTIONS.map((conn) => {
                const st = status[conn.id];
                const connected = !!tokens[conn.id] && !st?.error;
                const isOpen = expanded[conn.id];
                return (
                    <div key={conn.id} className="rounded-xl border border-[#2a2a3e]/60 bg-[#101018] overflow-hidden">
                        <button
                            onClick={() => setExpanded((e) => ({ ...e, [conn.id]: !e[conn.id] }))}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#141420] transition-colors"
                        >
                            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${conn.color} flex items-center justify-center text-white text-sm font-bold`}>
                                {conn.name[0]}
                            </div>
                            <div className="flex-1 text-left">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-white">{conn.name}</span>
                                    {connected && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Connected</span>}
                                </div>
                                <p className="text-[11px] text-gray-500">{connected ? `as ${st?.info?.login || st?.info?.user?.email || st?.info?.username || 'token valid'}` : conn.tokenLabel}</p>
                            </div>
                            <span className={`text-gray-500 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#8250;</span>
                        </button>

                        {isOpen && (
                            <div className="px-4 pb-4 space-y-3 border-t border-[#2a2a3e]/40 pt-3">
                                {!connected ? (
                                    <>
                                        <input
                                            type="password"
                                            value={drafts[conn.id] || ''}
                                            onChange={(e) => setDrafts((d) => ({ ...d, [conn.id]: e.target.value }))}
                                            placeholder={conn.tokenLabel}
                                            className="w-full px-3 py-2 rounded-lg bg-[#0c0c14] border border-[#2a2a3e] text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#4a4a6e]"
                                        />
                                        <div className="flex items-center justify-between">
                                            <a href={conn.tokenUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-400 hover:text-indigo-300">Get a token &rarr;</a>
                                            <button onClick={() => connect(conn)} disabled={!(drafts[conn.id] || '').trim()} className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs transition-colors">
                                                {st?.loading ? 'Verifying...' : 'Connect'}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex gap-2">
                                            <button onClick={() => browse(conn)} className="flex-1 py-1.5 rounded-lg bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 text-xs transition-colors">
                                                {st?.loadingData ? 'Loading...' : 'Browse'}
                                            </button>
                                            <button onClick={() => disconnect(conn.id)} className="px-3 py-1.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-300 text-xs transition-colors">Disconnect</button>
                                        </div>
                                        {st?.data?.repos && (
                                            <div className="max-h-44 overflow-y-auto space-y-1">
                                                {st.data.repos.map((r) => (
                                                    <div key={r.fullName} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[#0c0c14] text-[11px]">
                                                        <span className="font-mono text-gray-300 truncate">{r.fullName}</span>
                                                        <span className="text-gray-600 ml-2 whitespace-nowrap">{r.private ? 'private' : r.language || ''}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {st?.data?.projects && (
                                            <div className="max-h-44 overflow-y-auto space-y-1">
                                                {st.data.projects.map((p) => (
                                                    <div key={p.name || p.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[#0c0c14] text-[11px]">
                                                        <span className="font-mono text-gray-300 truncate">{p.name}</span>
                                                        <span className={`ml-2 whitespace-nowrap ${p.status === 'ACTIVE' ? 'text-emerald-400' : 'text-gray-600'}`}>{p.status || p.framework || ''}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                                {st?.error && <p className="text-[11px] text-red-400">{st.error}</p>}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
