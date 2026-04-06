import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { discoveredWallets, scanWalletResults, subscriptions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";
import { cacheThrough } from "@/lib/cache/redis";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { address } = await params;

  // Rate limit
  const rl = await checkRateLimit(`wallet:${session.user.id}`, RATE_LIMITS.walletDetail);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.resetAt - Math.floor(Date.now() / 1000)) } }
    );
  }

  // Validate Solana address format (base58, 32-44 chars)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  // Check subscription tier for detail level
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id))
    .limit(1);

  const tier = sub?.tier ?? "free";

  // Fetch discovered wallet data
  const [wallet] = await db
    .select()
    .from(discoveredWallets)
    .where(eq(discoveredWallets.address, address))
    .limit(1);

  if (!wallet) {
    return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  }

  // Fetch scan results for this wallet
  const scanResults = await db
    .select({
      pnlRatio: scanWalletResults.pnlRatio,
      realizedPnl: scanWalletResults.realizedPnl,
      amountBought: scanWalletResults.amountBought,
      createdAt: scanWalletResults.createdAt,
    })
    .from(scanWalletResults)
    .where(eq(scanWalletResults.walletAddress, address))
    .orderBy(desc(scanWalletResults.createdAt))
    .limit(10);

  // Build response based on tier
  const response: Record<string, unknown> = {
    address: wallet.address,
    winrate30d: wallet.winrate30d,
    totalTrades: wallet.totalTrades,
    lastActive: wallet.lastActive,
    pnlRatio: scanResults[0]?.pnlRatio ?? null,
    realizedPnl: scanResults[0]?.realizedPnl ?? null,
    tier,
  };

  // Paid tiers get additional data
  if (tier !== "free") {
    response.winrate7d = wallet.winrate7d;
    response.walletAgeDays = wallet.walletAgeDays;
    response.firstSeenAt = wallet.firstSeenAt;
    response.scanHistory = scanResults;
  }

  // Alpha+ tiers get all-time stats
  if (tier === "alpha" || tier === "whale") {
    response.winrateAlltime = wallet.winrateAlltime;
    response.pnl30d = wallet.pnl30d;
    response.pnlAlltime = wallet.pnlAlltime;
    response.tags = wallet.tags;
  }

  return NextResponse.json(response);
}
