/**
 * DexScreener API client
 * Docs: https://docs.dexscreener.com/api/reference
 * Rate limit: 300 req/min (no auth required)
 */

const DEXSCREENER_BASE = "https://api.dexscreener.com";

export interface DexScreenerToken {
  address: string;
  name: string;
  symbol: string;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: DexScreenerToken;
  quoteToken: DexScreenerToken;
  priceUsd: string;
  volume: { h24: number; h6: number; h1: number };
  liquidity: { usd: number };
  fdv: number;
  pairCreatedAt?: number;
}

export interface TrendingCoin {
  tokenAddress: string;
  symbol: string;
  name: string;
  pairAddress: string;
  volume24h: number;
  liquidity: number;
  fdv: number;
}

export interface TopTrader {
  walletAddress: string;
  realizedPnl: number;
  amountBought: number;
  pnlRatio: number;
}

/**
 * Fetch top 3 trending Solana coins by 24h volume
 */
export async function fetchTrendingCoins(): Promise<TrendingCoin[]> {
  const url = `${DEXSCREENER_BASE}/token-profiles/latest/v1`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(
      `DexScreener trending fetch failed: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();

  // Filter to Solana tokens only, sort by volume
  const solanaPairs: TrendingCoin[] = [];

  // DexScreener profiles endpoint returns latest promoted tokens
  // We also query the boosted/trending endpoint for volume-based trending
  const boostRes = await fetch(
    `${DEXSCREENER_BASE}/token-boosts/top/v1`,
    { headers: { Accept: "application/json" }, next: { revalidate: 0 } }
  );

  if (!boostRes.ok) {
    throw new Error(
      `DexScreener boost fetch failed: ${boostRes.status} ${boostRes.statusText}`
    );
  }

  const boostData = await boostRes.json();
  const tokens = Array.isArray(boostData) ? boostData : [];

  // Filter to Solana and get pair details
  const solTokens = tokens
    .filter((t: { chainId?: string }) => t.chainId === "solana")
    .slice(0, 10);

  for (const token of solTokens) {
    if (!token.tokenAddress) continue;

    const pairRes = await fetch(
      `${DEXSCREENER_BASE}/tokens/v1/solana/${token.tokenAddress}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 0 } }
    );

    if (!pairRes.ok) continue;

    const pairData = await pairRes.json();
    const pairs: DexScreenerPair[] = Array.isArray(pairData) ? pairData : pairData.pairs ?? [];

    if (!pairs.length) continue;

    // Pick highest liquidity pair
    const best = pairs
      .filter((p) => p.chainId === "solana")
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    if (!best || (best.liquidity?.usd ?? 0) < 50_000) continue;

    solanaPairs.push({
      tokenAddress: token.tokenAddress,
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,
      pairAddress: best.pairAddress,
      volume24h: best.volume?.h24 ?? 0,
      liquidity: best.liquidity?.usd ?? 0,
      fdv: best.fdv ?? 0,
    });

    if (solanaPairs.length >= 3) break;
  }

  return solanaPairs;
}

/**
 * Fetch top traders for a token pair from DexScreener
 */
export async function fetchTopTraders(
  pairAddress: string,
  tokenAddress: string
): Promise<TopTrader[]> {
  const url = `${DEXSCREENER_BASE}/orders/v1/solana/${pairAddress}`;

  // DexScreener doesn't have a direct "top traders" endpoint in the free tier.
  // We use the top traders endpoint available via the token page.
  const tradersUrl = `${DEXSCREENER_BASE}/token-pairs/v1/solana/${tokenAddress}`;

  const res = await fetch(tradersUrl, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(
      `DexScreener traders fetch failed: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();
  const pairs: DexScreenerPair[] = Array.isArray(data) ? data : data.pairs ?? [];

  // DexScreener free API doesn't expose wallet-level top traders directly.
  // We return the pair data for Helius to process — the actual wallet
  // extraction happens via Helius transaction history on the pair address.
  // This function returns empty — caller uses Helius to get traders.
  void pairs;
  void url;

  return [];
}

/**
 * Fetch top traders for a token via Helius (used instead of DexScreener for wallets)
 * This is called from the pipeline with Helius data
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
  const pairs: DexScreenerPair[] = Array.isArray(data) ? data : data.pairs ?? [];

  if (!pairs.length) return null;

  return pairs.sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
  )[0];
}
