/**
 * Admin authentication helper — SERVER-SIDE ONLY
 *
 * Checks if the current session user is an admin.
 * Admin users must exist in the admin_users table.
 */

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface AdminSession {
  userId: string;
  adminId: string;
  role: "owner" | "admin";
}

/**
 * Verify the current session is an admin. Returns admin session or null.
 */
export async function requireAdmin(): Promise<AdminSession | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [admin] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.userId, session.user.id))
    .limit(1);

  if (!admin) return null;

  return {
    userId: session.user.id,
    adminId: admin.id,
    role: admin.role,
  };
}

/**
 * Require owner-level admin access.
 */
export async function requireOwner(): Promise<AdminSession | null> {
  const admin = await requireAdmin();
  if (!admin || admin.role !== "owner") return null;
  return admin;
}
