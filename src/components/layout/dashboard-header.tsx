"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { LayoutDashboard, Search, Eye, Menu } from "lucide-react";
import { useState } from "react";

export function DashboardHeader() {
  const { data: session } = useSession();
  const tier = (session?.user as Record<string, unknown>)?.tier as string ?? "free";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between h-16 px-4 sm:px-6 border-b border-border bg-card">
        <button
          className="md:hidden p-2 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="hidden md:block" />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded-sm bg-primary/10 text-primary">
              {tier}
            </span>
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {session?.user?.email}
            </span>
          </div>
        </div>
      </header>
      {mobileMenuOpen && (
        <nav className="md:hidden border-b border-border bg-card px-4 py-3 flex gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>
            <LayoutDashboard className="w-4 h-4" /> Dashboard
          </Link>
          <Link href="/scans" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>
            <Search className="w-4 h-4" /> Scans
          </Link>
          <Link href="/watchlist" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>
            <Eye className="w-4 h-4" /> Watchlist
          </Link>
        </nav>
      )}
    </>
  );
}
