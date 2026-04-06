"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, TrendingUp, Eye, Zap, Loader2 } from "lucide-react";
import Link from "next/link";

interface WalletResult {
  address: string;
  pnlRatio: number | null;
  realizedPnl: string | null;
  winrate30d: number | null;
  totalTrades: number | null;
  lastActive: string | null;
}

interface ScanData {
  scan: {
    id: string;
    status: string;
    walletsFound: number;
    trendingCoins: Array<{ symbol?: string; name?: string }> | null;
    duration: number | null;
    startedAt: string;
    error: string | null;
  } | null;
  wallets: WalletResult[];
  tier: string;
  totalScans: number;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const tier =
    (session?.user as Record<string, unknown>)?.tier as string ?? "free";
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch("/api/scan/results");
      if (res.ok) {
        const data = await res.json();
        setScanData(data);
      }
    } catch {
      // silent fail on load
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  async function handleScan() {
    setScanning(true);
    setScanError(null);

    try {
      const res = await fetch("/api/scan/trigger", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setScanError(data.error ?? "Scan failed");
        return;
      }

      // Refresh results
      await fetchResults();
    } catch {
      setScanError("Network error. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  const wallets = scanData?.wallets ?? [];
  const latestScan = scanData?.scan;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Discover profitable Solana wallets from trending coins.
          </p>
        </div>
        <Button
          className="gap-2"
          onClick={handleScan}
          disabled={scanning}
        >
          {scanning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          {scanning ? "Scanning..." : "Scan Now"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Wallets Found
            </CardTitle>
            <TrendingUp className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {latestScan?.walletsFound ?? "--"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {latestScan ? "From latest scan" : "Run your first scan"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Win Rate
            </CardTitle>
            <Zap className="w-4 h-4 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {wallets.length > 0
                ? `${Math.round(
                    (wallets
                      .filter((w) => w.winrate30d !== null)
                      .reduce((sum, w) => sum + (w.winrate30d ?? 0), 0) /
                      Math.max(1, wallets.filter((w) => w.winrate30d !== null).length)) * 100
                  )}%`
                : "--"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Across discovered wallets</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Watchlist
            </CardTitle>
            <Eye className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground mt-1">
              {tier === "free" ? "3 slots available" : "Add wallets to track"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Scans
            </CardTitle>
            <Search className="w-4 h-4 text-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {scanData?.totalScans ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {latestScan?.duration
                ? `Last scan: ${(latestScan.duration / 1000).toFixed(1)}s`
                : "No scans yet"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trending Coins */}
      {latestScan?.trendingCoins && latestScan.trendingCoins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trending Coins (Latest Scan)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 flex-wrap">
              {latestScan.trendingCoins.map((coin, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 bg-primary/10 text-primary text-sm font-semibold rounded-sm"
                >
                  {coin.symbol ?? coin.name ?? "Unknown"}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Discovered Wallets
            {tier === "free" && wallets.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                (showing {Math.min(wallets.length, 5)} of{" "}
                {latestScan?.walletsFound ?? wallets.length} — upgrade to see
                all)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wallets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-foreground mb-1">
                No wallets discovered yet
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Click &quot;Scan Now&quot; to search trending Solana coins and discover profitable wallets.
              </p>
              <Button className="mt-4 gap-2" onClick={handleScan} disabled={scanning}>
                <Search className="w-4 h-4" />
                Run First Scan
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-3 px-2 font-medium">Wallet</th>
                    <th className="text-right py-3 px-2 font-medium">PNL Ratio</th>
                    <th className="text-right py-3 px-2 font-medium">Win Rate</th>
                    <th className="text-right py-3 px-2 font-medium">Trades</th>
                    <th className="text-right py-3 px-2 font-medium">Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {wallets.map((w) => (
                    <tr
                      key={w.address}
                      className="border-b border-border/50 hover:bg-accent/50 transition-colors"
                    >
                      <td className="py-3 px-2">
                        <Link
                          href={`/wallet/${w.address}`}
                          className="font-mono text-xs text-secondary hover:underline"
                        >
                          {w.address.slice(0, 6)}...{w.address.slice(-4)}
                        </Link>
                      </td>
                      <td className="text-right py-3 px-2">
                        <span className="text-primary font-semibold">
                          {w.pnlRatio ? `${w.pnlRatio.toFixed(1)}x` : "--"}
                        </span>
                      </td>
                      <td className="text-right py-3 px-2">
                        {w.winrate30d !== null
                          ? `${Math.round(w.winrate30d * 100)}%`
                          : "--"}
                      </td>
                      <td className="text-right py-3 px-2">
                        {w.totalTrades ?? "--"}
                      </td>
                      <td className="text-right py-3 px-2 text-muted-foreground text-xs">
                        {w.lastActive
                          ? new Date(w.lastActive).toLocaleDateString()
                          : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
