"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { ExternalLink } from "lucide-react";

export function AdminHeaderNav() {
  async function handleSignOut() {
    // Clear admin cookie
    await fetch("/api/admin/logout", { method: "POST" });
    // Also sign out of NextAuth, then redirect to admin login
    await signOut({ redirect: false });
    window.location.href = "/admin/login";
  }

  return (
    <div className="ml-auto flex items-center gap-4">
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        View Site
      </Link>
      <button
        type="button"
        onClick={handleSignOut}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  );
}
