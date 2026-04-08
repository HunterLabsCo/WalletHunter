import { Providers } from "@/components/providers";

export default function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="min-h-screen bg-background">
        <header className="h-14 border-b border-border bg-card flex items-center px-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary rounded-sm flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">W</span>
            </div>
            <span className="font-bold text-foreground">
              Wallet<span className="text-primary">Hunter</span>
            </span>
            <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded-sm ml-2">
              ADMIN
            </span>
          </div>
          <nav className="ml-8 flex gap-4 text-sm">
            <a href="/admin" className="text-muted-foreground hover:text-foreground">
              Dashboard
            </a>
            <a href="/admin/users" className="text-muted-foreground hover:text-foreground">
              Users
            </a>
            <a href="/admin/config" className="text-muted-foreground hover:text-foreground">
              Config
            </a>
            <a href="/admin/audit" className="text-muted-foreground hover:text-foreground">
              Audit Log
            </a>
          </nav>
          <form action="/api/admin/logout" method="POST" className="ml-auto">
            <button
              type="submit"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </Providers>
  );
}
