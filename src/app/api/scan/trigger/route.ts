import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runScanPipeline } from "@/lib/scanner/pipeline";
import { db } from "@/lib/db";
import { scans, subscriptions } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

// Scan limits per tier
const SCAN_LIMITS: Record<string, number> = {
  free: 2,
  hunter: 3,
  alpha: 10,
  whale: 999999, // unlimited
};

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Check subscription tier for scan limits
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const tier = sub?.tier ?? "free";
  const limit = SCAN_LIMITS[tier] ?? 2;

  // Count scans today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scans)
    .where(
      and(
        eq(scans.userId, userId),
        eq(scans.type, "manual"),
        gte(scans.startedAt, todayStart)
      )
    );

  const todayCount = countResult?.count ?? 0;

  if (todayCount >= limit) {
    return NextResponse.json(
      {
        error: `Daily scan limit reached (${limit} scans/day for ${tier} tier)`,
        limit,
        used: todayCount,
      },
      { status: 429 }
    );
  }

  // Run the pipeline
  const result = await runScanPipeline(userId, "manual");

  if (result.error) {
    return NextResponse.json(
      {
        error: result.error,
        scanId: result.scanId,
        duration: result.duration,
      },
      { status: 500 }
    );
  }

  // Return opaque results — no bot scores, no filter details
  return NextResponse.json({
    scanId: result.scanId,
    trendingCoins: result.trendingCoins.map((c) => ({
      symbol: c.symbol,
      name: c.name,
    })),
    walletsFound: result.walletsFound,
    wallets: result.wallets.map((w) => ({
      address: w.address,
      pnlRatio: Math.round(w.pnlRatio * 100) / 100,
    })),
    duration: result.duration,
    scansRemaining: limit - todayCount - 1,
  });
}
