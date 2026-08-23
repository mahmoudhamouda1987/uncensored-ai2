#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const crypto = require('crypto');

const PORT = 7777;
const TOKEN = crypto.randomBytes(16).toString('hex');
const CONFIG = path.join(os.homedir(), '.uncensored-agent.json');
const MAX_TRANSFER = 8 * 1024 * 1024;
const CMD_TIMEOUT_MS = 15 * 60 * 1000;

let workspace = null;
try {
    const saved = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (saved.workspace && fs.existsSync(saved.workspace)) workspace = saved.workspace;
} catch { }

function json(res, code, data) {
    res.writeHead(code, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Agent-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_TRANSFER) { reject(new Error('Payload too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function safeJoin(base, rel) {
    const target = path.resolve(base, rel || '.');
    if (!target.startsWith(path.resolve(base))) throw new Error('Path escapes workspace');
    return target;
}

function listTree(dir, depth, out) {
    if (depth <= 0 || out.length >= 2000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.venv'].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(workspace, full).split(path.sep).join('/');
        if (e.isDirectory()) {
            out.push({ path: rel, type: 'dir' });
            listTree(full, depth - 1, out);
        } else {
            let size = 0;
            try { size = fs.statSync(full).size; } catch { }
            out.push({ path: rel, type: 'file', size });
        }
    }
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { json(res, 204, {}); return; }

    if (req.headers['x-agent-token'] !== TOKEN) {
        json(res, 401, { error: 'Invalid agent token' });
        return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    try {
        if (req.method === 'GET' && url.pathname === '/ping') {
            json(res, 200, { ok: true, version: 1, workspace, platform: os.platform(), home: os.homedir() });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/folder') {
            const body = JSON.parse(await readBody(req));
            const p = path.resolve(body.path.replace(/^~(?=$|\/|\\)/, os.homedir()));
            if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
                json(res, 400, { error: 'Folder does not exist' });
                return;
            }
            workspace = p;
            fs.writeFileSync(CONFIG, JSON.stringify({ workspace: p }, null, 2));
            json(res, 200, { ok: true, workspace });
            return;
        }

        if (!workspace) { json(res, 400, { error: 'No workspace folder selected yet' }); return; }

        if (req.method === 'POST' && url.pathname === '/tree') {
            const out = [];
            listTree(workspace, 4, out);
            json(res, 200, { tree: out.slice(0, 2000), workspace });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/read') {
            const body = JSON.parse(await readBody(req));
            const p = safeJoin(workspace, body.path);
            const stat = fs.statSync(p);
            if (stat.size > MAX_TRANSFER) { json(res, 400, { error: 'File too large' }); return; }
            json(res, 200, { content: fs.readFileSync(p, 'utf8'), size: stat.size });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/write') {
            const body = JSON.parse(await readBody(req));
            const p = safeJoin(workspace, body.path);
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, body.content ?? '', 'utf8');
            json(res, 200, { ok: true, path: body.path, bytes: Buffer.byteLength(body.content ?? '') });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/delete') {
            const body = JSON.parse(await readBody(req));
            const p = safeJoin(workspace, body.path);
            fs.rmSync(p, { recursive: !!body.recursive });
            json(res, 200, { ok: true });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/run') {
            const body = JSON.parse(await readBody(req));
            const command = String(body.command || '').trim();
            if (!command) { json(res, 400, { error: 'Empty command' }); return; }
            const started = Date.now();
            exec(command, {
                cwd: safeJoin(workspace, body.cwd || '.'),
                timeout: CMD_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
                shell: true,
                env: { ...process.env, FORCE_COLOR: '0' },
            }, (err, stdout, stderr) => {
                json(res, 200, {
                    ok: !err,
                    code: err ? (err.code ?? 1) : 0,
                    timedOut: Boolean(err && err.killed),
                    stdout: String(stdout || '').slice(-150000),
                    stderr: String(stderr || '').slice(-50000),
                    durationMs: Date.now() - started,
                    command,
                });
            });
            return;
        }

        json(res, 404, { error: 'Unknown endpoint' });
    } catch (e) {
        json(res, 500, { error: e.message || 'Agent error' });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  Uncensored AI Workbench — Local Agent');
    console.log('  -------------------------------------');
    console.log(`  Listening on  http://127.0.0.1:${PORT}`);
    console.log(`  Workspace     ${workspace || '(not set — choose from the website)'}`);
    console.log('');
    console.log(`  Pairing token (paste this into the website once):`);
    console.log('');
    console.log(`  ${TOKEN}`);
    console.log('');
});
