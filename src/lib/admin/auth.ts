/**
 * Admin authentication helper — SERVER-SIDE ONLY
 *
 * Reads the wh_admin_session cookie (HMAC-signed), verifies it, and
 * confirms the admin still exists in the admin_users table.
 *
 * Completely separate from regular user NextAuth sessions.
 */

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "./session";

export interface AdminSession {
  adminId: string;
  username: string;
  role: "owner" | "admin";
}

/**
 * Verify the current admin session cookie. Returns session or null.
 */
export async function requireAdmin(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const payload = await verifyAdminToken(token);
  if (!payload) return null;

  // Confirm admin still exists (not deleted or deactivated)
  const [admin] = await db
    .select({ id: adminUsers.id, role: adminUsers.role, username: adminUsers.username })
    .from(adminUsers)
    .where(eq(adminUsers.id, payload.adminId))
    .limit(1);

  if (!admin) return null;

  return {
    adminId: admin.id,
    username: admin.username ?? payload.username,
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
