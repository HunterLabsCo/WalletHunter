import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userWatchlist, discoveredWallets, subscriptions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { checkRateLimit } from "@/lib/utils/rate-limiter";

const WATCHLIST_LIMITS: Record<string, number> = {
  free: 3,
  hunter: 10,
  alpha: 25,
  whale: 100,
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await db
    .select({
      id: userWatchlist.id,
      walletAddress: userWatchlist.walletAddress,
      nickname: userWatchlist.nickname,
      createdAt: userWatchlist.createdAt,
      winrate30d: discoveredWallets.winrate30d,
      totalTrades: discoveredWallets.totalTrades,
      lastActive: discoveredWallets.lastActive,
    })
    .from(userWatchlist)
    .leftJoin(
      discoveredWallets,
      eq(userWatchlist.walletAddress, discoveredWallets.address)
    )
    .where(eq(userWatchlist.userId, session.user.id))
    .orderBy(desc(userWatchlist.createdAt));

  // Get tier for limit info
  const [sub] = await db
    .select({ tier: subscriptions.tier })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id))
    .limit(1);

  const tier = sub?.tier ?? "free";

  return NextResponse.json({
    items,
    limit: WATCHLIST_LIMITS[tier] ?? 3,
    tier,
  });
}

const addSchema = z.object({
  walletAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  nickname: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(`watchlist:${session.user.id}`, {
    limit: 10,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  // Check watchlist limit
  const [sub] = await db
    .select({ tier: subscriptions.tier })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id))
    .limit(1);

  const tier = sub?.tier ?? "free";
  const limit = WATCHLIST_LIMITS[tier] ?? 3;

  const existing = await db
    .select({ id: userWatchlist.id })
    .from(userWatchlist)
    .where(eq(userWatchlist.userId, session.user.id));

  if (existing.length >= limit) {
    return NextResponse.json(
      { error: `Watchlist limit reached (${limit} for ${tier} tier)` },
      { status: 403 }
    );
  }

  try {
    await db.insert(userWatchlist).values({
      userId: session.user.id,
      walletAddress: parsed.data.walletAddress,
      nickname: parsed.data.nickname ?? null,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Wallet already in watchlist" },
      { status: 409 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const walletAddress = url.searchParams.get("address");

  if (!walletAddress) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }

  await db
    .delete(userWatchlist)
    .where(
      and(
        eq(userWatchlist.userId, session.user.id),
        eq(userWatchlist.walletAddress, walletAddress)
      )
    );

  return NextResponse.json({ success: true });
}
