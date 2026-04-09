/**
 * Profitability Filter
 * Filters wallets by realized PNL / amount bought ratio.
 * Threshold: 3x (wallet made at least 3x what they put in, in USD).
 */

import {
  fetchWalletSwaps,
  getSolPriceUsd,
  type ParsedSwap,
} from "@/lib/external-apis/helius";

export interface WalletProfitability {
  walletAddress: string;
  realizedPnl: number; // USD
  amountBought: number; // USD
  pnlRatio: number;
  swaps: ParsedSwap[];
}

const MIN_PNL_RATIO = 3.0;
const MIN_TRADES = 3;

/**
 * Calculate profitability for a list of wallet addresses.
 * Returns only wallets that pass the 3x USD PNL ratio threshold.
 *
 * PNL math:
 *   For each token the wallet traded in the window, sum USD spent on buys
 *   and USD received on sells. A wallet "passes" if total USD received
 *   across all closed-or-partially-closed positions is >= 3x total USD spent.
 */
export async function filterByProfitability(
  walletAddresses: string[],
  daysBack = 30
): Promise<WalletProfitability[]> {
  const solPriceUsd = await getSolPriceUsd();
  if (!solPriceUsd) {
    console.warn(
      "[Profitability] SOL price unavailable — PNL math will be inaccurate this scan"
    );
  } else {
    console.log(`[Profitability] using SOL price = $${solPriceUsd.toFixed(2)}`);
  }

  const results: WalletProfitability[] = [];

  // Diagnostic counters so we can see WHERE wallets get dropped when the
  // pipeline returns zero results.
  let withSwapHistory = 0;
  let withMinTrades = 0;
  let withPricedBuys = 0;
  const pnlRatioHistogram: number[] = [];

  for (let i = 0; i < walletAddresses.length; i++) {
    // Always throttle BEFORE the Helius call so a string of empty/error
    // responses doesn't cause us to hammer the API and trigger sustained
    // rate limiting. Helius's free tier enforces a tight burst limit on
    // its Enhanced Transactions endpoint (well below the documented 10
    // req/s for raw RPC). 1000ms keeps us at 1 req/s, under any
    // observed burst threshold. Drop this once we upgrade to the paid
    // Developer tier (~50 req/s).
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));

    const address = walletAddresses[i];
    try {
      const swaps = await fetchWalletSwaps(address, daysBack, solPriceUsd);

      if (swaps.length > 0) withSwapHistory++;
      if (swaps.length < MIN_TRADES) continue;
      withMinTrades++;

      // Group swaps by token
      const byToken = new Map<string, ParsedSwap[]>();
      for (const swap of swaps) {
        const existing = byToken.get(swap.tokenAddress) ?? [];
        existing.push(swap);
        byToken.set(swap.tokenAddress, existing);
      }

      let totalBoughtUsd = 0;
      let totalSoldUsd = 0;

      for (const [, tokenSwaps] of byToken) {
        const buyUsd = tokenSwaps
          .filter((s) => s.side === "buy")
          .reduce((sum, s) => sum + s.amountUsd, 0);
        const sellUsd = tokenSwaps
          .filter((s) => s.side === "sell")
          .reduce((sum, s) => sum + s.amountUsd, 0);

        // Only count tokens the wallet actually paid USD for (buys with a
        // priced SOL/stable leg). Token-to-token routes we couldn't price
        // are skipped to avoid skewing the ratio.
        if (buyUsd > 0) {
          totalBoughtUsd += buyUsd;
          totalSoldUsd += sellUsd;
        }
      }

      if (totalBoughtUsd <= 0) continue;
      withPricedBuys++;

      const realizedPnl = totalSoldUsd - totalBoughtUsd;
      const pnlRatio = totalSoldUsd / totalBoughtUsd;
      pnlRatioHistogram.push(pnlRatio);

      if (pnlRatio >= MIN_PNL_RATIO) {
        results.push({
          walletAddress: address,
          realizedPnl,
          amountBought: totalBoughtUsd,
          pnlRatio,
          swaps,
        });
      }
    } catch (error) {
      console.error(`Error processing wallet ${address}:`, error);
      continue;
    }
  }

  const sortedRatios = [...pnlRatioHistogram].sort((a, b) => b - a);
  const p50 = sortedRatios[Math.floor(sortedRatios.length / 2)] ?? 0;
  const p90 = sortedRatios[Math.floor(sortedRatios.length * 0.1)] ?? 0;
  const max = sortedRatios[0] ?? 0;
  console.log(
    `[Profitability] checked ${walletAddresses.length} addrs | ` +
      `${withSwapHistory} with swap history | ` +
      `${withMinTrades} with >=${MIN_TRADES} swaps | ` +
      `${withPricedBuys} with priced buys | ` +
      `${results.length} passed >=${MIN_PNL_RATIO}x | ` +
      `pnl p50=${p50.toFixed(2)}x p90=${p90.toFixed(2)}x max=${max.toFixed(2)}x`
  );

  return results;
}
