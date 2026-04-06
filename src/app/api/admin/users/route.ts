import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { db } from "@/lib/db";
import { users, subscriptions } from "@/lib/db/schema";
import { eq, desc, sql, ilike } from "drizzle-orm";
import { z } from "zod";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") ?? "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const search = url.searchParams.get("search") ?? "";
  const offset = (page - 1) * limit;

  const conditions = search
    ? ilike(users.email, `%${search}%`)
    : undefined;

  const [userList, countResult] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        walletAddress: users.walletAddress,
        authMethod: users.authMethod,
        createdAt: users.createdAt,
        tier: subscriptions.tier,
        subscriptionStatus: subscriptions.status,
        periodEnd: subscriptions.currentPeriodEnd,
      })
      .from(users)
      .leftJoin(subscriptions, eq(users.id, subscriptions.userId))
      .where(conditions)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(conditions),
  ]);

  return NextResponse.json({
    users: userList,
    total: countResult[0]?.count ?? 0,
    page,
    limit,
  });
}

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["activate", "deactivate", "set_tier", "set_lifetime"]),
  tier: z.enum(["free", "hunter", "alpha", "whale"]).optional(),
});

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { userId, action, tier } = parsed.data;

  // Check user exists
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const now = new Date();

  switch (action) {
    case "activate": {
      await db
        .update(subscriptions)
        .set({ status: "active", updatedAt: now })
        .where(eq(subscriptions.userId, userId));
      break;
    }
    case "deactivate": {
      await db
        .update(subscriptions)
        .set({ status: "expired", tier: "free", updatedAt: now })
        .where(eq(subscriptions.userId, userId));
      break;
    }
    case "set_tier": {
      if (!tier) {
        return NextResponse.json({ error: "Tier required" }, { status: 400 });
      }
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await db
        .update(subscriptions)
        .set({
          tier,
          status: tier === "free" ? "active" : "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          updatedAt: now,
        })
        .where(eq(subscriptions.userId, userId));
      break;
    }
    case "set_lifetime": {
      await db
        .update(subscriptions)
        .set({
          tier: "whale",
          status: "lifetime",
          currentPeriodStart: now,
          currentPeriodEnd: null,
          updatedAt: now,
        })
        .where(eq(subscriptions.userId, userId));
      break;
    }
  }

  await logAdminAction(admin.adminId, action, "user", userId, { tier });

  return NextResponse.json({ success: true });
}
