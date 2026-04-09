/**
 * Scan Pipeline Orchestrator
 *
 * Flow:
 * 1. Fetch trending coins from DexScreener
 * 2. Fetch top traders per coin via Helius
 * 3. Filter by profitability (>= 3x PNL ratio)
 * 4. Filter bots (hard gates + behavioral scoring)
 * 5. Calculate win rates (FIFO cost basis, 7d/30d/all-time)
 * 6. Filter by win rate (>= 57% on 30d)
 * 7. Persist results to database
 *
 * All scoring/filtering logic runs SERVER-SIDE ONLY.
 */

import { fetchTrendingCoins, type TrendingCoin } from "@/lib/external-apis/dexscreener";
import { fetchTopTradersForToken } from "@/lib/external-apis/helius";
import { filterByProfitability } from "./profitability-filter";
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
    botScore: number;
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
    // Step 1: Fetch trending coins
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

    // Step 2: Fetch top traders for each coin
    console.log("[Pipeline] Fetching top traders...");
    const allTraderAddresses: string[] = [];

    for (let i = 0; i < trendingCoins.length; i++) {
      // Throttle between Helius enhanced-API calls to stay under the
      // free-tier burst limit; otherwise we exhaust our rate budget
      // before the profitability filter even starts.
      if (i > 0) await new Promise((r) => setTimeout(r, 1000));

      const coin = trendingCoins[i];
      const traders = await fetchTopTradersForToken(coin.tokenAddress);
      const addresses = traders.map((t) => t.walletAddress);
      allTraderAddresses.push(...addresses);
      console.log(
        `[Pipeline] ${coin.symbol}: ${addresses.length} traders found`
      );
    }

    // Deduplicate and cap candidate pool. Each surviving candidate
    // costs ~1 second of Helius throttle + page-fetch time, so we
    // have to stay under Vercel's 60s function limit. 40 keeps total
    // scan duration comfortably below that. Raise this once we upgrade
    // off the Helius free tier.
    const MAX_CANDIDATES = 40;
    const uniqueAddresses = [...new Set(allTraderAddresses)].slice(
      0,
      MAX_CANDIDATES
    );
    console.log(
      `[Pipeline] ${uniqueAddresses.length} unique wallets to analyze (capped at ${MAX_CANDIDATES})`
    );

    if (!uniqueAddresses.length) {
      throw new Error("No traders found for trending coins");
    }

    // Step 3: Filter by profitability (>= 3x)
    console.log("[Pipeline] Running profitability filter...");
    const profitable = await filterByProfitability(uniqueAddresses);
    console.log(
      `[Pipeline] ${profitable.length} wallets passed profitability filter`
    );

    if (!profitable.length) {
      // Still a valid scan, just no results
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

    // Step 4: Bot filter
    console.log("[Pipeline] Running bot filter...");
    const humanWallets = await filterBots(
      profitable.map((w) => ({
        walletAddress: w.walletAddress,
        swaps: w.swaps,
      }))
    );
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
      const profData = profitable.find(
        (p) => p.walletAddress === wallet.walletAddress
      );
      const botData = humanWallets.find(
        (h) => h.walletAddress === wallet.walletAddress
      );
      if (!profData || !botData) continue;

      const wr = wallet.winRate;

      // Upsert discovered wallet with win rate data
      const existing = await db
        .select({ id: discoveredWallets.id })
        .from(discoveredWallets)
        .where(eq(discoveredWallets.address, wallet.walletAddress))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(discoveredWallets)
          .set({
            botScore: botData.botScore,
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
          botScore: botData.botScore,
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
        botScore: botData.botScore,
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
