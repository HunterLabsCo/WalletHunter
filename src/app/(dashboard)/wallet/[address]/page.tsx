"use client";

import { use, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  Zap,
  Clock,
  BarChart3,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";

interface WalletDetail {
  address: string;
  winrate30d: number | null;
  winrate7d?: number | null;
  winrateAlltime?: number | null;
  totalTrades: number | null;
  lastActive: string | null;
  pnlRatio: number | null;
  realizedPnl: string | null;
  walletAgeDays?: number | null;
  firstSeenAt?: string | null;
  pnl30d?: string | null;
  pnlAlltime?: string | null;
  tags?: string[] | null;
  tier: string;
  scanHistory?: Array<{
    pnlRatio: number | null;
    realizedPnl: string | null;
    amountBought: string | null;
    createdAt: string;
  }>;
}

export default function WalletDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { data: session } = useSession();
  const tier =
    (session?.user as Record<string, unknown>)?.tier as string ?? "free";

  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWallet() {
      try {
        const res = await fetch(`/api/wallets/${address}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Failed to load wallet");
          return;
        }
        const data = await res.json();
        setWallet(data);
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }
    fetchWallet();
  }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !wallet) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard">
          <Button variant="ghost" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Button>
        </Link>
        <div className="text-center py-12">
          <p className="text-destructive">{error ?? "Wallet not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold font-mono">
            {address.slice(0, 8)}...{address.slice(-8)}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Wallet Detail</p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              PNL Ratio
            </CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              {wallet.pnlRatio ? `${wallet.pnlRatio.toFixed(1)}x` : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Win Rate (30d)
            </CardTitle>
            <Zap className="w-4 h-4 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {wallet.winrate30d !== null
                ? `${Math.round(wallet.winrate30d * 100)}%`
                : "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Trades
            </CardTitle>
            <BarChart3 className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {wallet.totalTrades ?? "--"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last Active
            </CardTitle>
            <Clock className="w-4 h-4 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {wallet.lastActive
                ? new Date(wallet.lastActive).toLocaleDateString()
                : "--"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Extended Stats (Paid tiers) */}
      {tier !== "free" ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Win Rate (7d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">
                {wallet.winrate7d !== null && wallet.winrate7d !== undefined
                  ? `${Math.round(wallet.winrate7d * 100)}%`
                  : "--"}
              </div>
            </CardContent>
          </Card>

          {(tier === "alpha" || tier === "whale") && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Win Rate (All-time)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold">
                  {wallet.winrateAlltime !== null &&
                  wallet.winrateAlltime !== undefined
                    ? `${Math.round(wallet.winrateAlltime * 100)}%`
                    : "--"}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Wallet Age
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">
                {wallet.walletAgeDays ? `${wallet.walletAgeDays}d` : "--"}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-primary/20">
          <CardContent className="flex items-center gap-4 py-6">
            <Lock className="w-8 h-8 text-primary/50" />
            <div>
              <p className="font-semibold">
                Upgrade for more data
              </p>
              <p className="text-sm text-muted-foreground">
                Get 7-day win rates, wallet age, PNL history, and more with a
                paid plan.
              </p>
            </div>
            <Link href="/pricing" className="ml-auto">
              <Button size="sm">View Plans</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Scan History (Paid tiers) */}
      {wallet.scanHistory && wallet.scanHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-2 font-medium">Date</th>
                    <th className="text-right py-3 px-2 font-medium">
                      PNL Ratio
                    </th>
                    <th className="text-right py-3 px-2 font-medium">
                      Realized PNL (USD)
                    </th>
                    <th className="text-right py-3 px-2 font-medium">
                      Amount Bought (USD)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.scanHistory.map((entry, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 hover:bg-accent/50 transition-colors"
                    >
                      <td className="py-3 px-2 text-muted-foreground text-xs">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </td>
                      <td className="text-right py-3 px-2">
                        <span className="text-primary font-semibold">
                          {entry.pnlRatio
                            ? `${entry.pnlRatio.toFixed(1)}x`
                            : "--"}
                        </span>
                      </td>
                      <td className="text-right py-3 px-2">
                        {entry.realizedPnl
                          ? `$${parseFloat(entry.realizedPnl).toFixed(2)}`
                          : "--"}
                      </td>
                      <td className="text-right py-3 px-2 text-muted-foreground">
                        {entry.amountBought
                          ? `$${parseFloat(entry.amountBought).toFixed(2)}`
                          : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {wallet.tags && wallet.tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {wallet.tags.map((tag, i) => (
                <span
                  key={i}
                  className="px-3 py-1 bg-secondary/10 text-secondary text-sm font-medium rounded-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
