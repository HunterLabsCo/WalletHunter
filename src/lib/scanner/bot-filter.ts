/**
 * Bot Filter — PROPRIETARY, SERVER-SIDE ONLY
 *
 * Stage 1 hard gates only. No behavioral scoring.
 * Wallets must pass ALL gates to proceed.
 *
 * Thresholds are loaded from app_config DB table at runtime.
 * Default values used if DB config not available.
 */

import type { ParsedSwap } from "@/lib/external-apis/helius";

interface BotFilterConfig {
  minWalletAgeDays: number;
  minSwaps30d: number;
  minLossRate: number; // percentage (0.05 = 5%)
  minInactivityGaps: number;
}

const DEFAULT_CONFIG: BotFilterConfig = {
  minWalletAgeDays: 21,
  minSwaps30d: 50,
  minLossRate: 0.05,
  minInactivityGaps: 1,
};

/**
 * Run bot filter on wallets with pre-fetched data.
 * Synchronous — no API calls, all data is passed in.
 * Returns only wallets that pass all 4 hard gates.
 */
export function filterBots(
  wallets: Array<{
    walletAddress: string;
    walletAgeDays: number;
    swaps: ParsedSwap[];
  }>,
  config?: Partial<BotFilterConfig>
): Array<{ walletAddress: string; swaps: ParsedSwap[] }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const passed: Array<{ walletAddress: string; swaps: ParsedSwap[] }> = [];

  for (const wallet of wallets) {
    const gate = evaluateHardGates(
      wallet.walletAddress,
      wallet.walletAgeDays,
      wallet.swaps,
      cfg
    );
    if (gate.passed) {
      passed.push({
        walletAddress: wallet.walletAddress,
        swaps: wallet.swaps,
      });
    } else {
      console.log(
        `[BotFilter] ${wallet.walletAddress.slice(0, 8)}… failed: ${gate.failedGate}`
      );
    }
  }

  return passed;
}

// ─── Hard Gates ─────────────────────────────────────────────────────────────

function evaluateHardGates(
  address: string,
  walletAgeDays: number,
  swaps: ParsedSwap[],
  config: BotFilterConfig
): { passed: boolean; failedGate?: string } {
  // Gate 1: Wallet age
  if (walletAgeDays < config.minWalletAgeDays) {
    return { passed: false, failedGate: "wallet_age" };
  }

  // Gate 2: Minimum swap transactions in 30d
  const swaps30d = swaps.filter(
    (s) => s.blockTime.getTime() > Date.now() - 30 * 86400 * 1000
  );
  if (swaps30d.length < config.minSwaps30d) {
    return { passed: false, failedGate: "min_swaps" };
  }

  // Gate 3: Loss rate (>= 5% of closed trades must be losses)
  const lossRate = calculateLossRate(swaps);
  if (lossRate < config.minLossRate) {
    return { passed: false, failedGate: "loss_rate" };
  }

  // Gate 4: Inactivity gaps (humans sleep/take breaks)
  const gaps = countInactivityGaps(swaps30d);
  if (gaps < config.minInactivityGaps) {
    return { passed: false, failedGate: "inactivity_gaps" };
  }

  return { passed: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Calculate loss rate as a fraction of closed trades.
 * A trade is a per-token position: group buys/sells by token,
 * mark as loss if total USD sold < total USD bought.
 * Only considers tokens with at least one sell (closed/partially closed).
 */
function calculateLossRate(swaps: ParsedSwap[]): number {
  const byToken = new Map<string, ParsedSwap[]>();
  for (const s of swaps) {
    const arr = byToken.get(s.tokenAddress) ?? [];
    arr.push(s);
    byToken.set(s.tokenAddress, arr);
  }

  let closedTrades = 0;
  let losses = 0;

  for (const [, tokenSwaps] of byToken) {
    const sells = tokenSwaps.filter((s) => s.side === "sell");
    if (sells.length === 0) continue; // Open position, not counted

    closedTrades++;
    const buyUsd = tokenSwaps
      .filter((s) => s.side === "buy")
      .reduce((sum, s) => sum + s.amountUsd, 0);
    const sellUsd = sells.reduce((sum, s) => sum + s.amountUsd, 0);

    if (sellUsd < buyUsd) losses++;
  }

  if (closedTrades === 0) return 0;
  return losses / closedTrades;
}

/**
 * Count the number of 24h+ gaps between consecutive swaps.
 * Real humans have breaks; bots trade continuously.
 */
function countInactivityGaps(swaps: ParsedSwap[]): number {
  if (swaps.length < 2) return 0;
  const sorted = [...swaps].sort(
    (a, b) => a.blockTime.getTime() - b.blockTime.getTime()
  );
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff =
      sorted[i].blockTime.getTime() - sorted[i - 1].blockTime.getTime();
    if (diff > 24 * 60 * 60 * 1000) gaps++;
  }
  return gaps;
}
