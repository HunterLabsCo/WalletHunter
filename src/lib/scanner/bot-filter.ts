/**
 * Bot Filter — PROPRIETARY, SERVER-SIDE ONLY
 *
 * Two-stage filtering:
 * Stage 1: Hard gates (binary pass/fail)
 * Stage 2: Behavioral scoring (0.0 = human, 1.0 = bot)
 *
 * Thresholds are loaded from app_config DB table at runtime.
 * Default values used if DB config not available.
 */

import {
  fetchWalletStats,
  fetchWalletSwaps,
  fetchRecentTransactionCount,
  type ParsedSwap,
} from "@/lib/external-apis/helius";

// Known MEV/bot program IDs
const KNOWN_BOT_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter (aggregator, not bot itself but high usage)
  "T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt", // Titan MEV
  "jitoVjT9jRUh4mcRzLkhJZ4RUQM5YRpmEn9RiSTbRak", // Jito tips
]);

interface BotFilterResult {
  address: string;
  passed: boolean;
  botScore: number;
  failedGate?: string;
}

interface BotFilterConfig {
  // Hard gates
  minWalletAgeDays: number;
  minSwaps30d: number;
  minLosses: number;
  minInactivityGaps: number;
  // Scoring threshold
  botScoreThreshold: number;
}

const DEFAULT_CONFIG: BotFilterConfig = {
  minWalletAgeDays: 21,
  minSwaps30d: 50,
  minLosses: 3,
  minInactivityGaps: 2,
  botScoreThreshold: 0.6,
};

/**
 * Run bot filter on a list of wallets with their swap data.
 * Returns only wallets that pass both hard gates and scoring.
 */
export async function filterBots(
  wallets: Array<{ walletAddress: string; swaps: ParsedSwap[] }>,
  config?: Partial<BotFilterConfig>
): Promise<Array<{ walletAddress: string; botScore: number; swaps: ParsedSwap[] }>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const passed: Array<{ walletAddress: string; botScore: number; swaps: ParsedSwap[] }> = [];

  for (const wallet of wallets) {
    try {
      const result = await evaluateWallet(wallet.walletAddress, wallet.swaps, cfg);
      if (result.passed) {
        passed.push({
          walletAddress: wallet.walletAddress,
          botScore: result.botScore,
          swaps: wallet.swaps,
        });
      }
      // Rate limit
      await new Promise((r) => setTimeout(r, 110));
    } catch (error) {
      console.error(`Bot filter error for ${wallet.walletAddress}:`, error);
      continue;
    }
  }

  return passed;
}

async function evaluateWallet(
  address: string,
  swaps: ParsedSwap[],
  config: BotFilterConfig
): Promise<BotFilterResult> {
  // ── Stage 1: Hard Gates ──────────────────────────────────────────────

  // Gate 1: Wallet age
  const stats = await fetchWalletStats(address);
  if (stats.walletAgeDays < config.minWalletAgeDays) {
    return { address, passed: false, botScore: 1.0, failedGate: "wallet_age" };
  }

  // Gate 2: Minimum swap transactions in 30d
  const swaps30d = swaps.filter(
    (s) => s.blockTime.getTime() > Date.now() - 30 * 86400 * 1000
  );
  if (swaps30d.length < config.minSwaps30d) {
    return { address, passed: false, botScore: 1.0, failedGate: "min_swaps" };
  }

  // Gate 3: Must have losing trades
  const lossCount = countLosses(swaps);
  if (lossCount < config.minLosses) {
    return { address, passed: false, botScore: 1.0, failedGate: "min_losses" };
  }

  // Gate 4: Inactivity gaps (humans sleep)
  const gaps = countInactivityGaps(swaps30d);
  if (gaps < config.minInactivityGaps) {
    return { address, passed: false, botScore: 1.0, failedGate: "inactivity_gaps" };
  }

  // ── Stage 2: Behavioral Scoring ──────────────────────────────────────

  let score = 0;

  // Signal 1: Burst trading (weight 0.15)
  const maxBurst = getMaxBurstPerMinute(swaps30d);
  if (maxBurst > 5) score += 0.15;

  // Signal 2: Swap count extremes (weight 0.10)
  if (swaps30d.length > 1000) score += 0.10;
  else if (swaps30d.length < 10) score += 0.05;

  // Signal 3: Unique tokens in 7d (weight 0.10)
  const tokens7d = getUniqueTokens(swaps, 7);
  if (tokens7d > 100) score += 0.10;

  // Signal 4: Median hold time (weight 0.10)
  const medianHold = getMedianHoldTime(swaps);
  if (medianHold < 60) score += 0.10; // < 60 seconds = sniper

  // Signal 5: First-block buyer pattern (weight 0.10)
  // Approximation: if buys cluster at very similar timestamps
  const firstBlockRatio = getFirstBlockBuyRatio(swaps);
  if (firstBlockRatio > 0.5) score += 0.10;

  // Signal 6: Multi-DEX usage (weight 0.10)
  const uniqueDex = new Set(swaps.map((s) => s.programId).filter(Boolean));
  if (uniqueDex.size > 4) score += 0.10;

  // Signal 7: Gas fee variance (weight 0.10)
  // Low variance = hardcoded priority fees = bot
  const txCounts = await fetchRecentTransactionCount(address, 30);
  const feeCV = txCounts.total > 0 ? 0.5 : 0; // Simplified — full impl needs per-tx fees
  if (feeCV < 0.1 && txCounts.total > 20) score += 0.10;

  // Signal 8: Position size variation (weight 0.10)
  const sizeCV = getPositionSizeCV(swaps.filter((s) => s.side === "buy"));
  if (sizeCV < 0.15 && swaps.length > 10) score += 0.10;

  // Signal 9: Failed tx ratio (weight 0.05)
  if (txCounts.total > 0) {
    const failedRatio = txCounts.failed / txCounts.total;
    if (failedRatio > 0.3) score += 0.05;
  }

  // Signal 10: Known bot programs (weight 0.10)
  const usesKnownBot = swaps.some((s) => KNOWN_BOT_PROGRAMS.has(s.programId));
  if (usesKnownBot) score += 0.10;

  return {
    address,
    passed: score < config.botScoreThreshold,
    botScore: Math.round(score * 100) / 100,
  };
}

