import { NextResponse } from 'next/server';
import { verifyClient, enforceLimits } from '@/lib/security';
import { complete } from '@/lib/llm';
import { generateDocumentSection } from '@/lib/orchestrator';

export const maxDuration = 60;

export async function POST(request) {
    try {
        const body = await request.json();
        const access = await verifyClient(request, body.turnstileToken);
        if (!access.ok) return new NextResponse(access.message, { status: access.status });
        const limits = await enforceLimits(request);
        if (!limits.ok) return new NextResponse(limits.message, { status: limits.status });

        const { title, description, sections, index } = body;
        if (!Array.isArray(sections) || typeof index !== 'number' || index < 0 || index >= sections.length) {
            return NextResponse.json({ error: 'Invalid section request' }, { status: 400 });
        }

        const content = await generateDocumentSection({
            title: String(title).slice(0, 200),
            description: String(description || '').slice(0, 500),
            sections: sections.slice(0, 60).map(s => ({
                index: Number(s.index) || 0,
                title: String(s.title || '').slice(0, 160),
                objectives: String(s.objectives || '').slice(0, 400),
                keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.slice(0, 10) : [],
                targetWords: Number(s.targetWords) || 600,
                content: String(s.content || ''),
            })),
            index,
        });

        const wordCount = content.split(/\s+/).length;
        const completeness = {
            wordCount,
            meetsTarget: wordCount >= (sections[index].targetWords || 600) * 0.6,
            hasStructure: /^##\s/m.test(content) || content.length > 400,
        };

        return NextResponse.json({ content, completeness }, { headers: limits.headers });
    } catch (e) {
        console.error('[DOC SECTION ERROR]', e?.message || e);
        return NextResponse.json({ error: e?.message || 'Section generation failed' }, { status: 500 });
    }
}
