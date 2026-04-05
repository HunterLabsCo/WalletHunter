"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, TrendingUp, Eye, Zap, Loader2 } from "lucide-react";

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
      <div className="flex items-center justify-between">
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
            <div className="text-2xl font-bold">--</div>
            <p className="text-xs text-muted-foreground mt-1">Run your first scan</p>
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
            <div className="text-2xl font-bold">--</div>
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
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold text-foreground mb-1">
              No wallets discovered yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Click &quot;Scan Now&quot; to search trending Solana coins and discover profitable wallets.
            </p>
            <Button className="mt-4 gap-2">
              <Search className="w-4 h-4" />
              Run First Scan
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
