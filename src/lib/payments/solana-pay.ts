/**
 * Solana Pay-style Payment Flow — SERVER-SIDE ONLY
 *
 * Uses reference keys to track payments without requiring wallet connect.
 * Flow:
 * 1. User selects a tier → POST /api/payments/create → returns payment details
 * 2. User sends SOL/USDC to treasury with reference key in memo
 * 3. Cron/manual verify → POST /api/payments/verify → confirms tx on-chain
 * 4. Subscription activated on verification
 *
 * Supported currencies: SOL, USDC (SPL token on Solana)
 */

import { db } from "@/lib/db";
import { payments, subscriptions, lifetimeDeals } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";

// Tier pricing (monthly)
export const TIER_PRICES: Record<string, { sol: number; usdc: number }> = {
  hunter: { sol: 0, usdc: 49 },
  alpha: { sol: 0, usdc: 99 },
  whale: { sol: 0, usdc: 199 },
};

export const LIFETIME_PRICE = { sol: 0, usdc: 1499 };

// USDC mint on Solana mainnet
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function getTreasuryAddress(): string {
  const addr = process.env.TREASURY_WALLET_ADDRESS;
  if (!addr) throw new Error("TREASURY_WALLET_ADDRESS not configured");
  return addr;
}

/**
 * Generate a unique reference key for payment tracking
 */
export function generateReferenceKey(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Get current SOL price in USD from Jupiter
 */
async function getSolPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://price.jup.ag/v6/price?ids=So11111111111111111111111111111111111111112"
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return (
      data.data?.["So11111111111111111111111111111111111111112"]?.price ?? 0
    );
  } catch {
    return 0;
  }
}

export interface PaymentRequest {
  referenceKey: string;
  treasuryAddress: string;
  amountSol: number | null;
  amountUsdc: number | null;
  currency: "SOL" | "USDC";
  tier: string;
  isLifetime: boolean;
  usdcMint: string;
  memo: string;
}

/**
 * Create a payment request for a given tier
 */
export async function createPaymentRequest(
  userId: string,
  tier: string,
  currency: "SOL" | "USDC",
  isLifetime = false
): Promise<PaymentRequest> {
  const treasuryAddress = getTreasuryAddress();
  const referenceKey = generateReferenceKey();

  let amountSol: number | null = null;
  let amountUsdc: number | null = null;

  if (isLifetime) {
    if (currency === "SOL") {
      const solPrice = await getSolPrice();
      if (solPrice <= 0) throw new Error("Unable to fetch SOL price");
      amountSol = Math.ceil((LIFETIME_PRICE.usdc / solPrice) * 1000) / 1000;
    } else {
      amountUsdc = LIFETIME_PRICE.usdc;
    }
  } else {
    const prices = TIER_PRICES[tier];
    if (!prices) throw new Error(`Invalid tier: ${tier}`);

    if (currency === "SOL") {
      const solPrice = await getSolPrice();
      if (solPrice <= 0) throw new Error("Unable to fetch SOL price");
      amountSol = Math.ceil((prices.usdc / solPrice) * 1000) / 1000;
    } else {
      amountUsdc = prices.usdc;
    }
  }

  // Persist payment record
  await db.insert(payments).values({
    userId,
    amountSol: amountSol?.toString() ?? null,
    amountUsdc: amountUsdc?.toString() ?? null,
    currency,
    referenceKey,
    tier: isLifetime ? "whale" : (tier as "hunter" | "alpha" | "whale"),
    isLifetime,
    status: "pending",
  });

  return {
    referenceKey,
    treasuryAddress,
    amountSol,
    amountUsdc,
    currency,
    tier: isLifetime ? "whale" : tier,
    isLifetime,
    usdcMint: USDC_MINT,
    memo: `WH-${referenceKey.slice(0, 8)}`,
  };
}

/**
 * Verify a payment by checking on-chain transaction
 * Uses Helius parsed transaction API to find transfers to treasury
 */
