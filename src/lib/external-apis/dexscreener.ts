/**
 * DexScreener client
 *
 * Trending coins: fetched via WebSocket (same feed that powers the website).
 * The WebSocket returns a custom binary format with 512-byte pair chunks.
 * Falls back to REST API if WebSocket fails.
 *
 * Binary protocol reverse-engineered from:
 * https://github.com/itsdarkerinnit/dexscraper
 */

const DEXSCREENER_BASE = "https://api.dexscreener.com";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrendingCoin {
  tokenAddress: string;
  symbol: string;
  name: string;
  pairAddress: string;
  volume24h: number;
  liquidity: number;
  fdv: number;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  volume: { h24: number; h6: number; h1: number };
  liquidity: { usd: number };
  fdv: number;
  pairCreatedAt?: number;
}

// ─── Binary Decoder ─────────────────────────────────────────────────────────

/** Sanitize a float, filtering NaN/Inf. */
function handleDouble(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

/** Remove non-printable chars and junk after @ or \\. */
function cleanString(s: string): string {
  if (!s) return "";
  let cleaned = "";
  for (const c of s) {
    const code = c.charCodeAt(0);
    if ((code >= 32 && code < 127) || code === 9) cleaned += c;
  }
  const atIdx = cleaned.indexOf("@");
  if (atIdx !== -1) cleaned = cleaned.slice(0, atIdx);
  const bsIdx = cleaned.indexOf("\\");
  if (bsIdx !== -1) cleaned = cleaned.slice(0, bsIdx);
  return cleaned.trim();
}

interface DecodedPair {
  chain: string;
  protocol: string;
  pairAddress: string;
  baseTokenName: string;
  baseTokenSymbol: string;
  baseTokenAddress: string;
  price: number;
  priceUsd: number;
  priceChangeH24: number;
  liquidityUsd: number;
  volumeH24: number;
  fdv: number;
  pairCreatedAt: number;
}

/**
 * Decode 8 little-endian doubles (64 bytes) starting at `startPos`.
 * Fields: price, priceUsd, priceChangeH24, liquidityUsd, volumeH24, fdv, timestamp, (unused)
 */
function decodeMetrics(
  data: Buffer,
  startPos: number
): { metrics: Partial<DecodedPair>; endPos: number } {
  if (startPos + 64 > data.length) {
    return { metrics: {}, endPos: startPos };
  }

  const metrics: Partial<DecodedPair> = {};
  const dv = new DataView(
    data.buffer,
    data.byteOffset + startPos,
    64
  );

  const price = handleDouble(dv.getFloat64(0, true));
  const priceUsd = handleDouble(dv.getFloat64(8, true));
  const priceChangeH24 = handleDouble(dv.getFloat64(16, true));
  const liquidityUsd = handleDouble(dv.getFloat64(24, true));
  const volumeH24 = handleDouble(dv.getFloat64(32, true));
  const fdv = handleDouble(dv.getFloat64(40, true));
  const timestamp = handleDouble(dv.getFloat64(48, true));

  if (price) metrics.price = price;
  if (priceUsd) metrics.priceUsd = priceUsd;
  if (priceChangeH24) metrics.priceChangeH24 = priceChangeH24;
  if (liquidityUsd) metrics.liquidityUsd = liquidityUsd;
  if (volumeH24) metrics.volumeH24 = volumeH24;
  if (fdv) metrics.fdv = fdv;
  if (timestamp > 0 && timestamp < 4102444800) {
    metrics.pairCreatedAt = Math.floor(timestamp);
  }

  return { metrics, endPos: startPos + 64 };
}

/**
 * Decode a single trading pair from a 512-byte binary chunk.
 *
 * Format:
 * 1. Skip leading 0x00 / 0x0A bytes
 * 2. Read 6 length-prefixed strings: chain, protocol, pairAddress,
 *    baseTokenName, baseTokenSymbol, baseTokenAddress
 * 3. Align to 8-byte boundary
 * 4. Read 64 bytes = 8 doubles (metrics)
 */
function decodePair(data: Buffer): DecodedPair | null {
  try {
    let pos = 0;

    // Skip leading zero/newline bytes
    while (pos < data.length && (data[pos] === 0x00 || data[pos] === 0x0a)) {
      pos++;
    }

    const fieldNames = [
      "chain",
      "protocol",
      "pairAddress",
      "baseTokenName",
      "baseTokenSymbol",
      "baseTokenAddress",
    ] as const;

    const fields: Record<string, string> = {};

    for (const field of fieldNames) {
      if (pos >= data.length) break;

      const strLen = data[pos];
      pos++;

      if (strLen === 0 || strLen > 100 || pos + strLen > data.length) continue;

      const value = cleanString(data.subarray(pos, pos + strLen).toString("utf8"));
      if (value) fields[field] = value;
      pos += strLen;
    }

    // Align to 8-byte boundary
    pos = (pos + 7) & ~7;

    const { metrics } = decodeMetrics(data, pos);

    const pair: DecodedPair = {
      chain: fields.chain ?? "",
      protocol: fields.protocol ?? "",
      pairAddress: fields.pairAddress ?? "",
      baseTokenName: fields.baseTokenName ?? "",
      baseTokenSymbol: fields.baseTokenSymbol ?? "",
      baseTokenAddress: fields.baseTokenAddress ?? "",
      price: metrics.price ?? 0,
      priceUsd: metrics.priceUsd ?? 0,
      priceChangeH24: metrics.priceChangeH24 ?? 0,
      liquidityUsd: metrics.liquidityUsd ?? 0,
      volumeH24: metrics.volumeH24 ?? 0,
      fdv: metrics.fdv ?? 0,
      pairCreatedAt: metrics.pairCreatedAt ?? 0,
    };

    // Validate: must have at least chain + some non-zero metric
    if (
      !pair.chain ||
      !pair.baseTokenAddress ||
      (pair.price === 0 && pair.priceUsd === 0 && pair.volumeH24 === 0)
    ) {
      return null;
    }

    return pair;
  } catch {
    return null;
  }
}

/**
 * Decode all pairs from a binary WebSocket message.
 *
 * Protocol:
 * - Message starts with \x00\n1.3.0\n (version header)
 * - Contains a "pairs" marker
 * - After the marker: 512-byte chunks, each containing one pair
 */
function decodeBinaryMessage(message: Buffer): DecodedPair[] {
  // Version check
  const versionPrefix = Buffer.from("\x00\n1.3.0\n", "utf8");
  if (!message.subarray(0, versionPrefix.length).equals(versionPrefix)) {
    return [];
  }

  // Find "pairs" marker
  const pairsMarker = Buffer.from("pairs", "utf8");
  const pairsStart = message.indexOf(pairsMarker);
  if (pairsStart === -1) return [];

  const pairs: DecodedPair[] = [];
  let pos = pairsStart + pairsMarker.length;
  const CHUNK_SIZE = 512;

  while (pos + CHUNK_SIZE <= message.length) {
    const chunk = message.subarray(pos, pos + CHUNK_SIZE);
    const pair = decodePair(chunk);
    if (pair) pairs.push(pair);
    pos += CHUNK_SIZE;
  }

  return pairs;
}

// ─── WebSocket Trending Fetcher ─────────────────────────────────────────────

const WS_URL =
  "wss://io.dexscreener.com/dex/screener/v4/pairs/h24/1" +
  "?rankBy%5Bkey%5D=trendingScoreH6&rankBy%5Border%5D=desc" +
  "&filters%5BchainIds%5D%5B0%5D=solana";

/**
 * Connect to the DexScreener WebSocket, receive the first data message,
 * decode it, and return the top 3 trending Solana pairs.
 *
 * Designed for serverless: opens → receives one message → closes.
 * Times out after 10 seconds.
 */
async function fetchTrendingViaWebSocket(): Promise<DecodedPair[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("DexScreener WebSocket timed out after 10s"));
    }, 10_000);

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      console.log("[DexScreener] WebSocket connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        // Handle text ping
        if (typeof event.data === "string") {
          if (event.data === "ping") {
            ws.send("pong");
          }
          return;
        }

        // Binary message
        const buffer = Buffer.from(event.data as ArrayBuffer);
        const pairs = decodeBinaryMessage(buffer);

        if (pairs.length > 0) {
          clearTimeout(timeout);
          ws.close();
          resolve(pairs);
        }
      } catch (err) {
        console.error("[DexScreener] Error processing WebSocket message:", err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(new Error(`DexScreener WebSocket error: ${err}`));
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      // If we haven't resolved yet, the connection closed prematurely
    };
  });
}

