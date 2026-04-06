/**
 * Profitability Filter
 * Filters wallets by realized PNL / amount bought ratio.
 * Threshold: 3x (wallet made at least 3x what they put in)
 */

import { fetchWalletSwaps, type ParsedSwap } from "@/lib/external-apis/helius";

export interface WalletProfitability {
  walletAddress: string;
  realizedPnl: number;
  amountBought: number;
  pnlRatio: number;
  swaps: ParsedSwap[];
}

const MIN_PNL_RATIO = 3.0;
const MIN_TRADES = 3;

/**
 * Calculate profitability for a list of wallet addresses.
 * Returns only wallets that pass the 3x PNL ratio threshold.
 */
export async function filterByProfitability(
  walletAddresses: string[],
  daysBack = 30
): Promise<WalletProfitability[]> {
  const results: WalletProfitability[] = [];

  for (const address of walletAddresses) {
    try {
      const swaps = await fetchWalletSwaps(address, daysBack);

      if (swaps.length < MIN_TRADES) continue;

      // Group swaps by token
      const byToken = new Map<string, ParsedSwap[]>();
      for (const swap of swaps) {
        const existing = byToken.get(swap.tokenAddress) ?? [];
        existing.push(swap);
        byToken.set(swap.tokenAddress, existing);
      }

      let totalBought = 0;
      let totalPnl = 0;

      for (const [, tokenSwaps] of byToken) {
        const buys = tokenSwaps.filter((s) => s.side === "buy");
        const sells = tokenSwaps.filter((s) => s.side === "sell");

        const buyTotal = buys.reduce((sum, s) => sum + s.amountToken, 0);
        const sellTotal = sells.reduce((sum, s) => sum + s.amountToken, 0);

        // Simple PNL: difference in token amounts as a ratio
        // Full USD PNL will be calculated in win rate phase with pricing
        if (buyTotal > 0) {
          totalBought += buyTotal;
          totalPnl += sellTotal - buyTotal;
        }
      }

      if (totalBought <= 0) continue;

      const pnlRatio = totalBought > 0 ? (totalBought + totalPnl) / totalBought : 0;

      if (pnlRatio >= MIN_PNL_RATIO) {
        results.push({
          walletAddress: address,
          realizedPnl: totalPnl,
          amountBought: totalBought,
          pnlRatio,
          swaps,
        });
      }

      // Rate limit protection
      await new Promise((r) => setTimeout(r, 110));
    } catch (error) {
      console.error(`Error processing wallet ${address}:`, error);
      continue;
    }
  }

  return results;
}
