import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis = null;
export function getRedis() {
    if (!_redis && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        _redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
    }
    return _redis;
}

let _ratelimit = null;
export function getRateLimiter() {
    if (!_ratelimit && getRedis()) {
        _ratelimit = new Ratelimit({
            redis: getRedis(),
            limiter: Ratelimit.fixedWindow(5, "1 m"),
        });
    }
    return _ratelimit;
}

const DAILY_REQUEST_LIMIT = 200;
const DAILY_REQUEST_WINDOW = 86400;

export async function checkDailyCap(ip) {
    const redis = getRedis();
    if (!redis) return { allowed: true };
    const key = `daily:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, DAILY_REQUEST_WINDOW);
    }
    if (count > DAILY_REQUEST_LIMIT) {
        return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: DAILY_REQUEST_LIMIT - count };
}

function isLoopbackHost(hostname) {
    if (!hostname) return false;
    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '::1'
        || hostname === '[::1]';
}

export function isLocalRequest(request) {
    const url = new URL(request.url);
    const hostHeader = request.headers.get('host');
    const originHeader = request.headers.get('origin');
    const forwardedHost = request.headers.get('x-forwarded-host');

    const candidates = [url.hostname, hostHeader, forwardedHost]
        .flatMap((value) => (value ? value.split(',') : []))
        .map((value) => value.trim())
        .map((value) => {
            if (value.startsWith('[')) {
                return value.slice(1, value.indexOf(']') > -1 ? value.indexOf(']') : undefined);
            }
            const lastColon = value.lastIndexOf(':');
            if (lastColon > -1 && value.indexOf(':') === lastColon) {
                return value.slice(0, lastColon);
            }
            return value;
        });

    for (const candidate of candidates) {
        if (isLoopbackHost(candidate)) return true;
    }

    if (originHeader) {
        try {
            const originHost = new URL(originHeader).hostname;
            if (isLoopbackHost(originHost)) return true;
        } catch { }
    }

    return false;
}

export function getClientIp(request) {
    return (
        request.headers.get("cf-connecting-ip") ||
        (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        "unknown"
    );
}

export async function enforceLimits(request) {
    const ratelimit = getRateLimiter();
    if (!ratelimit || isLocalRequest(request)) {
        return { ok: true, ip: getClientIp(request), headers: {} };
    }
    const ip = getClientIp(request);
    const rlResult = await ratelimit.limit(ip);
    if (!rlResult.success) {
        return { ok: false, status: 429, message: "You're sending messages too fast! Please wait a moment before trying again." };
    }
    const dailyCap = await checkDailyCap(ip);
    if (!dailyCap.allowed) {
        return { ok: false, status: 429, message: "You've reached your daily limit. Come back tomorrow for more conversations!" };
    }
    return {
        ok: true,
        ip,
        headers: {
            "X-RateLimit-IP": ip,
            "X-RateLimit-Remaining": String(rlResult.remaining),
        },
    };
}

export async function verifyClient(request, turnstileToken) {
    if (!process.env.TURNSTILE_SECRET_KEY || isLocalRequest(request)) {
        return { ok: true, newSessionId: null };
    }
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('cf_verified')?.value;
    let isVerified = false;

    if (sessionId) {
        const redis = getRedis();
        if (redis) {
            const valid = await redis.get(`session:${sessionId}`);
            if (valid) isVerified = true;
        }
    }

    if (isVerified) return { ok: true, newSessionId: null };

    if (!turnstileToken) {
        return { ok: false, status: 403, message: "Verification required. Please wait for the security check to complete." };
    }

    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${process.env.TURNSTILE_SECRET_KEY}&response=${turnstileToken}`,
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
        return { ok: false, status: 403, message: "Verification failed. Please refresh the page and try again." };
    }

    const newSessionId = crypto.randomUUID();
    const redis = getRedis();
    if (redis) {
        await redis.set(`session:${newSessionId}`, "1", { ex: 3600 });
    }
    return { ok: true, newSessionId };
}

const ARTIFACT_TTL_SECONDS = 7 * 24 * 3600;

export async function saveArtifact(userId, artifact) {
    const redis = getRedis();
    if (!redis) return { persisted: false };
    try {
        await redis.set(`artifact:${artifact.id}`, JSON.stringify(artifact), { ex: ARTIFACT_TTL_SECONDS });
        await redis.lpush(`project:${userId}`, artifact.id);
        await redis.ltrim(`project:${userId}`, 0, 199);
        await redis.expire(`project:${userId}`, ARTIFACT_TTL_SECONDS);
        return { persisted: true };
    } catch {
        return { persisted: false };
    }
}

export async function loadArtifacts(userId) {
    const redis = getRedis();
    if (!redis) return { persisted: false, artifacts: [] };
    try {
        const ids = await redis.lrange(`project:${userId}`, 0, 49);
        if (!ids || ids.length === 0) return { persisted: true, artifacts: [] };
        const raw = await Promise.all(ids.map((id) => redis.get(`artifact:${id}`)));
        const artifacts = raw.filter(Boolean).map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
        return { persisted: true, artifacts };
    } catch {
        return { persisted: true, artifacts: [] };
    }
}

export async function deleteArtifact(id) {
    const redis = getRedis();
    if (!redis) return false;
    try {
        await redis.del(`artifact:${id}`);
        return true;
    } catch {
        return false;
    }
}

export function isRateLimitError(e) {
    return e?.status === 429
        || e?.error?.code === 'rate_limit_exceeded'
        || e?.message?.includes('429')
        || e?.message?.toLowerCase().includes('rate limit')
        || e?.message?.toLowerCase().includes('rate_limit');
}

export function isDailyTokenQuotaError(e) {
    const message = String(e?.message || '').toLowerCase();
    return isRateLimitError(e)
        && (message.includes('tokens per day') || message.includes(' tpd') || message.includes('(tpd)'));
}
