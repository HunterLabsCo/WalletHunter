import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyPayment } from "@/lib/payments/solana-pay";
import { checkRateLimit } from "@/lib/utils/rate-limiter";
import { z } from "zod";

const verifySchema = z.object({
  referenceKey: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit (verification can be called repeatedly while waiting)
  const rl = await checkRateLimit(`verify:${session.user.id}`, {
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

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const result = await verifyPayment(parsed.data.referenceKey);

  if (result.verified) {
    return NextResponse.json({
      verified: true,
      txSignature: result.txSignature,
    });
  }

  return NextResponse.json(
    { verified: false, error: result.error },
    { status: 202 } // Accepted but not yet confirmed
  );
}
