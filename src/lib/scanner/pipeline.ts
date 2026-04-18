/**
 * Scan Pipeline Orchestrator
 *
 * Flow:
 * 1. Fetch top 3 trending Solana coins (GeckoTerminal)
 * 2. For each coin, find wallets with >= 3x realized PNL (Helius)
 * 3. Persist results to database
 *
 * Bot filter + win rate will be layered in later.
 */

import { fetchTrendingCoins, type TrendingCoin } from "@/lib/external-apis/dexscreener";
import { fetchTopTradersForToken, getSolPriceUsd } from "@/lib/external-apis/helius";
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

export async function runScanPipeline(
  userId: string | null,
  scanType: "manual" | "auto"
): Promise<ScanResult> {
  const startTime = Date.now();

  const [scan] = await db
    .insert(scans)
    .values({
      userId,
      type: scanType,
      status: "running",
    })
    .returning({ id: scans.id });

  try {
    // Step 1: Top 3 trending Solana coins
    console.log("[Pipeline] Fetching trending coins...");
    const trendingCoins = await fetchTrendingCoins();

    if (!trendingCoins.length) {
      throw new Error("No trending Solana coins found");
    }

    console.log(
      `[Pipeline] Found ${trendingCoins.length} trending coins:`,
      trendingCoins.map((c) => c.symbol).join(", ")
    );

    await db
      .update(scans)
      .set({ trendingCoins: trendingCoins })
      .where(eq(scans.id, scan.id));

    // Step 2: Per-token top traders with >= 3x filter
    console.log("[Pipeline] Fetching top traders with 3x filter...");
    const solPrice = await getSolPriceUsd();
    console.log(`[Pipeline] SOL price: $${solPrice.toFixed(2)}`);

    const allTraders: Array<{
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
      allTraders.push(...traders);
      console.log(
        `[Pipeline] ${coin.symbol}: ${traders.length} wallets passed 3x filter`
      );
    }

    // Deduplicate — keep best PNL ratio per wallet
    const deduped = new Map<string, (typeof allTraders)[number]>();
    for (const trader of allTraders) {
      const existing = deduped.get(trader.walletAddress);
      if (!existing || trader.pnlRatio > existing.pnlRatio) {
        deduped.set(trader.walletAddress, trader);
      }
    }
    const uniqueTraders = [...deduped.values()];

    console.log(
      `[Pipeline] ${uniqueTraders.length} unique wallets passed 3x filter`
    );

    // Step 3: Persist results
    console.log("[Pipeline] Persisting results...");
    const resultWallets: ScanResult["wallets"] = [];

    for (const trader of uniqueTraders) {
      // Upsert discovered wallet (no win rate / bot data yet)
      const existing = await db
        .select({ id: discoveredWallets.id })
        .from(discoveredWallets)
        .where(eq(discoveredWallets.address, trader.walletAddress))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(discoveredWallets)
          .set({
            botScore: 0,
            updatedAt: new Date(),
          })
          .where(eq(discoveredWallets.address, trader.walletAddress));
      } else {
        await db.insert(discoveredWallets).values({
          address: trader.walletAddress,
          botScore: 0,
        });
      }

      await db.insert(scanWalletResults).values({
        scanId: scan.id,
        walletAddress: trader.walletAddress,
        realizedPnl: trader.realizedPnl.toString(),
        amountBought: trader.amountBought.toString(),
        pnlRatio: trader.pnlRatio,
      });

      resultWallets.push({
        address: trader.walletAddress,
        pnlRatio: trader.pnlRatio,
        realizedPnl: trader.realizedPnl,
        amountBought: trader.amountBought,
      });
    }

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
