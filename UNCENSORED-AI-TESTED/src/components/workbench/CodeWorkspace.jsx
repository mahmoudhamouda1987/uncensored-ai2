'use client';

import { useState, useMemo } from 'react';

export function CodeWorkspace({ artifact }) {
    const [activeFile, setActiveFile] = useState(0);
    const [files, setFiles] = useState(artifact.files || []);
    const [search, setSearch] = useState('');

    const visibleFiles = useMemo(
        () => files.map((f, i) => ({ ...f, i })).filter((f) => f.name.toLowerCase().includes(search.toLowerCase())),
        [files, search]
    );

    function downloadBundle() {
        const bundle = files.map((f) => `// ===== ${f.name} =====\n${f.content}`).join('\n\n');
        const blob = new Blob([bundle], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(artifact.name || 'project').replace(/[^a-z0-9-_ ]/gi, '_')}-source.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function updateContent(value) {
        setFiles((prev) => prev.map((f, i) => (i === activeFile ? { ...f, content: value } : f)));
    }

    const file = files[activeFile];

    return (
        <div className="flex h-full">
            <div className="w-56 border-r border-[#2a2a3e]/60 flex flex-col bg-[#0c0c12]">
                <div className="px-3 py-2.5 border-b border-[#2a2a3e]/60">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search files..."
                        className="w-full px-2.5 py-1.5 rounded-lg bg-[#141420] border border-[#2a2a3e] text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#4a4a6e]"
                    />
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                    <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-600">{artifact.name || 'Project'} · {files.length} files</p>
                    {visibleFiles.map((f) => (
                        <button
                            key={f.i}
                            onClick={() => setActiveFile(f.i)}
                            className={`w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors ${f.i === activeFile ? 'bg-[#141420] text-indigo-300' : 'text-gray-400 hover:bg-[#10101a] hover:text-gray-200'}`}
                        >
                            {f.name}
                        </button>
                    ))}
                </div>
                <div className="p-3 border-t border-[#2a2a3e]/60 space-y-2">
                    <button onClick={downloadBundle} className="w-full py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-medium transition-all">Download Source Bundle</button>
                    <p className="text-[10px] text-gray-600 leading-snug">Compile/run requires a sandbox runtime (SANDBOX_URL). Files are editable and exportable.</p>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0">
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2a3e]/60 bg-[#0c0c12]">
                    <span className="text-xs font-mono text-gray-400">{file?.name}</span>
                    <div className="flex gap-2">
                        <button onClick={() => navigator.clipboard.writeText(file.content)} className="text-[11px] px-2.5 py-1 rounded-md bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-400 transition-colors">Copy</button>
                        <button onClick={() => {
                            const blob = new Blob([file.content], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = file.name;
                            a.click();
                            URL.revokeObjectURL(url);
                        }} className="text-[11px] px-2.5 py-1 rounded-md bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-400 transition-colors">Download</button>
                    </div>
                </div>
                <textarea
                    value={file?.content || ''}
                    onChange={(e) => updateContent(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full resize-none bg-transparent px-5 py-4 text-xs leading-relaxed text-gray-200 font-mono focus:outline-none"
                />
                <div className="px-5 py-1.5 border-t border-[#2a2a3e]/60 flex items-center gap-4 text-[11px] text-gray-600">
                    <span>{file ? file.content.split('\n').length : 0} lines</span>
                    <span>{file ? new Blob([file.content]).size : 0} bytes</span>
                </div>
            </div>
        </div>
    );
}

export function WebPreviewWorkspace({ artifact }) {
    const consoleHook = `<script>(function(){var send=function(level,args){try{parent.postMessage({__wbConsole:true,level:level,message:Array.from(args).map(function(a){try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(' ')},'*')}catch(e){}};['log','warn','error','info'].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);o.apply(console,arguments)}});window.addEventListener('error',function(e){send('error',[e.message])});window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise rejection: '+e.reason])});})();<\/script>`;
    const html = artifact.html.includes('<head>')
        ? artifact.html.replace('<head>', '<head>' + consoleHook)
        : consoleHook + artifact.html;

    const [device, setDevice] = useState('desktop');
    const [logs, setLogs] = useState([]);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        function onMessage(e) {
            if (e.data && e.data.__wbConsole) {
                setLogs((prev) => [...prev.slice(-80), { level: e.data.level, message: e.data.message, at: Date.now() }]);
            }
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const widths = { desktop: '100%', tablet: '768px', mobile: '390px' };
    const errors = logs.filter((l) => l.level === 'error');

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2a3e]/60 bg-[#0c0c12]">
                <div className="flex items-center gap-1">
                    {['desktop', 'tablet', 'mobile'].map((d) => (
                        <button key={d} onClick={() => setDevice(d)} className={`px-3 py-1 rounded-md text-[11px] capitalize transition-colors ${device === d ? 'bg-[#141420] text-white' : 'text-gray-500 hover:text-gray-300'}`}>{d}</button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    {errors.length > 0 && <span className="text-[11px] text-red-400">{errors.length} error{errors.length > 1 ? 's' : ''}</span>}
                    <button onClick={() => { setLogs([]); setReloadKey((k) => k + 1); }} className="text-[11px] px-2.5 py-1 rounded-md bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-400 transition-colors">Reload</button>
                </div>
            </div>
            <div className="flex-1 overflow-auto bg-[#08080c] flex justify-center p-3">
                <iframe
                    key={reloadKey}
                    title={artifact.name}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    srcDoc={html}
                    style={{ width: widths[device] }}
                    className="h-full border border-[#2a2a3e] rounded-xl bg-white transition-all"
                />
            </div>
            <div className="h-36 border-t border-[#2a2a3e]/60 bg-[#0a0a10] overflow-y-auto font-mono">
                <p className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-gray-600 sticky top-0 bg-[#0a0a10]">Console</p>
                {logs.length === 0 && <p className="px-4 pb-3 text-[11px] text-gray-700">No console output.</p>}
                {logs.map((l, i) => (
                    <p key={i} className={`px-4 py-0.5 text-[11px] ${l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-gray-500'}`}>
                        <span className="opacity-50 mr-2">[{l.level}]</span>{l.message}
                    </p>
                ))}
            </div>
        </div>
    );
}
