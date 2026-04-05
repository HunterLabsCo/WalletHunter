"use client";

import { useSession } from "next-auth/react";

export function DashboardHeader() {
  const { data: session } = useSession();
  const tier = (session?.user as Record<string, unknown>)?.tier as string ?? "free";

  return (
    <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-card">
      <div />
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded-sm bg-primary/10 text-primary">
            {tier}
          </span>
          <span className="text-sm text-muted-foreground">
            {session?.user?.email}
          </span>
        </div>
      </div>
    </header>
  );
}
