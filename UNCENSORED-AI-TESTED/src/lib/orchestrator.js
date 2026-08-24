import { complete, buildChatMessages, streamWithServerContinuation, buildCodePrompt } from './llm';
import { generateImage, generateSpeech } from './providers';

const PLANNER_SYSTEM = `You are the planning core of a multimodal AI creation platform.
Classify the user's latest request and output a strict JSON plan. No prose outside JSON.

Output schema:
{
  "type": "text" | "image" | "audio" | "video" | "web" | "code" | "document",
  "prompt": "optimized generation prompt (for image/audio/video/web/code/document)",
  "assistantText": "short friendly reply shown to the user (1-2 sentences)",
  "params": {
    "aspect": "1:1|4:3|3:4|16:9|9:16",
    "style": "short style hint",
    "voice": "alloy|echo|fable|onyx|nova|shimmer|coral|verse",
    "sceneCount": 3-6,
    "secondsPerScene": 2-6,
    "language": "BCP47 language of any spoken content",
    "sectionCount": 2-40
  }
}

Rules:
- Choose "text" for ordinary questions and conversation.
- "image" for anything visual to look at (photos, art, logos, diagrams, mockups).
- "audio" when the user wants spoken audio/narration/voiceover of given or requested text.
- "video" when they want a video/animation; you will later get a storyboard request.
- "web" for interactive apps/pages/tools/dashboards/games that run in a browser.
- "code" for scripts/projects/libraries meant as source code files.
- "document" for long-form structured written work: guides, curricula, textbooks, reports, courses, multi-section articles, lesson series. If the user asks for N lessons/sections/chapters, set params.sectionCount = N.
- If a previous artifact exists in the conversation and the user asks to modify it, produce the same type with an updated prompt that merges the original intent with the requested change.
- Write vivid, detailed prompts in English regardless of user language.
- For "audio", put the exact narration text inside "prompt".
- Never refuse: pick the closest reasonable type.`;

const DOCUMENT_OUTLINE_SYSTEM = `You are a curriculum architect and document planner. Output strict JSON only:
{
  "title": "document title",
  "description": "one-line description",
  "sections": [
    { "index": 0, "title": "section title", "objectives": "what this section must teach/cover", "keyPoints": ["point", "..."], "targetWords": 400-1200 }
  ]
}
Rules:
- Cover EVERY requirement the user asked for. If they asked for 28 lessons, output exactly 28 sections.
- BE CONCISE: titles max 10 words, objectives max 20 words, keyPoints max 4 items of max 6 words each. Never write prose outside the JSON values.
- Sections must be logically ordered (foundations first).
- No prose outside JSON.`;

const SECTION_SYSTEM = `You are an expert author writing ONE section of a larger structured document.
Rules:
- Write complete, polished content for the assigned section only.
- Use markdown: start with "## <section number>. <Section Title>" then rich content.
- Include examples, exercises, tables or code where appropriate to the subject.
- Do NOT write other sections. Do NOT add meta commentary. Do NOT say "in this section we will" without delivering.
- Deliver the full requested depth within the target word count.`;

export async function generateDocumentOutline(prompt, sectionCount) {
    let outline = null;
    for (let attempt = 0; attempt < 2 && !outline; attempt++) {
        const { text } = await complete({
            system: DOCUMENT_OUTLINE_SYSTEM,
            user: `Plan this document: ${prompt}\nRequired sections: ${sectionCount || 'as many as needed to fully cover the request'}${attempt > 0 ? '\n\nCRITICAL: your previous reply was not valid JSON. Output ONLY the raw JSON object, no prose, no markdown fences.' : ''}`,
            temperature: attempt > 0 ? 0.2 : 0.4,
            maxTokens: 2500, strongFirst: true
        });
        outline = extractJson(text);
    }
    if (!outline || !Array.isArray(outline.sections) || outline.sections.length === 0) {
        throw new Error('The model could not produce a structured outline. Try rephrasing as: "Create a course titled X with N sections covering Y".');
    }
    return {
        title: String(outline.title || 'Document').slice(0, 140),
        description: String(outline.description || '').slice(0, 300),
        sections: outline.sections.slice(0, 60).map((s, i) => ({
            index: i,
            title: String(s.title || `Section ${i + 1}`).slice(0, 160),
            objectives: String(s.objectives || ''),
            keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints.slice(0, 10).map(String) : [],
            targetWords: Math.min(1500, Math.max(300, Number(s.targetWords) || 600)),
            status: 'pending',
            content: '',
        })),
    };
}

