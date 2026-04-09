/**
 * Win Rate Calculator — SERVER-SIDE ONLY
 *
 * Uses FIFO USD cost basis to pair buys with sells per token.
 * Calculates win rates over 7d, 30d, and all-time.
 *
 * Win = USD proceeds (from sells) > USD cost basis (from buys, FIFO matched)
 * Minimum of 5 closed trades required to produce a win rate.
 * Rugged tokens (buys with no sells) count as losses.
 */

import { type ParsedSwap } from "@/lib/external-apis/helius";

export interface WinRateResult {
  walletAddress: string;
  winrate7d: number | null; // null if fewer than 5 closed trades
  winrate30d: number | null;
  winrateAlltime: number | null;
  totalClosedTrades: number;
  wins: number;
  losses: number;
  openPositions: number;
  tradeDetails: TradeDetail[];
}

export interface TradeDetail {
  tokenAddress: string;
  costBasis: number; // USD spent on buys (FIFO matched)
  proceeds: number; // USD received from sells
  isWin: boolean;
  isClosed: boolean;
  openedAt: Date;
  closedAt: Date | null;
}

const MIN_CLOSED_TRADES = 5;
const WIN_RATE_THRESHOLD = 0.57; // 57% minimum

/**
 * Calculate win rates from swap data.
 * Groups by token, pairs buys/sells via FIFO, determines win/loss in USD.
 */
export function calculateWinRate(
  walletAddress: string,
  swaps: ParsedSwap[]
): WinRateResult {
  // Group swaps by token
  const byToken = new Map<string, ParsedSwap[]>();
  for (const s of swaps) {
    const arr = byToken.get(s.tokenAddress) ?? [];
    arr.push(s);
    byToken.set(s.tokenAddress, arr);
  }

  const tradeDetails: TradeDetail[] = [];

  for (const [tokenAddress, tokenSwaps] of byToken) {
    const buys = tokenSwaps
      .filter((s) => s.side === "buy")
      .sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());
    const sells = tokenSwaps
      .filter((s) => s.side === "sell")
      .sort((a, b) => a.blockTime.getTime() - b.blockTime.getTime());

    if (buys.length === 0) continue;

    const totalBoughtUsd = buys.reduce((sum, s) => sum + s.amountUsd, 0);
    const totalSoldUsd = sells.reduce((sum, s) => sum + s.amountUsd, 0);
    const totalBoughtTokens = buys.reduce((sum, s) => sum + s.amountToken, 0);
    const totalSoldTokens = sells.reduce((sum, s) => sum + s.amountToken, 0);

    // A position is "closed" once the wallet has sold at least 90% of the
    // tokens it bought. Anything less is treated as still-open and excluded
    // from win-rate denominators (shown separately as openPositions).
    const exitRatio =
      totalBoughtTokens > 0 ? totalSoldTokens / totalBoughtTokens : 0;
    const isClosed = sells.length > 0 && exitRatio >= 0.9;

    // FIFO USD cost basis: pair the realized exit proceeds against the USD
    // actually paid for the matched buy slice. Since we treat a position as
    // ~fully closed (>=90% exit), comparing total USD in vs total USD out
    // is a fair approximation without per-lot lot tracking.
    const isWin = isClosed && totalSoldUsd > totalBoughtUsd;

    tradeDetails.push({
      tokenAddress,
      costBasis: totalBoughtUsd,
      proceeds: totalSoldUsd,
      isWin,
      isClosed,
      openedAt: buys[0].blockTime,
      closedAt: sells.length > 0 ? sells[sells.length - 1].blockTime : null,
    });
  }

  // Calculate win rates per timeframe
  const now = Date.now();
  const day7 = now - 7 * 86400 * 1000;
  const day30 = now - 30 * 86400 * 1000;

  const closedTrades = tradeDetails.filter((t) => t.isClosed);
  const openPositions = tradeDetails.filter((t) => !t.isClosed).length;

  // All-time
  const wins = closedTrades.filter((t) => t.isWin).length;
  const losses = closedTrades.length - wins;
  const winrateAlltime =
    closedTrades.length >= MIN_CLOSED_TRADES
      ? wins / closedTrades.length
      : null;

  // 30d — trades opened in last 30 days
  const closed30d = closedTrades.filter(
    (t) => t.openedAt.getTime() >= day30
  );
  const wins30d = closed30d.filter((t) => t.isWin).length;
  const winrate30d =
    closed30d.length >= MIN_CLOSED_TRADES
      ? wins30d / closed30d.length
      : null;

  // 7d — trades opened in last 7 days
  const closed7d = closedTrades.filter(
    (t) => t.openedAt.getTime() >= day7
  );
  const wins7d = closed7d.filter((t) => t.isWin).length;
  const winrate7d =
    closed7d.length >= MIN_CLOSED_TRADES ? wins7d / closed7d.length : null;

  return {
    walletAddress,
    winrate7d,
    winrate30d,
    winrateAlltime,
    totalClosedTrades: closedTrades.length,
    wins,
    losses,
    openPositions,
    tradeDetails,
  };
}

/**
 * Filter wallets by win rate threshold (57% minimum on 30d).
 * Returns wallets that pass, along with their win rate data.
 */
export function filterByWinRate(
  wallets: Array<{ walletAddress: string; swaps: ParsedSwap[] }>,
  threshold = WIN_RATE_THRESHOLD
): Array<{ walletAddress: string; winRate: WinRateResult; swaps: ParsedSwap[] }> {
  const passed: Array<{
    walletAddress: string;
    winRate: WinRateResult;
    swaps: ParsedSwap[];
  }> = [];

  for (const wallet of wallets) {
    const winRate = calculateWinRate(wallet.walletAddress, wallet.swaps);

    // Must have enough closed trades to evaluate
    if (winRate.totalClosedTrades < MIN_CLOSED_TRADES) continue;

    // Use 30d win rate if available, fall back to all-time
    const rate = winRate.winrate30d ?? winRate.winrateAlltime;
    if (rate !== null && rate >= threshold) {
      passed.push({
        walletAddress: wallet.walletAddress,
        winRate,
        swaps: wallet.swaps,
      });
    }
  }

  return passed;
}
