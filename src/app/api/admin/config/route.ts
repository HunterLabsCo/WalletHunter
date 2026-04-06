import { NextResponse } from "next/server";
import { requireAdmin, requireOwner } from "@/lib/admin/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const configs = await db.select().from(appConfig);

  return NextResponse.json({ configs });
}

const updateConfigSchema = z.object({
  key: z.string().min(1).max(128),
  value: z.unknown(),
});

export async function PUT(request: Request) {
  // Only owner can modify config
  const admin = await requireOwner();
  if (!admin) {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { key, value } = parsed.data;

  // Upsert config
  const [existing] = await db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(appConfig)
      .set({ value, updatedAt: new Date(), updatedBy: admin.adminId })
      .where(eq(appConfig.key, key));
  } else {
    await db.insert(appConfig).values({
      key,
      value,
      updatedBy: admin.adminId,
    });
  }

  await logAdminAction(admin.adminId, "update_config", "config", key, {
    value,
  });

  return NextResponse.json({ success: true });
}
