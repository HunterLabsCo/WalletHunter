import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { adminUsers, users, subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  ADMIN_COOKIE_MAX_AGE,
  ADMIN_COOKIE_NAME,
  createAdminToken,
} from "@/lib/admin/session";
import { logAdminAction } from "@/lib/admin/audit";

export const runtime = "nodejs";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

function linkedEmailFor(username: string): string {
  // .local TLD is reserved, can't be registered by real users
  return `admin-${username.toLowerCase()}@wallethunter.local`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const { username, password } = parsed.data;

  const [admin] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .limit(1);

  if (!admin || !admin.passwordHash) {
    // Constant-time-ish: still hash a dummy to slow down enumeration
    await bcrypt.compare(password, "$2a$12$0000000000000000000000000000000000000000000000000000");
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Ensure a linked regular-user account exists so this admin can use the
  // main site features (scanning, watchlist, billing, etc.) without a
  // second signup. Grants whale lifetime tier automatically.
  const linkedEmail = linkedEmailFor(username);
  const linkedPasswordHash = await bcrypt.hash(password, 12);

  let linkedUserId = admin.userId;

  if (!linkedUserId) {
    // First login: check if a user with that email already exists (edge case
    // from earlier attempts) — if so, reuse it; otherwise create fresh.
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, linkedEmail))
      .limit(1);

    if (existing) {
      linkedUserId = existing.id;
    } else {
      const [created] = await db
        .insert(users)
        .values({
          email: linkedEmail,
          passwordHash: linkedPasswordHash,
          authMethod: "email",
        })
        .returning({ id: users.id });
      linkedUserId = created.id;
    }

    // Whale lifetime subscription (upsert in case of retries)
    await db
      .insert(subscriptions)
      .values({
        userId: linkedUserId,
        tier: "whale",
        status: "lifetime",
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: {
          tier: "whale",
          status: "lifetime",
          currentPeriodStart: new Date(),
          currentPeriodEnd: null,
          updatedAt: new Date(),
        },
      });

    // Link admin row to the user
    await db
      .update(adminUsers)
      .set({ userId: linkedUserId })
      .where(eq(adminUsers.id, admin.id));
  } else {
    // Keep the linked user's password in sync with the admin's current
    // submitted password so NextAuth sign-in works with the same creds.
    await db
      .update(users)
      .set({ passwordHash: linkedPasswordHash, updatedAt: new Date() })
      .where(eq(users.id, linkedUserId));
  }

  const token = await createAdminToken(admin.id, username, admin.role);

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });

  await db
    .update(adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUsers.id, admin.id));

  await logAdminAction(admin.id, "admin_login", "admin", admin.id, { username });

  // Return the linked email so the client can also sign into NextAuth
  // with the same password the admin just submitted.
  return NextResponse.json({ success: true, userEmail: linkedEmail });
}
