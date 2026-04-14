/**
 * SolScan Pro API v2 client
 * Docs: https://pro-api.solscan.io/pro-api-docs/v2.0
 * Free tier: ~10 CU/s
 *
 * Used for:
 * - Wallet age (first transaction timestamp)
 * - Full SWAP history (for bot filter + win rate calculator)
 */

import type { ParsedSwap } from "@/lib/external-apis/helius";

const SOLSCAN_BASE = "https://pro-api.solscan.io/v2.0";

// Well-known mints for determining buy vs sell direction
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLE_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

function getApiKey(): string {
  const key = process.env.SOLSCAN_API_KEY;
  if (!key) {
    throw new Error(
      "SOLSCAN_API_KEY is not set. Please add it to your .env.local file."
    );
  }
  return key;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SolScanDefiActivity {
  block_id: number;
  trans_id: string;
  block_time: number;
  activity_type: string;
  from_address: string;
  platform: string;
  sources: string[];
  amount_info: {
    token1: string;
    token1_decimals: number;
    amount1: number;
    token2: string;
    token2_decimals: number;
    amount2: number;
  };
  routers: string[];
}

interface SolScanResponse<T> {
  success: boolean;
  data: T;
}

interface SolScanTransaction {
  tx_hash: string;
  block_time: number;
  status: string;
}

// ─── Wallet Age ──────────────────────────────────────────────────────────────

/**
 * Get wallet age in days by fetching the oldest transaction.
 * Uses account/transactions sorted ascending to find the first-ever tx.
 */
export async function fetchWalletAge(address: string): Promise<number> {
  const apiKey = getApiKey();

  const url = new URL(`${SOLSCAN_BASE}/account/transactions`);
  url.searchParams.set("address", address);
  url.searchParams.set("page_size", "1");
  url.searchParams.set("sort_by", "block_time");
  url.searchParams.set("sort_order", "asc");

  const res = await fetch(url.toString(), {
    headers: { token: apiKey, Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    console.warn(
      `[SolScan] fetchWalletAge ${address.slice(0, 8)}… returned ${res.status}`
    );
    return 0;
  }

  const data: SolScanResponse<SolScanTransaction[]> = await res.json();

  if (!data.success || !data.data?.length) return 0;

  const firstTxTime = data.data[0].block_time;
  if (!firstTxTime) return 0;

  const ageDays = Math.floor((Date.now() / 1000 - firstTxTime) / 86400);
  return ageDays;
}

// ─── Wallet Swap History ─────────────────────────────────────────────────────

/**
 * Fetch all SWAP transactions for a wallet from SolScan, mapped to ParsedSwap.
 *
 * Paginates up to MAX_PAGES, stopping when we hit the time cutoff or run out
 * of activities. Includes both ACTIVITY_TOKEN_SWAP (single-DEX) and
 * ACTIVITY_AGG_TOKEN_SWAP (aggregator like Jupiter) activity types.
 *
 * @param solPriceUsd - Current SOL/USD price for denominating the SOL leg
 *   of swaps into USD. Pass 0 to skip SOL-denominated USD calculation
 *   (swaps with SOL will have amountUsd = 0).
 */
export async function fetchWalletSwapHistory(
  address: string,
  daysBack = 30,
  solPriceUsd = 0
): Promise<ParsedSwap[]> {
  const apiKey = getApiKey();
  const cutoffTime = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const swaps: ParsedSwap[] = [];
  const MAX_PAGES = 20;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`${SOLSCAN_BASE}/account/defi/activities`);
    url.searchParams.set("address", address);
    url.searchParams.append("activity_type[]", "ACTIVITY_TOKEN_SWAP");
    url.searchParams.append("activity_type[]", "ACTIVITY_AGG_TOKEN_SWAP");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "100");
    url.searchParams.set("sort_by", "block_time");
    url.searchParams.set("sort_order", "desc");

    const res = await fetch(url.toString(), {
      headers: { token: apiKey, Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      console.warn(
        `[SolScan] fetchWalletSwapHistory ${address.slice(0, 8)}… page ${page} returned ${res.status}`
      );
      break;
    }

    const data: SolScanResponse<SolScanDefiActivity[]> = await res.json();

    if (!data.success || !data.data?.length) break;

    let reachedCutoff = false;
    for (const activity of data.data) {
      if (activity.block_time < cutoffTime) {
        reachedCutoff = true;
        break;
      }

      const parsed = mapActivityToSwap(activity, address, solPriceUsd);
      if (parsed) swaps.push(parsed);
    }

    if (reachedCutoff) break;

    // If we got fewer than page_size, there are no more pages
    if (data.data.length < 100) break;

    // Rate limit: ~100ms between requests
    await new Promise((r) => setTimeout(r, 100));
  }

  return swaps;
}

// ─── Activity → ParsedSwap Mapping ──────────────────────────────────────────

/**
 * Map a SolScan DeFi activity to our unified ParsedSwap format.
 *
 * SolScan's amount_info:
 * - token1 = token the user SENT (out)
 * - token2 = token the user RECEIVED (in)
 *
 * Buy = user sends SOL/USDC/USDT, receives a non-stable token
 * Sell = user sends a non-stable token, receives SOL/USDC/USDT
 */
function mapActivityToSwap(
  activity: SolScanDefiActivity,
  walletAddress: string,
  solPriceUsd: number
): ParsedSwap | null {
  const info = activity.amount_info;
  if (!info?.token1 || !info?.token2) return null;

  const token1IsStable = STABLE_MINTS.has(info.token1);
  const token2IsStable = STABLE_MINTS.has(info.token2);

  // Both stable or neither stable → skip (stable-to-stable swap or
  // token-to-token swap we can't classify as buy/sell)
  if (token1IsStable === token2IsStable) return null;

  const amount1 = Number(info.amount1) / Math.pow(10, info.token1_decimals);
  const amount2 = Number(info.amount2) / Math.pow(10, info.token2_decimals);

  if (token1IsStable) {
    // User sent stable → BOUGHT token2
    const usdValue = getUsdValue(info.token1, amount1, solPriceUsd);
    return {
      walletAddress,
      tokenAddress: info.token2,
      side: "buy",
      amountUsd: usdValue,
      amountToken: amount2,
      txSignature: activity.trans_id,
      blockTime: new Date(activity.block_time * 1000),
      programId: activity.platform ?? "",
    };
  }

  // User sent non-stable → SOLD token1
  const usdValue = getUsdValue(info.token2, amount2, solPriceUsd);
  return {
    walletAddress,
    tokenAddress: info.token1,
    side: "sell",
    amountUsd: usdValue,
    amountToken: amount1,
    txSignature: activity.trans_id,
    blockTime: new Date(activity.block_time * 1000),
    programId: activity.platform ?? "",
  };
}

/**
 * Compute USD value from the stable/SOL leg of a swap.
 * - USDC/USDT: 1:1 with USD (stablecoin)
 * - SOL: multiply by current SOL/USD price
 */
function getUsdValue(
  mint: string,
  amount: number,
  solPriceUsd: number
): number {
  if (mint === USDC_MINT || mint === USDT_MINT) return amount;
  if (mint === SOL_MINT) return amount * solPriceUsd;
  return 0;
}
