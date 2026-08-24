import { getProviderPoolSummary } from './llm';

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

const ASPECT_DIMENSIONS = {
    "1:1": { width: 1024, height: 1024 },
    "4:3": { width: 1200, height: 900 },
    "3:4": { width: 900, height: 1200 },
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
};

export function resolveDimensions(aspect) {
    return ASPECT_DIMENSIONS[aspect] || ASPECT_DIMENSIONS["1:1"];
}

function openAiImageConfig() {
    if (!process.env.OPENAI_IMAGE_API_KEY) return null;
    return {
        apiKey: process.env.OPENAI_IMAGE_API_KEY,
        baseURL: process.env.OPENAI_IMAGE_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_IMAGE_MODEL || 'dall-e-3',
    };
}

async function pollinationsImage({ prompt, aspect, seed }) {
    const { width, height } = resolveDimensions(aspect);
    const effectiveSeed = typeof seed === 'number' ? seed : Math.floor(Math.random() * 1e9);
    const models = ['flux', 'turbo'];
    let lastError = null;
    for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${effectiveSeed}&nologo=true&model=${model}`;
                const res = await fetchWithTimeout(url, { method: 'GET' }, 90000);
                if (!res.ok) throw new Error(`Image provider returned ${res.status}`);
                const blob = await res.blob();
                if (!blob.type.startsWith('image/')) throw new Error('Image provider returned unexpected content');
                const buffer = Buffer.from(await blob.arrayBuffer());
                if (buffer.length < 1024) throw new Error('Image provider returned an empty image');
                return {
                    url,
                    dataUrl: `data:${blob.type};base64,${buffer.toString('base64')}`,
                    provider: `pollinations/${model}`,
                    width,
                    height,
                    seed: effectiveSeed,
                };
            } catch (e) {
                lastError = e;
            }
        }
    }
    throw lastError || new Error('Image generation unavailable');
}

async function openAiImage({ prompt, aspect }) {
    const config = openAiImageConfig();
    if (!config) throw new Error('OPENAI_IMAGE_API_KEY not configured');
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    const { width, height } = resolveDimensions(aspect);
    const size = `${width}x${height}`;
    const supportedSize = ['1024x1024', '1792x1024', '1024x1792'].includes(size)
        ? size
        : (aspect === '16:9' ? '1792x1024' : aspect === '9:16' ? '1024x1792' : '1024x1024');
    const res = await client.images.generate({
        model: config.model,
        prompt,
        n: 1,
        size: supportedSize,
    });
    const item = res.data?.[0];
    if (!item) throw new Error('Image provider returned no image');
    return {
        url: item.url || null,
        dataUrl: item.b64_json ? `data:image/png;base64,${item.b64_json}` : null,
        provider: config.model,
        width: parseInt(supportedSize.split('x')[0], 10),
        height: parseInt(supportedSize.split('x')[1], 10),
    };
}

const IMAGE_PROVIDERS = [
    { id: 'pollinations-flux', available: () => true, generate: pollinationsImage },
    { id: 'openai-images', available: () => !!openAiImageConfig(), generate: openAiImage },
];

export async function generateImage(params) {
    let lastError = null;
    for (const provider of IMAGE_PROVIDERS) {
        if (!provider.available()) continue;
        try {
            const result = await provider.generate(params);
            if (result) return result;
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error('No image provider available');
}

export function imageUrl(prompt, aspect, seed) {
    const { width, height } = resolveDimensions(aspect);
    const effectiveSeed = typeof seed === 'number' ? seed : Math.floor(Math.random() * 1e9);
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${effectiveSeed}&nologo=true&model=flux`;
}

export const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse'];

function splitIntoChunks(text, maxLen = 900) {
    const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) || [text];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if ((current + sentence).length > maxLen && current) {
            chunks.push(current.trim());
            current = sentence;
        } else {
            current += sentence;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

export async function generateSpeech({ text, voice = 'nova' }) {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('Nothing to speak');
    const safeVoice = VOICES.includes(voice) ? voice : 'nova';
    const chunks = splitIntoChunks(clean);
    const segments = [];
    for (const chunk of chunks) {
        const url = `https://text.pollinations.ai/${encodeURIComponent(chunk)}?model=openai-audio&voice=${safeVoice}`;
        let buffer = null;
        for (let attempt = 0; attempt < 3 && !buffer; attempt++) {
            try {
                const res = await fetchWithTimeout(url, { method: 'GET' }, 90000);
                if (!res.ok) throw new Error(`Speech provider returned ${res.status}`);
                const candidate = Buffer.from(await res.arrayBuffer());
                if (candidate.length >= 512) buffer = candidate;
            } catch (e) {
                if (attempt === 2) throw new Error('Speech service is busy — please retry in a moment.');
            }
        }
        segments.push({
            url,
            bytes: buffer.length,
            dataUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`,
        });
    }
    return { segments, voice: safeVoice, provider: 'pollinations/openai-audio' };
}

export function getCapabilities() {
    let pool = [];
    try {
        pool = getProviderPoolSummary();
    } catch { }
    const llmKeys = pool.length > 0;
    return {
        text: {
            available: llmKeys,
            providers: pool,
            requires: llmKeys ? [] : ['GROQ_API_KEY / NVIDIA_API_KEY / OPENROUTER_API_KEY (any one or more)'],
        },
        image: {
            available: true,
            providers: ['pollinations/flux', ...(openAiImageConfig() ? [openAiImageConfig().model] : [])],
            requires: [],
        },
        speech: {
            available: true,
            providers: ['pollinations/openai-audio'],
            voices: VOICES,
            requires: [],
        },
        music: {
            available: false,
            requires: ['MUSIC_API_KEY (dedicated music generation provider - not yet integrated)'],
        },
        soundEffects: {
            available: false,
            requires: ['SFX_API_KEY (dedicated sfx provider - not yet integrated)'],
        },
        videoModel: {
            available: false,
            note: 'Text-to-video model providers are not configured. Video is produced by the client-side composition studio: generated scene images + narration + captions rendered to a real video file in your browser.',
            requires: ['VIDEO_MODEL_API_KEY (Runway/Luma-class provider - optional)'],
        },
        codeExecution: {
            available: false,
            note: 'Sandboxed code execution and compilation require a dedicated backend runtime and cannot run on serverless.',
            requires: ['SANDBOX_URL (secure code-execution service - optional)'],
        },
        webApps: {
            available: llmKeys,
            note: 'Single-file interactive web apps generated by the LLM and previewed in a sandboxed iframe.',
            requires: llmKeys ? [] : ['GROQ_API_KEY or NVIDIA_API_KEY'],
        },
        persistence: {
            available: !!process.env.UPSTASH_REDIS_REST_URL,
            requires: process.env.UPSTASH_REDIS_REST_URL ? [] : ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
            note: process.env.UPSTASH_REDIS_REST_URL ? undefined : 'Without Redis, generated artifacts are kept only for the current session.',
        },
    };
}
