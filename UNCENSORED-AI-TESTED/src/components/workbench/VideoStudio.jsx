'use client';

import { useState, useRef, useEffect } from 'react';
import { IoClose } from 'react-icons/io5';

const ASPECT_SIZES = {
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '1:1': [1024, 1024],
    '4:3': [1200, 900],
};

async function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load scene image'));
        img.src = src;
    });
}

async function fetchNarration(text) {
    if (!text || !text.trim()) return null;
    const url = `https://text.pollinations.ai/${encodeURIComponent(text.slice(0, 800))}?model=openai-audio&voice=nova`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Narration unavailable');
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 512) throw new Error('Narration empty');
    return buf;
}

export function VideoStudio({ storyboard, onClose }) {
    const [phase, setPhase] = useState('idle');
    const [statusText, setStatusText] = useState('');
    const [progress, setProgress] = useState(0);
    const [videoUrl, setVideoUrl] = useState(null);
    const [error, setError] = useState(null);
    const previewRef = useRef(null);
    const cancelRef = useRef(false);

    const [w, h] = ASPECT_SIZES[storyboard.aspect] || ASPECT_SIZES['16:9'];

    async function render() {
        setPhase('rendering');
        setError(null);
        setVideoUrl(null);
        cancelRef.current = false;
        try {
            const scenes = storyboard.scenes;
            const images = [];
            const narrations = [];
            for (let i = 0; i < scenes.length; i++) {
                if (cancelRef.current) return;
                setStatusText(`Preparing scene ${i + 1}/${scenes.length}...`);
                setProgress(Math.round((i / (scenes.length * 2)) * 100));
                images.push(await loadImage(scenes[i].loadedUrl));
                try {
                    narrations.push(await fetchNarration(scenes[i].narration));
                } catch {
                    narrations.push(null);
                }
            }

            setStatusText('Mixing narration audio...');
            setProgress(55);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');

            let audioCtx = null;
            let audioDest = null;
            let hasAudio = false;
            try {
                audioCtx = new AudioContext();
                await audioCtx.resume();
                audioDest = audioCtx.createMediaStreamDestination();

                const totalDuration = scenes.reduce((a, s) => a + s.durationSec, 0);
                let cursor = 0;
                for (let i = 0; i < narrations.length; i++) {
                    if (!narrations[i]) continue;
                    const buffer = await audioCtx.decodeAudioData(narrations[i].slice(0));
                    const src = audioCtx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(audioDest);
                    const startAt = Math.min(cursor, Math.max(0, totalDuration - buffer.duration));
                    src.start(startAt);
                    hasAudio = true;
                    cursor += Math.max(buffer.duration + 0.15, scenes[i].durationSec * 0.9);
                }
            } catch {
                hasAudio = false;
            }

            const stream = canvas.captureStream(30);
            if (hasAudio && audioDest) {
                audioDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
            }

            const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
            const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
            const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

            const finished = new Promise((resolve) => { recorder.onstop = resolve; });

            function drawFrame(scene, img, t) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);
                const zoom = 1.06 + 0.08 * t;
                const scale = Math.max(w / img.width, h / img.height) * zoom;
                const dw = img.width * scale;
                const dh = img.height * scale;
                const dx = (w - dw) * t * 0.6;
                const dy = (h - dh) * 0.5;
                ctx.drawImage(img, dx, dy, dw, dh);

                const fadeIn = Math.min(1, t * 8);
                const fadeOut = Math.min(1, (1 - t) * 8);
                ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 0.85 - fadeIn * 0.85)})`;
                ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 0.7 - fadeOut * 0.7)})`;
                ctx.fillRect(0, 0, w, h);

                if (scene.caption) {
                    const fontSize = Math.round(w * 0.036);
                    ctx.font = `600 ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
                    ctx.textAlign = 'center';
                    const maxWidth = w * 0.82;
                    const words = scene.caption.split(' ');
                    const lines = [];
                    let line = '';
                    for (const word of words) {
                        const test = line ? `${line} ${word}` : word;
                        if (ctx.measureText(test).width > maxWidth && line) {
                            lines.push(line);
                            line = word;
                        } else {
                            line = test;
                        }
                    }
                    if (line) lines.push(line);

                    const boxH = lines.length * fontSize * 1.35 + fontSize;
                    const grad = ctx.createLinearGradient(0, h - boxH - fontSize, 0, h);
                    grad.addColorStop(0, 'rgba(0,0,0,0)');
                    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, h - boxH - fontSize, w, boxH + fontSize);

                    ctx.fillStyle = '#fff';
                    ctx.shadowColor = 'rgba(0,0,0,0.9)';
                    ctx.shadowBlur = 8;
                    lines.forEach((l, li) => {
                        const y = h - (lines.length - li - 1) * fontSize * 1.35 - fontSize * 0.8;
                        ctx.fillText(l, w / 2, y);
                    });
                    ctx.shadowBlur = 0;

                    const progressWidth = w * ((t % 1));
                    ctx.fillStyle = 'rgba(255,255,255,0.25)';
                    ctx.fillRect(0, h - 4, w, 4);
                    ctx.fillStyle = 'rgba(139,92,246,0.95)';
                    ctx.fillRect(0, h - 4, progressWidth, 4);
                }
            }

            recorder.start(250);
            const fps = 30;

            for (let i = 0; i < scenes.length; i++) {
                if (cancelRef.current) { recorder.stop(); return; }
                const scene = scenes[i];
                const durationFrames = Math.round(scene.durationSec * fps);
                setStatusText(`Rendering scene ${i + 1}/${scenes.length}...`);
                await new Promise((resolve) => {
                    let frame = 0;
                    const tick = () => {
                        if (cancelRef.current) { resolve(); return; }
                        drawFrame(scene, images[i], frame / durationFrames);
                        frame += 1;
                        const overall = (i * durationFrames + frame) / (scenes.reduce((a, s) => a + s.durationSec, 0) * fps);
                        setProgress(Math.min(99, Math.round(overall * 100)));
                        if (frame <= durationFrames) {
                            requestAnimationFrame(tick);
                        } else {
                            resolve();
                        }
                    };
                    requestAnimationFrame(tick);
                });
            }

            setStatusText('Finalizing video...');
            recorder.stop();
            await finished;
            if (audioCtx) audioCtx.close().catch(() => { });

            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
            setProgress(100);
            setPhase('done');
            setStatusText('');
        } catch (e) {
            setPhase('error');
            setError(e?.message || 'Rendering failed');
        }
    }

    useEffect(() => () => { cancelRef.current = true; }, []);

    if (!storyboard) return null;

    return (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-[#111118] border border-[#2a2a3e]/60 rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a3e]/50">
                    <h3 className="font-semibold text-white">Video Studio — {storyboard.title}</h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#2a2a3e] text-gray-400 hover:text-white"><IoClose size={18} /></button>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto">
                    {!videoUrl && phase !== 'rendering' && (
                        <>
                            <p className="text-sm text-gray-400">
                                Renders {storyboard.scenes.length} generated scenes into a real video file in your browser:
                                Ken Burns motion, captions, and AI narration mixed into the soundtrack.
                                Output: WebM ({w}&times;{h}, 30fps).
                            </p>
                            <button onClick={render} className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium transition-all">
                                Start Render
                            </button>
                        </>
                    )}
                    {phase === 'rendering' && (
                        <div className="space-y-3">
                            <canvas ref={previewRef} width={w} height={h} className="hidden" />
                            <div className="flex items-center gap-2 text-sm text-indigo-300">
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
                                {statusText}
                            </div>
                            <div className="h-2 rounded-full bg-[#1a1a2e] overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-200" style={{ width: `${progress}%` }} />
                            </div>
                            <button onClick={() => { cancelRef.current = true; setPhase('idle'); }} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                        </div>
                    )}
                    {error && <div className="text-sm text-red-400">{error}</div>}
                    {videoUrl && (
                        <div className="space-y-3">
                            <video controls src={videoUrl} className="w-full rounded-xl border border-[#2a2a3e]" />
                            <div className="flex gap-2">
                                <a href={videoUrl} download={`${storyboard.title.replace(/[^a-z0-9-_ ]/gi, '_')}.webm`} className="flex-1 text-center py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium transition-all">Download Video</a>
                                <button onClick={() => { setVideoUrl(null); setPhase('idle'); }} className="px-4 py-3 rounded-xl bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 transition-colors">Re-render</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
