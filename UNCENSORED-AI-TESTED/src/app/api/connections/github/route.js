import { NextResponse } from 'next/server';

export const maxDuration = 60;

function getToken(request) {
    const header = request.headers.get('authorization') || '';
    return header.replace(/^Bearer\s+/i, '').trim();
}

const GITHUB_API = 'https://api.github.com';

async function gh(path, token, options = {}) {
    const res = await fetch(`${GITHUB_API}${path}`, {
        ...options,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
        return { status: res.status, error: data?.message || `GitHub API error ${res.status}` };
    }
    return { status: res.status, data };
}

async function getRepoBranchSha(token, owner, repo, branch) {
    const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    if (ref.error) throw new Error(ref.error);
    return ref.data.object.sha;
}

export async function POST(request) {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: 'Missing GitHub token' }, { status: 401 });

    let action, params;
    try {
        ({ action, ...params } = await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    try {
        switch (action) {
            case 'me': {
                const r = await gh('/user', token);
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({
                    login: r.data.login,
                    name: r.data.name,
                    avatar: r.data.avatar_url,
                    publicRepos: r.data.public_repos,
                    scopes: (request.headers.get('x-gh-scopes') || '').split(',').filter(Boolean),
                });
            }
            case 'listRepos': {
                const r = await gh('/user/repos?per_page=50&sort=updated', token);
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({
                    repos: r.data.map(x => ({
                        fullName: x.full_name, private: x.private, language: x.language,
                        updatedAt: x.updated_at, defaultBranch: x.default_branch, url: x.html_url,
                    })),
                });
            }
            case 'readTree': {
                const { owner, repo, branch } = params;
                const r = await gh(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({
                    tree: r.data.tree
                        .filter(n => n.type === 'blob')
                        .slice(0, 500)
                        .map(n => ({ path: n.path, size: n.size })),
                    truncated: r.data.truncated,
                });
            }
            case 'readFile': {
                const { owner, repo, path, ref } = params;
                const r = await gh(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('')}?ref=${encodeURIComponent(ref || 'main')}`, token);
                if (r.error) return NextResponse.json(r, { status: r.status });
                if (r.data.encoding === 'base64') {
                    return NextResponse.json({ content: Buffer.from(r.data.content, 'base64').toString('utf8'), size: r.data.size });
                }
                return NextResponse.json({ content: null, downloadUrl: r.data.download_url, size: r.data.size });
            }
            case 'createBranch': {
                const { owner, repo, base, name } = params;
                const sha = await getRepoBranchSha(token, owner, repo, base);
                const r = await gh(`/repos/${owner}/${repo}/git/refs`, token, {
                    method: 'POST',
                    body: JSON.stringify({ ref: `refs/heads/${name}`, sha }),
                });
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({ ok: true, sha });
            }
            case 'commitFiles': {
                const { owner, repo, branch, message, files } = params;
                if (!Array.isArray(files) || files.length === 0) {
                    return NextResponse.json({ error: 'files array required' }, { status: 400 });
                }
                const results = [];
                for (const f of files.slice(0, 20)) {
                    const r = await gh(`/repos/${owner}/${repo}/contents/${String(f.path).split('/').map(encodeURIComponent).join('')}`, token, {
                        method: 'PUT',
                        body: JSON.stringify({
                            message,
                            content: Buffer.from(String(f.content)).toString('base64'),
                            branch,
                        }),
                    });
                    if (r.error) return NextResponse.json({ error: r.error, failedPath: f.path }, { status: r.status });
                    results.push(f.path);
                }
                return NextResponse.json({ ok: true, committed: results, branch });
            }
            case 'createPullRequest': {
                const { owner, repo, head, base, title, body } = params;
                const r = await gh(`/repos/${owner}/${repo}/pulls`, token, {
                    method: 'POST',
                    body: JSON.stringify({ title, head, base, body: body || '' }),
                });
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({ ok: true, url: r.data.html_url, number: r.data.number });
            }
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: e?.message || 'GitHub request failed' }, { status: 502 });
    }
}