// ── Helper Functions ──────────────────────────────────────────────────────

function countLosses(swaps: ParsedSwap[]): number {
  const byToken = new Map<string, ParsedSwap[]>();
  for (const s of swaps) {
    const arr = byToken.get(s.tokenAddress) ?? [];
    arr.push(s);
    byToken.set(s.tokenAddress, arr);
  }

  let losses = 0;
  for (const [, tokenSwaps] of byToken) {
    const buys = tokenSwaps.filter((s) => s.side === "buy");
    const sells = tokenSwaps.filter((s) => s.side === "sell");
    const buyTotal = buys.reduce((sum, s) => sum + s.amountToken, 0);
    const sellTotal = sells.reduce((sum, s) => sum + s.amountToken, 0);
    if (sells.length > 0 && sellTotal < buyTotal) losses++;
  }
  return losses;
}

function countInactivityGaps(swaps: ParsedSwap[]): number {
  if (swaps.length < 2) return 0;
  const sorted = [...swaps].sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].blockTime.getTime() - sorted[i - 1].blockTime.getTime();
    if (diff > 24 * 60 * 60 * 1000) gaps++; // 24h+ gap
  }
  return gaps;
}

function getMaxBurstPerMinute(swaps: ParsedSwap[]): number {
  if (swaps.length < 2) return 0;
  const timestamps = swaps.map((s) => s.blockTime.getTime()).sort((a, b) => a - b);
  let maxBurst = 0;

  for (let i = 0; i < timestamps.length; i++) {
    let count = 1;
    for (let j = i + 1; j < timestamps.length; j++) {
      if (timestamps[j] - timestamps[i] <= 60_000) count++;
      else break;
    }
    maxBurst = Math.max(maxBurst, count);
  }
  return maxBurst;
}

function getUniqueTokens(swaps: ParsedSwap[], daysBack: number): number {
  const cutoff = Date.now() - daysBack * 86400 * 1000;
  const tokens = new Set(
    swaps.filter((s) => s.blockTime.getTime() > cutoff).map((s) => s.tokenAddress)
  );
  return tokens.size;
}

function getMedianHoldTime(swaps: ParsedSwap[]): number {
  const byToken = new Map<string, ParsedSwap[]>();
  for (const s of swaps) {
    const arr = byToken.get(s.tokenAddress) ?? [];
    arr.push(s);
    byToken.set(s.tokenAddress, arr);
  }

  const holdTimes: number[] = [];
  for (const [, tokenSwaps] of byToken) {
    const buys = tokenSwaps.filter((s) => s.side === "buy").sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());
    const sells = tokenSwaps.filter((s) => s.side === "sell").sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());

    // FIFO matching
    let buyIdx = 0;
    for (const sell of sells) {
      if (buyIdx < buys.length) {
        const holdMs = sell.blockTime.getTime() - buys[buyIdx].blockTime.getTime();
        holdTimes.push(holdMs / 1000);
        buyIdx++;
      }
    }
  }

  if (!holdTimes.length) return Infinity;
  holdTimes.sort((a, b) => a - b);
  return holdTimes[Math.floor(holdTimes.length / 2)];
}

function getFirstBlockBuyRatio(swaps: ParsedSwap[]): number {
  const buys = swaps.filter((s) => s.side === "buy");
  if (buys.length === 0) return 0;

  // Group buys by token and check if they're within 10 seconds of the earliest buy for that token
  const byToken = new Map<string, ParsedSwap[]>();
  for (const s of buys) {
    const arr = byToken.get(s.tokenAddress) ?? [];
    arr.push(s);
    byToken.set(s.tokenAddress, arr);
  }

  let firstBlockBuys = 0;
  let totalTokensBought = 0;

  for (const [, tokenBuys] of byToken) {
    if (tokenBuys.length === 0) continue;
    totalTokensBought++;
    const earliest = Math.min(...tokenBuys.map((s) => s.blockTime.getTime()));
    // If the wallet bought within 10 seconds of the earliest buy, it's a first-block buy
    const isFirst = tokenBuys.some(
      (s) => s.blockTime.getTime() - earliest < 10_000
    );
    if (isFirst) firstBlockBuys++;
  }

  return totalTokensBought > 0 ? firstBlockBuys / totalTokensBought : 0;
}

function getPositionSizeCV(buys: ParsedSwap[]): number {
  if (buys.length < 3) return 1; // Not enough data, assume human
  const sizes = buys.map((s) => s.amountToken);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  if (mean === 0) return 1;
  const variance = sizes.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sizes.length;
  const stdDev = Math.sqrt(variance);
  return stdDev / mean; // Coefficient of variation
}
