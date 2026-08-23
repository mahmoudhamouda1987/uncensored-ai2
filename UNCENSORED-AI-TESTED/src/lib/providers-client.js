export function imageUrl(prompt, aspect, seed) {
    const dims = {
        '1:1': [1024, 1024], '4:3': [1200, 900], '3:4': [900, 1200],
        '16:9': [1280, 720], '9:16': [720, 1280],
    };
    const [width, height] = dims[aspect] || dims['1:1'];
    const effectiveSeed = typeof seed === 'number' ? seed : Math.floor(Math.random() * 1e9);
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${effectiveSeed}&nologo=true&model=flux`;
}
