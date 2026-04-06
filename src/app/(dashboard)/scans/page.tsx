"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Clock, CheckCircle, XCircle } from "lucide-react";

interface ScanEntry {
  id: string;
  type: string;
  status: string;
  walletsFound: number;
  trendingCoins: Array<{ symbol?: string; name?: string }> | null;
  duration: number | null;
  startedAt: string;
  error: string | null;
}

export default function ScanHistoryPage() {
  const [scans, setScans] = useState<ScanEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchScans() {
      try {
        const res = await fetch("/api/scan/history");
        if (res.ok) {
          const data = await res.json();
          setScans(data.scans ?? []);
        }
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    }
    fetchScans();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scan History</h1>
        <p className="text-muted-foreground text-sm mt-1">
          View all your past scans and their results.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Scans</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : scans.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No scans yet. Run your first scan from the dashboard.
            </p>
          ) : (
            <div className="space-y-3">
              {scans.map((scan) => (
                <div
                  key={scan.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-sm border border-border/50"
                >
                  <div className="flex items-center gap-3">
                    {scan.status === "completed" ? (
                      <CheckCircle className="w-5 h-5 text-primary" />
                    ) : scan.status === "failed" ? (
                      <XCircle className="w-5 h-5 text-destructive" />
                    ) : (
                      <Clock className="w-5 h-5 text-secondary" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {scan.type === "auto" ? "Auto Scan" : "Manual Scan"}
                        {scan.trendingCoins && scan.trendingCoins.length > 0 && (
                          <span className="text-muted-foreground font-normal ml-2">
                            {scan.trendingCoins.map((c) => c.symbol ?? c.name).join(", ")}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(scan.startedAt).toLocaleString()}
                        {scan.duration && ` - ${(scan.duration / 1000).toFixed(1)}s`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-primary">
                      {scan.walletsFound} wallets
                    </p>
                    {scan.error && (
                      <p className="text-xs text-destructive">{scan.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
