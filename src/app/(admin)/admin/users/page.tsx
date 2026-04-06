"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  Shield,
} from "lucide-react";

interface UserRow {
  id: string;
  email: string | null;
  walletAddress: string | null;
  authMethod: string;
  createdAt: string;
  tier: string | null;
  subscriptionStatus: string | null;
  periodEnd: string | null;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "25",
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/admin/users?${params}`);
      if (res.status === 403) {
        setError("Access denied");
        return;
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleAction(
    userId: string,
    action: string,
    tier?: string
  ) {
    setActionLoading(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action, tier }),
      });
      if (res.ok) {
        await fetchUsers();
      }
    } catch {
      // Silent fail
    } finally {
      setActionLoading(null);
    }
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <Shield className="w-12 h-12 text-destructive/30 mx-auto mb-4" />
          <p className="text-destructive font-semibold">{error}</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / 25);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-sm text-muted-foreground">{total} total users</p>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-3 px-2 font-medium">
                        Email
                      </th>
                      <th className="text-left py-3 px-2 font-medium">Tier</th>
                      <th className="text-left py-3 px-2 font-medium">
                        Status
                      </th>
                      <th className="text-left py-3 px-2 font-medium">
                        Joined
                      </th>
                      <th className="text-right py-3 px-2 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-border/50 hover:bg-accent/50 transition-colors"
                      >
                        <td className="py-3 px-2">
                          <span className="text-foreground">
                            {user.email ?? user.walletAddress?.slice(0, 12) ?? "N/A"}
                          </span>
                        </td>
                        <td className="py-3 px-2">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-sm ${
                              user.tier === "whale"
                                ? "bg-primary/20 text-primary"
                                : user.tier === "alpha"
                                  ? "bg-secondary/20 text-secondary"
                                  : user.tier === "hunter"
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {(user.tier ?? "free").toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-muted-foreground text-xs">
                          {user.subscriptionStatus ?? "active"}
                          {user.periodEnd && (
                            <span className="ml-1">
                              (until{" "}
                              {new Date(user.periodEnd).toLocaleDateString()})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-muted-foreground text-xs">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex gap-1 justify-end">
                            {actionLoading === user.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                {user.subscriptionStatus !== "lifetime" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-xs h-7 px-2"
                                      onClick={() =>
                                        handleAction(user.id, "activate")
                                      }
                                    >
                                      Activate
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-xs h-7 px-2 text-destructive"
                                      onClick={() =>
                                        handleAction(user.id, "deactivate")
                                      }
                                    >
                                      Deactivate
                                    </Button>
                                  </>
                                )}
                                <select
                                  className="text-xs h-7 bg-muted border border-border rounded-sm px-1"
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleAction(
                                        user.id,
                                        "set_tier",
                                        e.target.value
                                      );
                                      e.target.value = "";
                                    }
                                  }}
                                >
                                  <option value="">Set Tier</option>
                                  <option value="free">Free</option>
                                  <option value="hunter">Hunter</option>
                                  <option value="alpha">Alpha</option>
                                  <option value="whale">Whale</option>
                                </select>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs h-7 px-2 text-primary"
                                  onClick={() =>
                                    handleAction(user.id, "set_lifetime")
                                  }
                                >
                                  Lifetime
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page >= totalPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
