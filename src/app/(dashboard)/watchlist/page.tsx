"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, Eye } from "lucide-react";
import Link from "next/link";

interface WatchlistItem {
  id: string;
  walletAddress: string;
  nickname: string | null;
  createdAt: string;
  winrate30d: number | null;
  totalTrades: number | null;
  lastActive: string | null;
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [limit, setLimit] = useState(3);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setLimit(data.limit ?? 3);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newAddress.trim()) return;
    setAdding(true);
    setError(null);

    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: newAddress.trim(),
          nickname: newNickname.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to add");
        return;
      }

      setNewAddress("");
      setNewNickname("");
      await fetchWatchlist();
    } catch {
      setError("Network error");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(address: string) {
    await fetch(`/api/watchlist?address=${encodeURIComponent(address)}`, {
      method: "DELETE",
    });
    await fetchWatchlist();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Watchlist</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track your favorite wallets. {items.length}/{limit} slots used.
        </p>
      </div>

      {/* Add wallet form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Wallet</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-3 flex-wrap">
            <Input
              placeholder="Solana wallet address"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              className="flex-1 min-w-[280px] font-mono text-sm"
              required
            />
            <Input
              placeholder="Nickname (optional)"
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              className="w-40"
            />
            <Button
              type="submit"
              disabled={adding || items.length >= limit}
              className="gap-2"
            >
              {adding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add
            </Button>
          </form>
          {error && (
            <p className="text-sm text-destructive mt-2">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Watchlist items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tracked Wallets</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8">
              <Eye className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No wallets in your watchlist yet.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-sm border border-border/50"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      {item.nickname && (
                        <p className="text-sm font-medium">{item.nickname}</p>
                      )}
                      <Link
                        href={`/wallet/${item.walletAddress}`}
                        className="font-mono text-xs text-secondary hover:underline"
                      >
                        {item.walletAddress.slice(0, 8)}...
                        {item.walletAddress.slice(-6)}
                      </Link>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm">
                      {item.winrate30d !== null && (
                        <span className="text-primary font-semibold mr-3">
                          {Math.round(item.winrate30d * 100)}% WR
                        </span>
                      )}
                      {item.totalTrades !== null && (
                        <span className="text-muted-foreground text-xs">
                          {item.totalTrades} trades
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-8 w-8 p-0"
                      onClick={() => handleRemove(item.walletAddress)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
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
