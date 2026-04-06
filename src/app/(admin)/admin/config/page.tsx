"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Plus, Shield } from "lucide-react";

interface ConfigEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

// Default configurable keys for the app
const DEFAULT_KEYS = [
  { key: "bot_filter.min_wallet_age_days", description: "Min wallet age (days)", defaultValue: 21 },
  { key: "bot_filter.min_swaps_30d", description: "Min swaps in 30 days", defaultValue: 50 },
  { key: "bot_filter.min_losses", description: "Min losses required", defaultValue: 3 },
  { key: "bot_filter.score_threshold", description: "Bot score threshold (0-1)", defaultValue: 0.6 },
  { key: "profitability.min_pnl_ratio", description: "Min PNL ratio", defaultValue: 3.0 },
  { key: "profitability.min_trades", description: "Min trades for profitability", defaultValue: 3 },
  { key: "winrate.min_closed_trades", description: "Min closed trades for win rate", defaultValue: 5 },
  { key: "winrate.threshold", description: "Min win rate (0-1)", defaultValue: 0.57 },
  { key: "scan.trending_coins_count", description: "Trending coins per scan", defaultValue: 3 },
  { key: "scan.min_liquidity_usd", description: "Min liquidity (USD)", defaultValue: 50000 },
];

export default function AdminConfigPage() {
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchConfigs() {
      try {
        const res = await fetch("/api/admin/config");
        if (res.status === 403) {
          setError("Access denied");
          return;
        }
        const data = await res.json();
        setConfigs(data.configs ?? []);

        // Initialize edit values
        const vals: Record<string, string> = {};
        for (const c of data.configs ?? []) {
          vals[c.key] = JSON.stringify(c.value);
        }
        setEditValues(vals);
      } catch {
        setError("Failed to load config");
      } finally {
        setLoading(false);
      }
    }
    fetchConfigs();
  }, []);

  async function handleSave(key: string) {
    setSaving(key);
    try {
      let value: unknown;
      try {
        value = JSON.parse(editValues[key] ?? "null");
      } catch {
        value = editValues[key];
      }

      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Save failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(null);
    }
  }

  if (error === "Access denied") {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <Shield className="w-12 h-12 text-destructive/30 mx-auto mb-4" />
          <p className="text-destructive font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">App Configuration</h1>
      <p className="text-sm text-muted-foreground">
        Modify pipeline logic, thresholds, and scan parameters at runtime.
        Changes take effect on the next scan.
      </p>

      {error && error !== "Access denied" && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-sm px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {DEFAULT_KEYS.map((dk) => {
            const existing = configs.find((c) => c.key === dk.key);
            const currentValue =
              editValues[dk.key] ??
              (existing ? JSON.stringify(existing.value) : String(dk.defaultValue));

            return (
              <Card key={dk.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {dk.description}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground font-mono">
                    {dk.key}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <Input
                      value={currentValue}
                      onChange={(e) =>
                        setEditValues((prev) => ({
                          ...prev,
                          [dk.key]: e.target.value,
                        }))
                      }
                      className="font-mono text-sm"
                    />
                    <Button
                      size="sm"
                      className="gap-1 shrink-0"
                      onClick={() => handleSave(dk.key)}
                      disabled={saving === dk.key}
                    >
                      {saving === dk.key ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      Save
                    </Button>
                  </div>
                  {existing && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last updated:{" "}
                      {new Date(existing.updatedAt).toLocaleString()}
                    </p>
                  )}
                  {!existing && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Default: {dk.defaultValue}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
