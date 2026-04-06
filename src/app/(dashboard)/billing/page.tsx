"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Copy, ExternalLink } from "lucide-react";

interface PaymentRequest {
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

const TIERS = [
  {
    id: "hunter",
    name: "Hunter",
    price: 49,
    features: ["3 scans/day", "100 wallet results", "7d win rates", "Email support"],
  },
  {
    id: "alpha",
    name: "Alpha",
    price: 99,
    features: [
      "10 scans/day",
      "100 wallet results",
      "All-time stats",
      "Wallet tags",
      "Priority support",
    ],
    popular: true,
  },
  {
    id: "whale",
    name: "Whale",
    price: 199,
    features: [
      "Unlimited scans",
      "All wallet data",
      "Auto-scan alerts",
      "Full PNL history",
      "Dedicated support",
    ],
  },
];

export default function BillingPage() {
  const { data: session } = useSession();
  const userObj = session?.user as Record<string, unknown> | undefined;
  const currentTier = (userObj?.tier as string) ?? "free";
  const subscriptionStatus = (userObj?.subscriptionStatus as string) ?? "active";

  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"SOL" | "USDC">("USDC");
  const [payment, setPayment] = useState<PaymentRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSelectTier(tierId: string) {
    setSelectedTier(tierId);
    setPayment(null);
    setVerified(false);
    setError(null);
  }

  async function handleCreatePayment(isLifetime = false) {
    if (!selectedTier && !isLifetime) return;
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: isLifetime ? "whale" : selectedTier,
          currency,
          isLifetime,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create payment");
        return;
      }

      setPayment(data);
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  const handleVerify = useCallback(async () => {
    if (!payment) return;
    setVerifying(true);

    try {
      const res = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceKey: payment.referenceKey }),
      });

      const data = await res.json();
      if (data.verified) {
        setVerified(true);
      }
    } catch {
      // Silent — user can retry
    } finally {
      setVerifying(false);
    }
  }, [payment]);

  // Auto-poll for verification every 10s when payment is pending
  useEffect(() => {
    if (!payment || verified) return;

    const interval = setInterval(handleVerify, 10_000);
    return () => clearInterval(interval);
  }, [payment, verified, handleVerify]);

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Current plan:{" "}
          <span className="text-primary font-semibold capitalize">
            {currentTier}
          </span>
          {subscriptionStatus === "lifetime" && (
            <span className="ml-2 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-sm">
              LIFETIME
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-sm px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {verified && (
        <div className="bg-primary/10 border border-primary/30 rounded-sm px-4 py-3 text-sm text-primary">
          <Check className="w-4 h-4 inline mr-2" />
          Payment confirmed! Your subscription is now active. Refresh the page to see
          updated features.
        </div>
      )}

      {/* Payment pending state */}
      {payment && !verified && (
        <Card className="border-secondary/30">
          <CardHeader>
            <CardTitle className="text-base">Complete Your Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted rounded-sm p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Send to:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">
                    {payment.treasuryAddress.slice(0, 8)}...
                    {payment.treasuryAddress.slice(-8)}
                  </span>
                  <button
                    onClick={() => copyToClipboard(payment.treasuryAddress)}
                    className="text-secondary hover:text-secondary/80"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-bold text-primary">
                  {payment.currency === "SOL"
                    ? `${payment.amountSol} SOL`
                    : `${payment.amountUsdc} USDC`}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Memo:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{payment.memo}</span>
                  <button
                    onClick={() => copyToClipboard(payment.memo)}
                    className="text-secondary hover:text-secondary/80"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Plan:</span>
                <span className="capitalize">
                  {payment.isLifetime ? "Lifetime (Whale)" : payment.tier}
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Send the exact amount to the address above using any Solana wallet
              (Phantom, Solflare, etc). Include the memo for faster verification.
              We auto-check every 10 seconds.
            </p>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="gap-2"
                onClick={handleVerify}
                disabled={verifying}
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Check Payment
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPayment(null);
                  setSelectedTier(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tier selection */}
      {!payment && (
        <>
          {/* Currency toggle */}
          <div className="flex gap-2">
            <Button
              variant={currency === "USDC" ? "default" : "outline"}
              size="sm"
              onClick={() => setCurrency("USDC")}
            >
              USDC
            </Button>
            <Button
              variant={currency === "SOL" ? "default" : "outline"}
              size="sm"
              onClick={() => setCurrency("SOL")}
            >
              SOL
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TIERS.map((tier) => (
              <Card
                key={tier.id}
                className={`cursor-pointer transition-all ${
                  selectedTier === tier.id
                    ? "border-primary ring-1 ring-primary"
                    : "hover:border-border/80"
                } ${tier.popular ? "ring-1 ring-secondary/30" : ""}`}
                onClick={() => handleSelectTier(tier.id)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{tier.name}</CardTitle>
                    {tier.popular && (
                      <span className="text-xs bg-secondary/20 text-secondary px-2 py-0.5 rounded-sm">
                        Popular
                      </span>
                    )}
                  </div>
                  <p className="text-3xl font-bold text-primary mt-2">
                    ${tier.price}
                    <span className="text-sm font-normal text-muted-foreground">
                      /mo
                    </span>
                  </p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {tier.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-primary" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {currentTier === tier.id ? (
                    <p className="mt-4 text-xs text-primary font-medium">
                      Current Plan
                    </p>
                  ) : (
                    <Button
                      className="mt-4 w-full"
                      variant={selectedTier === tier.id ? "default" : "outline"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTier(tier.id);
                        handleCreatePayment();
                      }}
                      disabled={creating}
                    >
                      {creating && selectedTier === tier.id ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : null}
                      {currentTier === "free" ? "Subscribe" : "Switch Plan"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Lifetime Deal */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-4 py-6">
              <div className="flex-1">
                <h3 className="font-bold text-lg">
                  Founding Member Lifetime Deal
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  One-time payment of $1,499. Get Whale tier forever. Limited to
                  100 spots.
                </p>
              </div>
              <Button
                className="gap-2 whitespace-nowrap"
                onClick={() => {
                  setSelectedTier("whale");
                  handleCreatePayment(true);
                }}
                disabled={creating}
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Get Lifetime Access
                <ExternalLink className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
