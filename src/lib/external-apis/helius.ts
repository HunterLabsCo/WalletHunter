/**
 * Helius API client
 * Docs: https://docs.helius.dev
 * Free tier: 1M credits/month, ~10 req/s
 */

function getApiKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) {
    throw new Error(
      "HELIUS_API_KEY is not set. Please add it to your .env.local file."
    );
  }
  return key;
}

const HELIUS_BASE = "https://api.helius.xyz";

// Well-known mints used for USD denomination
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  fee: number;
  feePayer: string;
  type: string;
  source: string;
  accountData: Array<{ account: string; nativeBalanceChange: number }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  events?: {
    swap?: HeliusSwapEvent;
  };
}

export interface HeliusSwapEvent {
  nativeInput?: { account: string; amount: string };
  nativeOutput?: { account: string; amount: string };
  tokenInputs?: Array<{
    userAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  tokenOutputs?: Array<{
    userAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  tokenFees?: Array<{ userAccount: string; tokenAmount: number; mint: string }>;
  nativeFees?: Array<{ account: string; amount: string }>;
  innerSwaps?: HeliusSwapEvent[];
}

export interface ParsedSwap {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol?: string;
  side: "buy" | "sell";
  amountUsd: number;
  amountToken: number;
  txSignature: string;
  blockTime: Date;
  programId: string;
}


// ─── Token Metadata Cache ──────────────────────────────────────────────────

const tokenPriceCache = new Map<string, { price: number; ts: number }>();

export async function getTokenPrice(mint: string): Promise<number> {
  const cached = tokenPriceCache.get(mint);
  if (cached && Date.now() - cached.ts < 60_000) return cached.price;

  try {
    const res = await fetch(
      `https://price.jup.ag/v6/price?ids=${mint}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const price = data.data?.[mint]?.price ?? 0;
    tokenPriceCache.set(mint, { price, ts: Date.now() });
    return price;
  } catch {
    return 0;
  }
}

/**
 * Fetch the current SOL/USD spot price.
 *
 * Uses Binance's public unauthenticated ticker as the primary source — it's
 * extremely reliable and rate limits are generous. CoinGecko is a fallback
 * if Binance is unreachable. Cached for 60s via the token price cache.
 *
 * NB: Jupiter's older `price.jup.ag/v6/price` endpoint has been deprecated
 * and now returns errors, which is why we don't use it here.
 */
export async function getSolPriceUsd(): Promise<number> {
  const cached = tokenPriceCache.get(SOL_MINT);
  if (cached && Date.now() - cached.ts < 60_000) return cached.price;

  // Binance primary
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      { next: { revalidate: 0 } }
    );
    if (res.ok) {
      const data = (await res.json()) as { price?: string };
      const price = parseFloat(data.price ?? "0");
      if (price > 0) {
        tokenPriceCache.set(SOL_MINT, { price, ts: Date.now() });
        return price;
      }
    }
  } catch {
    // fall through to CoinGecko
  }

  // CoinGecko fallback
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { next: { revalidate: 0 } }
    );
    if (res.ok) {
      const data = (await res.json()) as { solana?: { usd?: number } };
      const price = data.solana?.usd ?? 0;
      if (price > 0) {
        tokenPriceCache.set(SOL_MINT, { price, ts: Date.now() });
        return price;
      }
    }
  } catch {
    // fall through
  }

  return 0;
}

// ─── Top Traders from Token (with per-token 3x filter) ───────────────────

const MIN_PNL_RATIO = 3.0;

/**
 * Determine whether a swap event bought or sold `tokenMint`, and the USD
 * value of the counter-leg (SOL / USDC / USDT side).
 *
 * This is TOKEN-CENTRIC, not wallet-centric: it checks whether the target
 * token appears in the swap's inputs vs outputs. This avoids the PDA
 * problem entirely — we don't need to match `userAccount` to the feePayer.
 */
function classifySwapForToken(
  swap: HeliusSwapEvent,
  tokenMint: string,
  solPriceUsd: number
): { side: "buy" | "sell" | null; usdValue: number } {
  const tokenInInputs = (swap.tokenInputs ?? []).some(
    (t) => t.mint === tokenMint
  );
  const tokenInOutputs = (swap.tokenOutputs ?? []).some(
    (t) => t.mint === tokenMint
  );

  if (!tokenInInputs && !tokenInOutputs) return { side: null, usdValue: 0 };

  // Token only in outputs → someone BOUGHT it (paid SOL/USDC in)
  if (tokenInOutputs && !tokenInInputs) {
    return { side: "buy", usdValue: usdLeg(swap, "input", solPriceUsd) };
  }

  // Token only in inputs → someone SOLD it (received SOL/USDC out)
  if (tokenInInputs && !tokenInOutputs) {
    return { side: "sell", usdValue: usdLeg(swap, "output", solPriceUsd) };
  }

  // Token in both sides → partial / complex swap, skip
  return { side: null, usdValue: 0 };
}

/** Sum the USD value of the SOL + stablecoin leg on one side of a swap. */
function usdLeg(
  swap: HeliusSwapEvent,
  direction: "input" | "output",
  solPriceUsd: number
): number {
  let usd = 0;
  if (direction === "input") {
    if (swap.nativeInput) {
      usd += (Number(swap.nativeInput.amount) / 1e9) * solPriceUsd;
    }
    for (const t of swap.tokenInputs ?? []) {
      if (STABLE_MINTS.has(t.mint)) usd += t.tokenAmount;
    }
  } else {
    if (swap.nativeOutput) {
      usd += (Number(swap.nativeOutput.amount) / 1e9) * solPriceUsd;
    }
    for (const t of swap.tokenOutputs ?? []) {
      if (STABLE_MINTS.has(t.mint)) usd += t.tokenAmount;
    }
  }
  return usd;
}

/**
 * Fetch top traders for a token and filter to wallets with >= 3x profitability
 * on THIS specific token.
 *
 * Combined trader-discovery + profitability filter in one step:
 * 1. Fetch up to 200 SWAP txs for the token mint (2 pages)
 * 2. For each tx, classify whether the feePayer bought or sold the token
 * 3. Group by feePayer: sum USD bought vs USD sold
 * 4. Return only wallets where SOLD / BOUGHT >= 3x
 *
 * The fee payer is the wallet that signed and paid for the transaction —
 * that's the actual trader. PDAs cannot sign transactions.
 *
 * @param solPriceUsd - Current SOL/USD spot for denominating the SOL leg.
 *   Fetch once per scan via `getSolPriceUsd()` and pass to all calls.
 */
export async function fetchTopTradersForToken(
  tokenMint: string,
  limit = 50,
  solPriceUsd = 0
): Promise<
  Array<{
    walletAddress: string;
    realizedPnl: number;
    amountBought: number;
    pnlRatio: number;
  }>
> {
  const apiKey = getApiKey();

  // Fetch up to 200 SWAP txs for the token (2 pages × 100)
  const allTxns: HeliusTransaction[] = [];
  let before: string | undefined;

  for (let page = 0; page < 2; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, 1000));

    const url = new URL(
      `${HELIUS_BASE}/v0/addresses/${tokenMint}/transactions`
    );
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("type", "SWAP");
    url.searchParams.set("limit", "100");
    if (before) url.searchParams.set("before", before);

    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    if (!res.ok) {
      if (page === 0) {
        throw new Error(
          `Helius top traders fetch failed: ${res.status} ${res.statusText}`
        );
      }
      break;
    }

    const txns: HeliusTransaction[] = await res.json();
    if (!txns.length) break;

    allTxns.push(...txns);
    before = txns[txns.length - 1].signature;
  }

  // Per-wallet buy/sell USD tracking on THIS token
  const walletPnl = new Map<
    string,
    { boughtUsd: number; soldUsd: number }
  >();

  for (const tx of allTxns) {
    const fp = tx.feePayer;
    if (!fp || fp.startsWith("11111")) continue;

    const swap = tx.events?.swap;
    if (!swap) continue;

    const { side, usdValue } = classifySwapForToken(
      swap,
      tokenMint,
      solPriceUsd
    );
    if (!side || usdValue <= 0) continue;

    const existing = walletPnl.get(fp) ?? { boughtUsd: 0, soldUsd: 0 };
    if (side === "buy") existing.boughtUsd += usdValue;
    else existing.soldUsd += usdValue;
    walletPnl.set(fp, existing);
  }

  // Filter >= 3x and sort by ratio (best first)
  const results = [...walletPnl.entries()]
    .filter(
      ([, pnl]) =>
        pnl.boughtUsd > 0 && pnl.soldUsd / pnl.boughtUsd >= MIN_PNL_RATIO
    )
    .map(([addr, pnl]) => ({
      walletAddress: addr,
      realizedPnl: pnl.soldUsd - pnl.boughtUsd,
      amountBought: pnl.boughtUsd,
      pnlRatio: pnl.soldUsd / pnl.boughtUsd,
    }))
    .sort((a, b) => b.pnlRatio - a.pnlRatio)
    .slice(0, limit);

  console.log(
    `[Helius] ${tokenMint.slice(0, 8)}…: ${allTxns.length} txs, ` +
      `${walletPnl.size} unique wallets, ${results.length} passed >= ${MIN_PNL_RATIO}x`
  );

  return results;
}

// ─── NOTE: Wallet-level functions removed ─────────────────────────────────
// fetchWalletSwaps, fetchWalletStats, fetchRecentTransactionCount have been
// replaced by SolScan (src/lib/external-apis/solscan.ts). Helius is now
// used only for per-token queries (fetchTopTradersForToken).