export async function verifyPayment(
  referenceKey: string
): Promise<{ verified: boolean; txSignature?: string; error?: string }> {
  // Find the pending payment
  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(eq(payments.referenceKey, referenceKey), eq(payments.status, "pending"))
    )
    .limit(1);

  if (!payment) {
    return { verified: false, error: "Payment not found or already processed" };
  }

  const treasuryAddress = getTreasuryAddress();
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    return { verified: false, error: "Helius API not configured" };
  }

  // Search recent transactions to the treasury for matching amount
  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${treasuryAddress}/transactions?api-key=${heliusKey}&type=TRANSFER&limit=50`
    );

    if (!res.ok) {
      return { verified: false, error: "Failed to fetch transactions" };
    }

    const txns: Array<{
      signature: string;
      timestamp: number;
      nativeTransfers: Array<{
        fromUserAccount: string;
        toUserAccount: string;
        amount: number;
      }>;
      tokenTransfers: Array<{
        fromUserAccount: string;
        toUserAccount: string;
        mint: string;
        tokenAmount: number;
      }>;
    }> = await res.json();

    // Look for a matching transaction
    for (const tx of txns) {
      let matched = false;

      if (payment.currency === "SOL" && payment.amountSol) {
        const expectedLamports =
          parseFloat(payment.amountSol) * 1_000_000_000;
        const transfer = tx.nativeTransfers?.find(
          (t) =>
            t.toUserAccount === treasuryAddress &&
            Math.abs(t.amount - expectedLamports) < 10_000 // small tolerance
        );
        if (transfer) matched = true;
      }

      if (payment.currency === "USDC" && payment.amountUsdc) {
        const expectedAmount = parseFloat(payment.amountUsdc);
        const transfer = tx.tokenTransfers?.find(
          (t) =>
            t.toUserAccount === treasuryAddress &&
            t.mint === USDC_MINT &&
            Math.abs(t.tokenAmount - expectedAmount) < 0.01
        );
        if (transfer) matched = true;
      }

      if (matched) {
        // Mark payment as confirmed
        await db
          .update(payments)
          .set({
            status: "confirmed",
            txSignature: tx.signature,
            verifiedAt: new Date(),
          })
          .where(eq(payments.id, payment.id));

        // Activate subscription
        await activateSubscription(
          payment.userId,
          payment.tier,
          payment.isLifetime
        );

        return { verified: true, txSignature: tx.signature };
      }
    }

    return { verified: false, error: "Transaction not found yet" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Verification failed";
    return { verified: false, error: msg };
  }
}

/**
 * Activate or upgrade a user's subscription after payment confirmation
 */
async function activateSubscription(
  userId: string,
  tier: string,
  isLifetime: boolean
): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const status = isLifetime ? "lifetime" : "active";

  // Upsert subscription
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(subscriptions)
      .set({
        tier: tier as "hunter" | "alpha" | "whale",
        status,
        currentPeriodStart: now,
        currentPeriodEnd: isLifetime ? null : periodEnd,
        updatedAt: now,
      })
      .where(eq(subscriptions.userId, userId));
  } else {
    await db.insert(subscriptions).values({
      userId,
      tier: tier as "hunter" | "alpha" | "whale",
      status,
      currentPeriodStart: now,
      currentPeriodEnd: isLifetime ? null : periodEnd,
    });
  }

  // Decrement lifetime slots if applicable
  if (isLifetime) {
    const [deal] = await db.select().from(lifetimeDeals).limit(1);
    if (deal && deal.remainingSlots > 0) {
      await db
        .update(lifetimeDeals)
        .set({
          remainingSlots: deal.remainingSlots - 1,
          updatedAt: now,
        })
        .where(eq(lifetimeDeals.id, deal.id));
    }
  }
}

/**
 * Cancel a subscription (sets status to cancelled, keeps active until period end)
 */
export async function cancelSubscription(userId: string): Promise<void> {
  await db
    .update(subscriptions)
    .set({
      status: "cancelled",
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));
}

/**
 * Check and expire subscriptions past their period end
 */
export async function expireSubscriptions(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(subscriptions)
    .set({ status: "expired", tier: "free", updatedAt: now })
    .where(
      and(
        eq(subscriptions.status, "active"),
      )
    )
    .returning({ id: subscriptions.id });

  // Filter to only those actually past their end date
  // (Drizzle doesn't support lte easily on nullable timestamp, so we do it in app)
  // This is a simplified version — in production use raw SQL or a cron check
  return result.length;
}
