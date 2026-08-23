export const CONTINUE_MARKER = "\u2402CONTINUE\u2402";
const MAX_AUTO_CONTINUATIONS = 5;

function buildContinuationMessages(apiMessages, accumulated, continuationRound) {
    const tail = accumulated.slice(-800);
    return [
        ...apiMessages,
        {
            role: 'assistant',
            content: accumulated.slice(-2000),
        },
        {
            role: 'user',
            content: `Your previous response was cut off mid-output. Continue EXACTLY where you left off. Do not repeat any content you already produced, do not re-introduce, do not add preambles like "Continuing" — resume the exact sentence/structure mid-flow. This is automatic continuation ${continuationRound} of ${MAX_AUTO_CONTINUATIONS}. Previous output ended with: """${tail}"""`,
        },
    ];
}

export async function streamWithAutoContinue({ endpoint, body, onToken, signal }) {
    let accumulated = '';
    let round = 0;
    let apiMessages = body.messages || [];
    const requestInit = () => ({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, messages: apiMessages }),
        signal,
    });

    while (round <= MAX_AUTO_CONTINUATIONS) {
        const response = await fetch(endpoint, requestInit());
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            const error = new Error(errText || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            const data = await response.json();
            onToken?.(null, data);
            return { text: accumulated, json: data };
        }

        if (round === 0 && !contentType.includes('text/plain')) {
            throw new Error(`Unexpected response type: ${contentType}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let roundText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkText = decoder.decode(value, { stream: true });
            roundText += chunkText;
            onToken?.(chunkText, null);
        }

        accumulated += roundText;
        apiMessages = buildContinuationMessages(body.messages || [], accumulated, round + 1);

        if (roundText.includes(CONTINUE_MARKER)) {
            accumulated = accumulated.replace(CONTINUE_MARKER, '');
            onToken?.('__CONTINUE_ROUND__', null);
            round += 1;
            continue;
        }
        break;
    }

    return { text: accumulated.replace(CONTINUE_MARKER, ''), json: null };
}
