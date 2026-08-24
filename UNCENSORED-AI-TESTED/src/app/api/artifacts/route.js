import { NextResponse } from 'next/server';
import { loadArtifacts, deleteArtifact, checkAccessKey } from '@/lib/security';

export async function GET(request) {
    const gate = checkAccessKey(request);
    if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const userId = (searchParams.get('userId') || 'anon').slice(0, 64);
    const result = await loadArtifacts(userId);
    return NextResponse.json(result);
}

export async function DELETE(request) {
    const gate = checkAccessKey(request);
    if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
        return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
    }
    const ok = await deleteArtifact(id);
    return NextResponse.json({ ok });
}
