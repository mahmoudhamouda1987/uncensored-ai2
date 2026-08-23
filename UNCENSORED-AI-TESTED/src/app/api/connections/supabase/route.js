import { NextResponse } from 'next/server';

export const maxDuration = 60;

function getToken(request) {
    return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

const SUPABASE_API = 'https://api.supabase.com/v1';

async function sb(path, token, options = {}) {
    const res = await fetch(`${SUPABASE_API}${path}`, {
        method: options.method || 'GET',
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        return { status: res.status, error: data?.message || `Supabase API error ${res.status}` };
    }
    return { status: res.status, data };
}

export async function POST(request) {
    const token = getToken(request);
    if (!token) return NextResponse.json({ error: 'Missing Supabase token' }, { status: 401 });

    let action, params;
    try {
        ({ action, ...params } = await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    try {
        switch (action) {
            case 'listProjects': {
                const r = await sb('/projects', token);
                if (r.error) return NextResponse.json(r, { status: r.status });
                return NextResponse.json({
                    projects: r.data.map(p => ({
                        id: p.id, name: p.name, region: p.region,
                        status: p.status, createdAt: p.created_at,
                        orgId: p.organization_id,
                    })),
                });
            }
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (e) {
        return NextResponse.json({ error: e?.message || 'Supabase request failed' }, { status: 502 });
    }
}
