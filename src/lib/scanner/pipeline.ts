/**
 * Scan Pipeline Orchestrator
 *
 * Flow:
 * 1. Fetch trending coins from DexScreener (WebSocket)
 * 2. Fetch top traders per coin via Helius (per-token 3x filter built-in)
 * 3. Fetch wallet data from SolScan (age + swap history)
 * 4. Filter bots (Stage 1 hard gates only)
 * 5. Calculate win rates (FIFO cost basis, 7d/30d/all-time)
 * 6. Filter by win rate (>= 57% on 30d)
 * 7. Persist results to database
 *
 * All scoring/filtering logic runs SERVER-SIDE ONLY.
 */

import { fetchTrendingCoins, type TrendingCoin } from "@/lib/external-apis/dexscreener";
import { fetchTopTradersForToken, getSolPriceUsd } from "@/lib/external-apis/helius";
import {
  fetchWalletAge,
  fetchWalletSwapHistory,
} from "@/lib/external-apis/solscan";
import { filterBots } from "./bot-filter";
import { filterByWinRate } from "./winrate-calculator";
import { db } from "@/lib/db";
import {
  scans,
  discoveredWallets,
  scanWalletResults,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface ScanResult {
  scanId: string;
  trendingCoins: TrendingCoin[];
  walletsFound: number;
  wallets: Array<{
    address: string;
    pnlRatio: number;
    realizedPnl: number;
    amountBought: number;
  }>;
  duration: number;
  error?: string;
}

/**
 * Run the full scan pipeline.
 * @param userId - The user who triggered the scan (null for auto-scans)
 * @param scanType - "manual" or "auto"
 */
export async function runScanPipeline(
  userId: string | null,
  scanType: "manual" | "auto"
): Promise<ScanResult> {
  const startTime = Date.now();

  // Create scan record
  const [scan] = await db
    .insert(scans)
    .values({
      userId,
      type: scanType,
      status: "running",
    })
    .returning({ id: scans.id });

  try {
    // Step 1: Fetch trending coins (DexScreener WebSocket)
    console.log("[Pipeline] Fetching trending coins...");
    const trendingCoins = await fetchTrendingCoins();

    if (!trendingCoins.length) {
      throw new Error("No trending Solana coins found");
    }

    console.log(
      `[Pipeline] Found ${trendingCoins.length} trending coins:`,
      trendingCoins.map((c) => c.symbol).join(", ")
    );

    // Update scan with trending coins
    await db
      .update(scans)
      .set({ trendingCoins: trendingCoins })
      .where(eq(scans.id, scan.id));

    // Step 2: Per-token top traders with 3x filter (Helius)
    console.log("[Pipeline] Fetching top traders with 3x filter...");
    const solPrice = await getSolPriceUsd();
    console.log(`[Pipeline] SOL price: $${solPrice.toFixed(2)}`);

    const allProfitableTraders: Array<{
      walletAddress: string;
      realizedPnl: number;
      amountBought: number;
      pnlRatio: number;
    }> = [];

    for (let i = 0; i < trendingCoins.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000));

      const coin = trendingCoins[i];
      const traders = await fetchTopTradersForToken(
        coin.tokenAddress,
        50,
        solPrice
      );
      allProfitableTraders.push(...traders);
      console.log(
        `[Pipeline] ${coin.symbol}: ${traders.length} wallets passed 3x filter`
      );
    }

    // Deduplicate — keep the entry with the best PNL ratio if a wallet
    // appears for multiple trending tokens.
    const deduped = new Map<
      string,
      (typeof allProfitableTraders)[number]
    >();
    for (const trader of allProfitableTraders) {
      const existing = deduped.get(trader.walletAddress);
      if (!existing || trader.pnlRatio > existing.pnlRatio) {
        deduped.set(trader.walletAddress, trader);
      }
    }
    const uniqueTraders = [...deduped.values()];

    console.log(
      `[Pipeline] ${uniqueTraders.length} unique wallets passed 3x filter`
    );

    if (!uniqueTraders.length) {
      const duration = Date.now() - startTime;
      await db
        .update(scans)
        .set({
          status: "completed",
          walletsFound: 0,
          duration,
          completedAt: new Date(),
        })
        .where(eq(scans.id, scan.id));

      return {
        scanId: scan.id,
        trendingCoins,
        walletsFound: 0,
        wallets: [],
        duration,
      };
    }

    // Step 3: Fetch wallet data from SolScan (age + swap history)
    console.log("[Pipeline] Fetching wallet data from SolScan...");

    // Process wallets with controlled concurrency to respect SolScan rate limits.
    // Each wallet needs 2 calls (age + swaps), so limit parallel requests.
    const CONCURRENCY = 3;
    const walletData: Array<{
      walletAddress: string;
      realizedPnl: number;
      amountBought: number;
      pnlRatio: number;
      walletAgeDays: number;
      swaps: import("@/lib/external-apis/helius").ParsedSwap[];
    }> = [];

    for (let i = 0; i < uniqueTraders.length; i += CONCURRENCY) {
      const batch = uniqueTraders.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (trader) => {
          try {
            const [age, swaps] = await Promise.all([
              fetchWalletAge(trader.walletAddress),
              fetchWalletSwapHistory(trader.walletAddress, 30, solPrice),
            ]);
            return { ...trader, walletAgeDays: age, swaps };
          } catch (err) {
            console.warn(
              `[Pipeline] SolScan error for ${trader.walletAddress.slice(0, 8)}…:`,
              err
            );
            return null;
          }
        })
      );

      for (const r of results) {
        if (r) walletData.push(r);
      }

      // Brief pause between batches for rate limiting
      if (i + CONCURRENCY < uniqueTraders.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    console.log(
      `[Pipeline] ${walletData.length} wallets fetched from SolScan`
    );

    // Step 4: Bot filter (Stage 1 hard gates, synchronous)
    console.log("[Pipeline] Running bot filter...");
    const humanWallets = filterBots(walletData);
    console.log(
      `[Pipeline] ${humanWallets.length} wallets passed bot filter`
    );

    // Step 5: Win rate filter (>= 57% on 30d)
    console.log("[Pipeline] Calculating win rates...");
    const winRateWallets = filterByWinRate(
      humanWallets.map((w) => ({
        walletAddress: w.walletAddress,
        swaps: w.swaps,
      }))
    );
    console.log(
      `[Pipeline] ${winRateWallets.length} wallets passed win rate filter (>= 57%)`
    );

    // Step 6: Persist results
    console.log("[Pipeline] Persisting results...");
    const resultWallets: ScanResult["wallets"] = [];

    for (const wallet of winRateWallets) {
      const profData = uniqueTraders.find(
        (p) => p.walletAddress === wallet.walletAddress
      );
      if (!profData) continue;

      const wr = wallet.winRate;

      // Upsert discovered wallet
      const existing = await db
        .select({ id: discoveredWallets.id })
        .from(discoveredWallets)
        .where(eq(discoveredWallets.address, wallet.walletAddress))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(discoveredWallets)
          .set({
            botScore: 0, // No scoring — hard gates only
            winrate7d: wr.winrate7d,
            winrate30d: wr.winrate30d,
            winrateAlltime: wr.winrateAlltime,
            totalTrades: wr.totalClosedTrades + wr.openPositions,
            lastActive: wallet.swaps[0]?.blockTime ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(discoveredWallets.address, wallet.walletAddress));
      } else {
        await db.insert(discoveredWallets).values({
          address: wallet.walletAddress,
          botScore: 0,
          winrate7d: wr.winrate7d,
          winrate30d: wr.winrate30d,
          winrateAlltime: wr.winrateAlltime,
          totalTrades: wr.totalClosedTrades + wr.openPositions,
          lastActive: wallet.swaps[0]?.blockTime ?? new Date(),
        });
      }

      // Insert scan-wallet result
      await db.insert(scanWalletResults).values({
        scanId: scan.id,
        walletAddress: wallet.walletAddress,
        realizedPnl: profData.realizedPnl.toString(),
        amountBought: profData.amountBought.toString(),
        pnlRatio: profData.pnlRatio,
      });

      resultWallets.push({
        address: wallet.walletAddress,
        pnlRatio: profData.pnlRatio,
        realizedPnl: profData.realizedPnl,
        amountBought: profData.amountBought,
      });
    }

    // Update scan as completed
    const duration = Date.now() - startTime;
    await db
      .update(scans)
      .set({
        status: "completed",
        walletsFound: resultWallets.length,
        duration,
        completedAt: new Date(),
      })
      .where(eq(scans.id, scan.id));

    console.log(
      `[Pipeline] Scan complete. ${resultWallets.length} wallets found in ${duration}ms`
    );

    return {
      scanId: scan.id,
      trendingCoins,
      walletsFound: resultWallets.length,
      wallets: resultWallets,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await db
      .update(scans)
      .set({
        status: "failed",
        error: errorMessage,
        duration,
        completedAt: new Date(),
      })
      .where(eq(scans.id, scan.id));

    console.error("[Pipeline] Scan failed:", errorMessage);

    return {
      scanId: scan.id,
      trendingCoins: [],
      walletsFound: 0,
      wallets: [],
      duration,
      error: errorMessage,
    };
  }
}
