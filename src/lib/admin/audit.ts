/**
 * Admin Audit Logger — SERVER-SIDE ONLY
 *
 * Logs all admin actions for accountability.
 */

import { db } from "@/lib/db";
import { adminAuditLog } from "@/lib/db/schema";

export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminUserId,
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    details: details ?? null,
  });
}