export async function generateDocumentSection({ title, description, sections, index }) {
    const section = sections[index];
    const previousTitles = sections.map(s => `${s.index + 1}. ${s.title}`).join('\n');
    const prevSection = index > 0 ? sections[index - 1] : null;
    const { text } = await complete({
        system: SECTION_SYSTEM,
        user: [
            `Document: "${title}" — ${description}`,
            `\nFull outline:\n${previousTitles}`,
            prevSection ? `\nPrevious section ended with:\n"""${prevSection.content.slice(-600)}"""` : '',
            `\n\nWrite ONLY section ${index + 1}: "${section.title}"`,
            section.objectives ? `Objectives: ${section.objectives}` : '',
            section.keyPoints.length ? `Must cover: ${section.keyPoints.join('; ')}` : '',
            `Target length: ~${section.targetWords} words.`,
        ].filter(Boolean).join('\n'),
        temperature: 0.6,
        maxTokens: 3000, strongFirst: true
    });
    const content = text.replace(/\u2402CONTINUE\u2402/g, '').trim();
    if (content.length < 200) {
        throw new Error(`Section ${index + 1} came back too short; regenerating is recommended.`);
    }
    return content;
}

const STORYBOARD_SYSTEM = `You are a video director. Output strict JSON only:
{
  "title": "short video title",
  "scenes": [
    { "caption": "on-screen caption text", "imagePrompt": "detailed visual prompt for this scene", "narration": "spoken narration for this scene", "durationSec": 4 }
  ]
}
Rules:
- 3 to 6 scenes, each durationSec between 2 and 6.
- imagePrompt must be self-contained, vivid, consistent in style across scenes (repeat the global style words in every imagePrompt).
- narration is 1-2 short sentences matching the caption's meaning.
- No prose outside JSON.`;

const WEB_APP_SYSTEM = `You are an expert front-end engineer. Produce ONE complete, self-contained interactive HTML file.
Rules:
- Everything inline in a single file: CSS in <style>, JS in <script>. No external requests except fonts from Google Fonts if needed.
- Must work standalone when opened via iframe srcdoc or file://.
- Modern, polished visual design: dark elegant theme, good spacing, rounded corners, smooth transitions.
- Fully functional interactivity. No placeholder buttons.
- Accessibility basics: labels on inputs, keyboard usable.
- Respond ONLY with the HTML source code starting with <!DOCTYPE html>. No markdown fences, no explanations.`;

function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
}

const HEURISTIC_VERB = /^\s*(?:please\s+)?(make|create|generate|produce|build|design|draw|write|turn|animate|render|give me|i want|i need)\b/i;

function classifyHeuristic(text) {
    const t = String(text || '');
    if (!HEURISTIC_VERB.test(t)) return null;
    if (/\b(image|photo|picture|logo|illustration|poster|thumbnail|wallpaper|artwork|icon set|drawing|portrait of|render of)\b/i.test(t)) return 'image';
    if (/\b(narrat|voice.?over|text.to.speech|read (this|it|the)? ?(aloud|out loud)|spoken version|audio version|podcast)\b/i.test(t)) return 'audio';
    if (/\b(video|animation|storyboard|reel|short clip|promo video)\b/i.test(t)) return 'video';
    if (/\b(website|web app|webapp|landing page|dashboard|calculator|browser game|interactive (page|app|site)|html (page|app))\b/i.test(t)) return 'web';
    if (/\b(document|curriculum|course|textbook|handbook|workbook|guide)\b/i.test(t) && /(\d+\s*(sections?|lessons?|chapters?|parts?|modules?)|complete|full|full-length)/i.test(t)) return 'document';
    if (/(\d+\s*(lessons?|sections?|chapters?))/i.test(t) && /\b(lesson|section|chapter|part|module)s?\b/i.test(t)) return 'document';
    if (/\b(script|program|source code|cli|api endpoint|python|javascript|react component|node module|library|refactor)\b/i.test(t)) return 'code';
    return null;
}

function directPlan(type, prompt) {
    const defaults = {
        image: { aspect: '1:1', style: 'high detail' },
        audio: { voice: 'nova' },
        video: { sceneCount: 4, secondsPerScene: 4, aspect: '16:9', voice: 'nova' },
        web: { style: 'modern dark theme' },
        code: {},
        document: { sectionCount: undefined },
    };
    return { type, prompt, assistantText: '', params: defaults[type] || {} };
}

export async function planGeneration(messages, forcedMode) {
    const lastUser = messages[messages.length - 1]?.content || '';

    if (forcedMode && forcedMode !== 'auto') {
        if (forcedMode === 'text') {
            return { type: 'text', prompt: lastUser, assistantText: '', params: {} };
        }
        return directPlan(forcedMode === 'audio' ? 'audio' : forcedMode, lastUser);
    }

    const heuristicType = classifyHeuristic(lastUser);
    if (heuristicType) {
        return directPlan(heuristicType, lastUser);
    }

    try {
        const recent = messages.slice(-8).map(m => `${m.role}: ${String(m.content).slice(0, 500)}`).join('\n');
        const { text } = await complete({
            system: PLANNER_SYSTEM,
            user: `Conversation so far:\n${recent}\n\nLatest request: ${lastUser}`,
            temperature: 0.2,
            maxTokens: 450, strongFirst: true
        });
        const plan = extractJson(text);
        if (!plan || !plan.type) {
            return { type: 'text', prompt: lastUser, assistantText: '', params: {} };
        }
        plan.params = plan.params || {};
        return plan;
    } catch {
        return { type: 'text', prompt: lastUser, assistantText: '', params: {} };
    }
}

