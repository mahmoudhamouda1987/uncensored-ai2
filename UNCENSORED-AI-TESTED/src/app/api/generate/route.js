import { NextResponse } from 'next/server';
import { enforceLimits, verifyClient, saveArtifact, isLocalRequest, isRateLimitError, isDailyTokenQuotaError } from '@/lib/security';
import { buildChatMessages, streamWithServerContinuation, createChatStream, customProviderConfigured, openRouterConfigured } from '@/lib/llm';
import { planGeneration, executePlan } from '@/lib/orchestrator';

export const maxDuration = 60;

function errorResponse(e) {
    if (isDailyTokenQuotaError(e)) {
        return new NextResponse("We're a bit busy right now! Our servers have reached their daily capacity. Please try again in a little while.", { status: 429 });
    }
    if (isRateLimitError(e)) {
        return new NextResponse("We're a bit busy right now! Too many people are using the service. Please try again in a moment.", { status: 429 });
    }
    return null;
}

export async function POST(request) {
    try {
        const body = await request.json();
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const mode = typeof body.mode === 'string' ? body.mode : 'auto';
        const userId = typeof body.userId === 'string' ? body.userId.slice(0, 64) : 'anon';

        if (messages.length === 0) {
            return new NextResponse("Your message is empty! Write something first.", { status: 400 });
        }
        const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
        if (totalChars > 12000) {
            return new NextResponse("Your conversation is getting long! Try starting a new chat to keep things running smoothly.", { status: 400 });
        }

        const access = await verifyClient(request, body.turnstileToken);
        if (!access.ok) {
            return new NextResponse(access.message, { status: access.status });
        }
        const limits = await enforceLimits(request);
        if (!limits.ok) {
            return new NextResponse(limits.message, { status: limits.status });
        }

        let plan;
        try {
            plan = await planGeneration(messages, mode);
        } catch (e) {
            return errorResponse(e) || new NextResponse("I couldn't process that request. Please try rephrasing it.", { status: 500 });
        }

        if (plan.type === 'text') {
            const chatMessages = buildChatMessages(messages, { plain: customProviderConfigured() || openRouterConfigured() });
            let firstStream;
            try {
                firstStream = await createChatStream(chatMessages, { temperature: 0.7, maxTokens: 1024 });
            } catch (e) {
                return errorResponse(e) || new NextResponse(`All AI providers are currently unavailable or rate-limited (${String(e?.message || 'error').slice(0, 160)}). Add another free key (GROQ_API_KEY_2) or configure CUSTOM_LLM_URL / CUSTOM_LLM_KEY / CUSTOM_LLM_MODEL in project settings.`, { status: 429 });
            }
            const { readable } = await streamWithServerContinuation(chatMessages, { temperature: 0.7, maxTokens: 1024 }, firstStream);
            const headers = {
                "Content-Type": "text/plain; charset=utf-8",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-cache",
                ...limits.headers,
            };
            if (access.newSessionId) {
                headers["Set-Cookie"] = `cf_verified=${access.newSessionId}; HttpOnly; Path=/; Max-Age=3600${isLocalRequest(request) ? '' : '; Secure'}`;
            }
            return new Response(readable, { status: 200, headers });
        }

        let artifact;
        try {
            artifact = await executePlan(plan, messages);
        } catch (e) {
            const raw = String(e?.message || 'Generation failed');
            return NextResponse.json({
                assistantText: raw.includes('timeout') || raw.includes('aborted')
                    ? "The generation provider timed out. Please press Regenerate or try again in a moment."
                    : `Generation failed: ${raw}`,
                artifacts: [],
                error: true,
                retryable: true,
            }, { status: 200 });
        }

        const fullArtifact = {
            id: crypto.randomUUID(),
            ...artifact,
            source_prompt: plan.prompt,
            status: 'ready',
            created_at: new Date().toISOString(),
        };

        const persisted = await saveArtifact(userId, fullArtifact);

        return NextResponse.json({
            assistantText: plan.assistantText || defaultAssistantText(plan.type),
            artifacts: [fullArtifact],
            persisted: persisted.persisted,
            plan: { type: plan.type },
        }, {
            status: 200,
            headers: limits.headers,
        });
    } catch (e) {
        console.error('[GENERATE ERROR]', e?.message || e);
        return errorResponse(e) || new NextResponse("Something went wrong while creating. Please try again.", { status: 500 });
    }
}

function defaultAssistantText(type) {
    switch (type) {
        case 'image': return 'Here is your image.';
        case 'audio': return 'Here is your audio.';
        case 'web': return 'Your interactive app is ready.';
        case 'code': return 'Here is your code.';
        case 'video': return 'Here is your video storyboard. Open the studio to render it.';
        default: return '';
    }
}
