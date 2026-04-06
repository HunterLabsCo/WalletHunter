import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scans, scanWalletResults, discoveredWallets, subscriptions } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { cacheThrough } from "@/lib/cache/redis";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Rate limit
  const rl = await checkRateLimit(`results:${userId}`, RATE_LIMITS.scanResults);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.resetAt - Math.floor(Date.now() / 1000)) } }
    );
  }

  // Get subscription tier to determine result limits
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const tier = sub?.tier ?? "free";
  const walletLimit = tier === "free" ? 5 : 100;

  // Get latest completed scan for this user
  const [latestScan] = await db
    .select()
    .from(scans)
    .where(eq(scans.userId, userId))
    .orderBy(desc(scans.startedAt))
    .limit(1);

  if (!latestScan) {
    return NextResponse.json({
      scan: null,
      wallets: [],
      tier,
    });
  }

  // Get wallet results for this scan
  const results = await db
    .select({
      address: scanWalletResults.walletAddress,
      pnlRatio: scanWalletResults.pnlRatio,
      realizedPnl: scanWalletResults.realizedPnl,
      amountBought: scanWalletResults.amountBought,
    })
    .from(scanWalletResults)
    .where(eq(scanWalletResults.scanId, latestScan.id))
    .orderBy(desc(scanWalletResults.pnlRatio))
    .limit(walletLimit);

  // Enrich with discovered wallet data (win rates, age, etc.)
  const enriched = [];
  for (const r of results) {
    const [wallet] = await db
      .select({
        walletAgeDays: discoveredWallets.walletAgeDays,
        winrate30d: discoveredWallets.winrate30d,
        winrate7d: discoveredWallets.winrate7d,
        winrateAlltime: discoveredWallets.winrateAlltime,
        pnl30d: discoveredWallets.pnl30d,
        totalTrades: discoveredWallets.totalTrades,
        lastActive: discoveredWallets.lastActive,
        tags: discoveredWallets.tags,
      })
      .from(discoveredWallets)
      .where(eq(discoveredWallets.address, r.address))
      .limit(1);

    enriched.push({
      address: r.address,
      pnlRatio: r.pnlRatio,
      realizedPnl: r.realizedPnl,
      amountBought: r.amountBought,
      walletAgeDays: wallet?.walletAgeDays ?? null,
      winrate30d: wallet?.winrate30d ?? null,
      winrate7d: wallet?.winrate7d ?? null,
      totalTrades: wallet?.totalTrades ?? null,
      lastActive: wallet?.lastActive ?? null,
    });
  }

  // Count total scans today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scans)
    .where(eq(scans.userId, userId));

  return NextResponse.json({
    scan: {
      id: latestScan.id,
      status: latestScan.status,
      type: latestScan.type,
      walletsFound: latestScan.walletsFound,
      trendingCoins: latestScan.trendingCoins,
      duration: latestScan.duration,
      startedAt: latestScan.startedAt,
      completedAt: latestScan.completedAt,
      error: latestScan.error,
    },
    wallets: enriched,
    tier,
    totalScans: countResult?.count ?? 0,
  });
}
