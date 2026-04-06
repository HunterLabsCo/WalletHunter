/**
 * Rate Limiter using Upstash Redis
 *
 * Sliding window rate limiter for API routes.
 * Falls back to in-memory limiter if Redis unavailable.
 */

interface RateLimitConfig {
  /** Maximum number of requests */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// In-memory fallback (per-process, not distributed)
const memoryStore = new Map<string, { count: number; resetAt: number }>();

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redisIncr(
  config: { url: string; token: string },
  key: string,
  windowSeconds: number
): Promise<number> {
  // Use Redis pipeline: INCR + EXPIRE (set TTL only if key is new)
  const res = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, windowSeconds.toString(), "NX"],
    ]),
  });

  if (!res.ok) throw new Error("Redis rate limit error");

  const data = await res.json();
  // Pipeline returns array of results; first is INCR count
  return data[0]?.result ?? 1;
}

/**
 * Check rate limit for a given identifier (userId, IP, etc.)
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = `rl:${identifier}`;
  const now = Math.floor(Date.now() / 1000);

  const redisConfig = getRedisConfig();

  if (redisConfig) {
    try {
      const count = await redisIncr(
        redisConfig,
        key,
        config.windowSeconds
      );
      const allowed = count <= config.limit;
      return {
        allowed,
        remaining: Math.max(0, config.limit - count),
        resetAt: now + config.windowSeconds,
      };
    } catch {
      // Fall through to memory limiter
    }
  }

  // In-memory fallback
  const entry = memoryStore.get(key);
  if (!entry || now >= entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + config.windowSeconds });
    return {
      allowed: true,
      remaining: config.limit - 1,
      resetAt: now + config.windowSeconds,
    };
  }

  entry.count++;
  const allowed = entry.count <= config.limit;
  return {
    allowed,
    remaining: Math.max(0, config.limit - entry.count),
    resetAt: entry.resetAt,
  };
}

// Preset rate limit configs
export const RATE_LIMITS = {
  scanTrigger: { limit: 10, windowSeconds: 60 },
  scanResults: { limit: 30, windowSeconds: 60 },
  walletDetail: { limit: 20, windowSeconds: 60 },
  authLogin: { limit: 5, windowSeconds: 300 },
  authRegister: { limit: 3, windowSeconds: 600 },
} as const;