// ─── REST API Fallback ──────────────────────────────────────────────────────

// Tokens that are NOT interesting as trending candidates.
// When one of these is the base token, we want the OTHER side of the pair.
const SKIP_TOKENS = new Set([
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
]);

/**
 * Extract a TrendingCoin from a raw DexScreener pair object.
 * Picks the "interesting" token — skips SOL/USDC/USDT.
 */
function pairToTrendingCoin(p: Record<string, unknown>): TrendingCoin | null {
  const base = p.baseToken as Record<string, unknown> | undefined;
  const quote = p.quoteToken as Record<string, unknown> | undefined;
  if (!base?.address || !quote?.address) return null;

  // Pick the interesting token: if base is SOL/USDC/USDT, use quote instead
  let token = base;
  if (SKIP_TOKENS.has(base.address as string) && !SKIP_TOKENS.has(quote.address as string)) {
    token = quote;
  }

  if (!token?.symbol) return null;

  // Volume can be nested (v2: { h24 }) or flat (v1: volume24h, volumeH24)
  const vol = p.volume as Record<string, number> | undefined;
  const volume24h = vol?.h24 ?? (p as Record<string, number>).volume24h ?? 0;

  // Liquidity can be nested or flat
  const liq = p.liquidity as Record<string, number> | undefined;
  const liquidity = liq?.usd ?? (p as Record<string, number>).liquidityUsd ?? 0;

  return {
    tokenAddress: token.address as string,
    symbol: token.symbol as string,
    name: (token.name as string) ?? (token.symbol as string),
    pairAddress: (p.pairAddress as string) ?? "",
    volume24h,
    liquidity,
    fdv: (p.fdv as number) ?? 0,
  };
}

