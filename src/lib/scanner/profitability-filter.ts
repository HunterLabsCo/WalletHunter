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
      "[Profitability] SOL price unavailable from Jupiter — PNL math will be inaccurate this scan"
    );
  }

  const results: WalletProfitability[] = [];

  for (const address of walletAddresses) {
    try {
      const swaps = await fetchWalletSwaps(address, daysBack, solPriceUsd);

      if (swaps.length < MIN_TRADES) continue;

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

      const realizedPnl = totalSoldUsd - totalBoughtUsd;
      const pnlRatio = totalSoldUsd / totalBoughtUsd;

      if (pnlRatio >= MIN_PNL_RATIO) {
        results.push({
          walletAddress: address,
          realizedPnl,
          amountBought: totalBoughtUsd,
          pnlRatio,
          swaps,
        });
      }

      // Rate limit protection (Helius free tier ~10 req/s)
      await new Promise((r) => setTimeout(r, 110));
    } catch (error) {
      console.error(`Error processing wallet ${address}:`, error);
      continue;
    }
  }

  return results;
}
