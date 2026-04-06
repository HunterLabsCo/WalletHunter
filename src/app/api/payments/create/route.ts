import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createPaymentRequest, TIER_PRICES } from "@/lib/payments/solana-pay";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { z } from "zod";

const createPaymentSchema = z.object({
  tier: z.enum(["hunter", "alpha", "whale"]),
  currency: z.enum(["SOL", "USDC"]),
  isLifetime: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit
  const rl = await checkRateLimit(`payment:${session.user.id}`, {
    limit: 5,
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

  const parsed = createPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { tier, currency, isLifetime } = parsed.data;

  // Validate tier exists in pricing
  if (!isLifetime && !TIER_PRICES[tier]) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  try {
    const paymentRequest = await createPaymentRequest(
      session.user.id,
      tier,
      currency,
      isLifetime
    );

    return NextResponse.json(paymentRequest);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Payment creation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
