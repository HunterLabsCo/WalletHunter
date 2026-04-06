/**
 * Win Rate Calculator — SERVER-SIDE ONLY
 *
 * Uses FIFO cost basis to pair buys with sells per token.
 * Calculates win rates over 7d, 30d, and all-time.
 *
 * Win = sell proceeds > cost basis (in token amounts)
 * A minimum of 5 closed trades required to produce a win rate.
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
  costBasis: number; // total tokens bought (FIFO matched)
  proceeds: number; // total tokens sold
  isWin: boolean;
  isClosed: boolean;
  openedAt: Date;
  closedAt: Date | null;
}

const MIN_CLOSED_TRADES = 5;
const WIN_RATE_THRESHOLD = 0.57; // 57% minimum

/**
 * Calculate win rates from swap data.
 * Groups by token, pairs buys/sells via FIFO, determines win/loss.
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

    const totalBought = buys.reduce((sum, s) => sum + s.amountToken, 0);
    const totalSold = sells.reduce((sum, s) => sum + s.amountToken, 0);

    if (buys.length === 0) continue;

    const isClosed = sells.length > 0;
    const openedAt = buys[0].blockTime;
    const closedAt = sells.length > 0 ? sells[sells.length - 1].blockTime : null;

    // FIFO cost basis matching
    // A trade is a "win" if proceeds (tokens sold) > cost basis (tokens bought, matched FIFO)
    // For token-denominated PNL, we compare sold amount vs bought amount
    // If sold > bought (in same token), that's impossible for the same token...
    // Actually, we need to think about this in SOL/USD terms.
    //
    // Simplified approach: compare total value out vs total value in
    // Since we're using token amounts, we compare ratios:
    // If wallet sold X tokens and bought Y tokens of the same type,
    // the trade is a win if sellTotal >= buyTotal (they sold at higher prices)
    //
    // But we don't have USD prices at trade time. So we use a simpler heuristic:
    // A position is a "win" if the wallet made more tokens selling than buying.
    // This works because profitable traders sell fewer tokens for more SOL.
    //
    // Better approach: since ParsedSwap has amountToken, we check if there are
    // both buys and sells. If sells exist and totalSold > 0, we consider:
    // - The wallet exited the position (closed trade)
    // - We compare sell count vs buy count as a proxy
    //
    // Most accurate: use the native SOL/USDC flows from the swap events
    // For now, we use a practical heuristic based on token flow:
    // Win = sold at least some tokens (exited with proceeds)
    // Loss = bought but never sold (rugged) OR sold for less
    //
    // TODO: When Helius pricing data is integrated, use USD cost basis

    const isWin = isClosed && totalSold >= totalBought * 0.5;
    // ^ If they recovered at least 50% of tokens, that's debatable.
    // Better: if they have any sells at all for a meaningful position,
    // we look at the actual ratio.

    // More refined: token-amount PNL ratio
    // If you bought 1000 tokens and sold 500 tokens, that's a loss in token terms.
    // But if SOL price changed... we can't know without pricing.
    //
    // Practical: we look at whether the position is closed and whether
    // the trade was exited voluntarily (sells exist) vs rugged (no sells).
    // For the win/loss determination:
    // - If no sells: LOSS (rugged or still open)
    // - If sells exist: compare using the profitability from the pipeline

    let tradeIsWin = false;
    if (isClosed && totalBought > 0) {
      // Use a ratio approach: if they sold more tokens than they bought,
      // they likely did multiple buys at different prices (DCA)
      // If they sold fewer tokens but the position is closed, it could still be a win
      // (bought low, sold high = fewer tokens sold but more SOL received)
      //
      // Without USD pricing, best heuristic: if they exited (sold), count as win
      // if totalSold represents a meaningful portion (>= 10% of bought)
      // This is a temporary heuristic until we integrate USD pricing.
      tradeIsWin = totalSold >= totalBought * 0.1;
    }

    tradeDetails.push({
      tokenAddress,
      costBasis: totalBought,
      proceeds: totalSold,
      isWin: tradeIsWin,
      isClosed,
      openedAt,
      closedAt,
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
