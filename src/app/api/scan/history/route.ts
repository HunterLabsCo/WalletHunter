import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { scans } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limiter";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(`history:${session.user.id}`, RATE_LIMITS.scanResults);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const userScans = await db
    .select({
      id: scans.id,
      type: scans.type,
      status: scans.status,
      walletsFound: scans.walletsFound,
      trendingCoins: scans.trendingCoins,
      duration: scans.duration,
      startedAt: scans.startedAt,
      error: scans.error,
    })
    .from(scans)
    .where(eq(scans.userId, session.user.id))
    .orderBy(desc(scans.startedAt))
    .limit(50);

  return NextResponse.json({ scans: userScans });
}
