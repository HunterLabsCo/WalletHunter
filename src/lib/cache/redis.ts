/**
 * Redis Cache via Upstash
 *
 * Used for:
 * - API response caching (trending coins, wallet data)
 * - Rate limiting per user/IP
 *
 * Falls back gracefully if Redis is not configured.
 */

interface RedisConfig {
  url: string;
  token: string;
}

function getConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redisRequest(
  config: RedisConfig,
  command: string[]
): Promise<unknown> {
  const res = await fetch(`${config.url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    throw new Error(`Redis error: ${res.status}`);
  }

  const data = await res.json();
  return data.result;
}

/**
 * Get a cached value. Returns null if not found or Redis unavailable.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const config = getConfig();
  if (!config) return null;

  try {
    const result = await redisRequest(config, ["GET", key]);
    if (!result || typeof result !== "string") return null;
    return JSON.parse(result) as T;
  } catch {
    return null;
  }
}

/**
 * Set a cached value with TTL in seconds.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const config = getConfig();
  if (!config) return;

  try {
    await redisRequest(config, [
      "SET",
      key,
      JSON.stringify(value),
      "EX",
      ttlSeconds.toString(),
    ]);
  } catch {
    // Silent fail — cache is optional
  }
}

/**
 * Delete a cached key.
 */
export async function cacheDel(key: string): Promise<void> {
  const config = getConfig();
  if (!config) return;

  try {
    await redisRequest(config, ["DEL", key]);
  } catch {
    // Silent fail
  }
}

/**
 * Cache-through helper. Fetches from cache first, falls back to fn().
 */
export async function cacheThrough<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const result = await fn();
  await cacheSet(key, result, ttlSeconds);
  return result;
}