/**
 * Fallback: fetch REAL trending Solana tokens via GeckoTerminal REST API.
 *
 * GeckoTerminal (by CoinGecko) provides a free trending pools endpoint
 * that returns actually trending pairs — not boosted/paid tokens.
 * This is the closest REST equivalent to DexScreener's WebSocket trending.
 */
async function fetchTrendingViaRest(): Promise<TrendingCoin[]> {
  console.log("[DexScreener] Using GeckoTerminal trending pools (REST fallback)");

  const res = await fetch(
    "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1",
    { headers: { Accept: "application/json" } }
  );

  if (!res.ok) {
    throw new Error(`GeckoTerminal trending API failed: ${res.status}`);
  }

  const json = await res.json();
  const pools: Array<Record<string, unknown>> = json?.data ?? [];
  console.log(`[GeckoTerminal] Trending returned ${pools.length} pools`);

  const coins: TrendingCoin[] = [];
  const seenTokens = new Set<string>();

  for (const pool of pools) {
    const attrs = pool.attributes as Record<string, unknown> | undefined;
    const rels = pool.relationships as Record<string, unknown> | undefined;
    if (!attrs || !rels) continue;

    // Extract base and quote token addresses
    const baseData = (rels.base_token as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const quoteData = (rels.quote_token as Record<string, unknown>)?.data as Record<string, unknown> | undefined;

    // Token IDs come as "solana_<address>"
    const baseId = (baseData?.id as string) ?? "";
    const quoteId = (quoteData?.id as string) ?? "";
    const baseAddr = baseId.replace("solana_", "");
    const quoteAddr = quoteId.replace("solana_", "");

    // Pick the interesting token (not SOL/USDC/USDT)
    let tokenAddr = baseAddr;
    if (SKIP_TOKENS.has(baseAddr)) {
      if (SKIP_TOKENS.has(quoteAddr)) continue; // Both boring, skip
      tokenAddr = quoteAddr;
    }

    if (seenTokens.has(tokenAddr)) continue;
    seenTokens.add(tokenAddr);

    // Parse name — format is usually "TOKEN / SOL"
    const poolName = (attrs.name as string) ?? "";
    const tokenSymbol = poolName.split(/\s*\/\s*/)[SKIP_TOKENS.has(baseAddr) ? 1 : 0] ?? poolName;

    const volObj = attrs.volume_usd as Record<string, string> | undefined;
    const volume24h = parseFloat(volObj?.h24 ?? "0") || 0;
    const liquidity = parseFloat((attrs.reserve_in_usd as string) ?? "0") || 0;
    const fdv = parseFloat((attrs.fdv_usd as string) ?? "0") || 0;

    if (liquidity < 50_000) continue; // Skip low-liquidity pairs

    coins.push({
      tokenAddress: tokenAddr,
      symbol: tokenSymbol,
      name: tokenSymbol,
      pairAddress: (attrs.address as string) ?? "",
      volume24h,
      liquidity,
      fdv,
    });

    console.log(`[GeckoTerminal] Trending: ${tokenSymbol} (${tokenAddr.slice(0, 8)}…) vol=$${Math.round(volume24h).toLocaleString()}`);

    if (coins.length >= 3) break;
  }

  console.log(
    `[GeckoTerminal] Found ${coins.length} trending coins:`,
    coins.map((c) => c.symbol).join(", ")
  );
  return coins;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch top 3 trending Solana coins.
 *
 * Primary: DexScreener WebSocket (real trending scores).
 * Fallback: REST API (volume-sorted, less accurate).
 */
export async function fetchTrendingCoins(): Promise<TrendingCoin[]> {
  try {
    const pairs = await fetchTrendingViaWebSocket();

    // Already filtered to Solana by the URL params.
    // Take top 3 (they arrive ranked by trendingScoreH6 desc).
    return pairs.slice(0, 3).map((p) => ({
      tokenAddress: p.baseTokenAddress,
      symbol: p.baseTokenSymbol,
      name: p.baseTokenName,
      pairAddress: p.pairAddress,
      volume24h: p.volumeH24,
      liquidity: p.liquidityUsd,
      fdv: p.fdv,
    }));
  } catch (err) {
    console.error("[DexScreener] WebSocket failed, falling back to REST:", err);
    return fetchTrendingViaRest();
  }
}

/**
 * Fetch pair details for a token address.
 * Used to get current pair data (liquidity, volume, etc.)
 */
export async function fetchPairDetails(
  tokenAddress: string
): Promise<DexScreenerPair | null> {
  const res = await fetch(
    `${DEXSCREENER_BASE}/tokens/v1/solana/${tokenAddress}`,
    { headers: { Accept: "application/json" }, next: { revalidate: 0 } }
  );

  if (!res.ok) return null;

  const data = await res.json();
  const pairs: DexScreenerPair[] = Array.isArray(data)
    ? data
    : data.pairs ?? [];

  if (!pairs.length) return null;

  return pairs.sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
  )[0];
}
