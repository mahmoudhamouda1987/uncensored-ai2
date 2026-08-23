import { NextResponse } from 'next/server';

export const maxDuration = 60;

function getToken(request) {
    return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

const VERCEL_API = 'https://api.vercel.com/v9';
const VERCEL_API_V13 = 'https://api.vercel.com/v13';

async function v(path, token, options = {}, base = VERCEL_API) {
    const teamId = options.teamId ? `?teamId=${encodeURIComponent(options.teamId)}` : '';
    const res = await fetch(`${base}${path}${teamId}`, {
        method: options.method || 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        return { status: res.status, error: data?.error?.message || `Vercel API error ${res.status}` };
    }
    return { status: res.status, data };
}

export async function POST(request) {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: 'Missing Vercel token' }, { status: 401 });

    let action, params;
    try {
        ({ action, ...params } = await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const teamId = params.teamId || undefined;

    try {
        switch (action) {
            case 'me': {
                const r = await v('/user', token);
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({ username: r.data.user.username, name: r.data.user.name, email: r.data.user.email });
            }
            case 'listTeams': {
                const r = await v('/teams', token);
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({ teams: r.data.teams.map(t => ({ id: t.id, name: t.name })) });
            }
            case 'listProjects': {
                const r = await v('/projects', token, { teamId });
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({
                    projects: r.data.projects.map(p => ({
                        name: p.name,
                        framework: p.framework,
                        updatedAt: p.updatedAt,
                        latestDeployments: (p.latestDeployments || []).slice(0, 3).map(d => ({
                            url: d.url, state: d.readyState, createdAt: d.createdAt,
                        })),
                    })),
                });
            }
            case 'listDeployments': {
                const { app } = params;
                const query = app ? `&app=${encodeURIComponent(app)}` : '';
                const r = await v(`/deployments?limit=10${query}`, token, {}, 'https://api.vercel.com/v6');
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({
                    deployments: r.data.deployments.map(d => ({
                        uid: d.uid, url: d.url, state: d.readyState, createdAt: d.createdAt, target: d.target,
                    })),
                });
            }
            case 'getDeployment': {
                const { id } = params;
                const r = await v(`/deployments/${encodeURIComponent(id)}`, token, {}, VERCEL_API_V13);
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({
                    readyState: r.data.readyState,
                    readySubstate: r.data.readySubstate,
                    url: r.data.url,
                    createdAt: r.data.createdAt,
                });
            }
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: e?.message || 'Vercel request failed' }, { status: 502 });
    }
}
