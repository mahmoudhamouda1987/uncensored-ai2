import { NextResponse } from 'next/server';

export const maxDuration = 60;

function getToken(request) {
    return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

async function railwayGraph(token, query, variables = {}) {
    const res = await fetch('https://back2.railway.app/graphql/v2', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.errors) {
        return { error: data?.errors?.[0]?.message || `Railway API error ${res.status}` };
    }
    return { data: data.data };
}

export async function POST(request) {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: 'Missing Railway token' }, { status: 401 });

    let action;
    try {
        ({ action } = await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    try {
        switch (action) {
            case 'me': {
                const r = await railwayGraph(token, 'query { me { id email name } }');
                if (r.error) return NextResponse.json(r, { status: 502 });
                return NextResponse.json({ user: r.data.me });
            }
            case 'listProjects': {
                const r = await railwayGraph(token, `
                    query { projects(limit: 25) {
                        edges { node {
                            id name createdAt
                            environments { edges { node { id name } } }
                            services { edges { node { id name } } }
                        } }
                    } }`);
                if (r.error) return NextResponse.json(r, { status: 502 });
                return NextResponse.json({
                    projects: r.data.projects.edges.map(e => ({
                        id: e.node.id,
                        name: e.node.name,
                        createdAt: e.node.createdAt,
                        services: (e.node.services?.edges || []).map(s => s.node.name),
                        environments: (e.node.environments?.edges || []).map(x => x.node.name),
                    })),
                });
            }
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: e?.message || 'Railway request failed' }, { status: 502 });
    }
}