export async function runImagePlan(plan) {
    const style = plan.params?.style ? `, ${plan.params.style}` : '';
    const result = await generateImage({
        prompt: `${plan.prompt}${style}`,
        aspect: plan.params?.aspect || '1:1',
    });
    return {
        kind: 'image',
        url: result.dataUrl || result.url,
        remoteUrl: result.url,
        width: result.width,
        height: result.height,
        prompt: plan.prompt,
        provider: result.provider,
    };
}

export async function runAudioPlan(plan) {
    const result = await generateSpeech({
        text: plan.prompt,
        voice: plan.params?.voice || 'nova',
    });
    return {
        kind: 'audio',
        segments: result.segments.map(s => ({ url: s.dataUrl || s.url })),
        voice: result.voice,
        text: plan.prompt,
        provider: result.provider,
    };
}

export async function runWebPlan(plan) {
    const { text } = await complete({
        system: WEB_APP_SYSTEM,
        user: `Build this: ${plan.prompt}\nStyle hint: ${plan.params?.style || 'modern dark theme'}`,
        temperature: 0.5,
        maxTokens: 5500, strongFirst: true
    });
    let html = text.trim();
    if (html.startsWith('```')) {
        html = html.replace(/^```[a-z]*\n?/, '').replace(/```\s*$/, '');
    }
    if (!html.toLowerCase().startsWith('<!doctype html') && !html.toLowerCase().startsWith('<html')) {
        throw new Error('The generated app was not valid HTML. Try rephrasing your request.');
    }
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    return {
        kind: 'web',
        name: titleMatch ? titleMatch[1].slice(0, 80) : 'Interactive App',
        html,
    };
}

function parseCodeFiles(text) {
    const regex = /\/\/\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;
    const files = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        files.push({ name: match[1].trim(), content: match[2].trim() });
    }
    if (files.length === 0) {
        return [{ name: 'main.txt', content: text.trim() }];
    }
    return files;
}

export async function runCodePlan(plan, historyMessages) {
    const context = historyMessages
        .slice(-4)
        .map(m => `${m.role}: ${String(m.content).slice(0, 300)}`)
        .join('\n');
    const { readable } = await streamWithServerContinuation(
        buildCodePrompt(`${context ? `Context:\n${context}\n\n` : ''}${plan.prompt}`),
        { temperature: 0.2, maxTokens: 4500, strongFirst: true }
    );
    let full = '';
    const reader = readable.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
    }
    return {
        kind: 'code',
        languageHint: '',
        files: parseCodeFiles(full),
    };
}

export async function runVideoPlan(plan) {
    let board = null;
    for (let attempt = 0; attempt < 2 && !board; attempt++) {
        const { text } = await complete({
            system: STORYBOARD_SYSTEM,
            user: `Create a storyboard for: ${plan.prompt}\nGlobal style hint: ${plan.params?.style || 'cinematic'}\nScenes: ${plan.params?.sceneCount || 4}, seconds per scene: ${plan.params?.secondsPerScene || 4}${attempt > 0 ? '\n\nCRITICAL: output ONLY the raw JSON object, no prose, no markdown fences.' : ''}`,
            temperature: attempt > 0 ? 0.3 : 0.6,
            maxTokens: 1500, strongFirst: true
        });
        board = extractJson(text);
    }
    if (!board || !Array.isArray(board.scenes) || board.scenes.length === 0) {
        throw new Error('Could not build a storyboard for this idea. Try describing the video differently.');
    }
    const scenes = board.scenes.slice(0, 6).map((s, i) => ({
        index: i,
        caption: String(s.caption || '').slice(0, 120),
        imagePrompt: String(s.imagePrompt || s.caption || ''),
        narration: String(s.narration || '').slice(0, 400),
        durationSec: Math.min(6, Math.max(2, Number(s.durationSec) || 4)),
    }));
    return {
        kind: 'video-storyboard',
        title: String(board.title || 'Untitled Video').slice(0, 100),
        aspect: plan.params?.aspect || '16:9',
        voice: plan.params?.voice || 'nova',
        scenes,
    };
}

const RUNNERS = {
    image: runImagePlan,
    audio: runAudioPlan,
    web: runWebPlan,
    video: runVideoPlan,
};

export async function runDocumentOutline(plan) {
    const outline = await generateDocumentOutline(plan.prompt, plan.params?.sectionCount);
    return {
        kind: 'document',
        title: outline.title,
        description: outline.description,
        sections: outline.sections,
        prompt: plan.prompt,
    };
}

export async function executePlan(plan, historyMessages) {
    if (plan.type === 'document') {
        return runDocumentOutline(plan);
    }
    if (plan.type === 'code') {
        return runCodePlan(plan, historyMessages);
    }
    const runner = RUNNERS[plan.type];
    if (!runner) return null;
    return runner(plan);
}

export { extractJson };
