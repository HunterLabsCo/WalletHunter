import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ArrowRight, ArrowLeft } from "lucide-react";

const tiers = [
  { name: "Free", price: "$0", period: "forever", description: "Get a taste of what WalletHunter finds.", features: ["See last 5 discovered wallets", "30-day win rate only", "2 manual scans per day", "3 watchlist slots"], cta: "Get Started", href: "/register", highlight: false },
  { name: "Hunter", price: "$49", period: "/mo", description: "For active traders who want an edge.", features: ["Full wallet results", "7d + 30d win rates", "3 manual scans/day + auto every 6h", "10 watchlist slots", "JSON export", "7-day scan archive"], cta: "Start Hunting", href: "/register", highlight: false },
  { name: "Alpha", price: "$99", period: "/mo", description: "Serious alpha. Serious results.", features: ["Everything in Hunter", "All-time win rates", "10 scans/day + auto every 2h", "50 watchlist slots", "In-app notifications", "Charts + full analytics", "30-day scan archive"], cta: "Get Alpha", href: "/register", highlight: true },
  { name: "Whale", price: "$199", period: "/mo", description: "Maximum firepower. No limits.", features: ["Everything in Alpha", "Unlimited scans + auto every 30min", "200 watchlist slots", "Telegram notifications", "CSV export", "API access", "90-day scan archive"], cta: "Go Whale", href: "/register", highlight: false },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">W</span>
            </div>
            <span className="font-bold text-foreground text-lg">Wallet<span className="text-primary">Hunter</span></span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login"><Button variant="ghost" size="sm">Sign In</Button></Link>
            <Link href="/register"><Button size="sm">Get Started</Button></Link>
          </div>
        </div>
      </nav>
      <section className="py-16 px-6 text-center">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
        <h1 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">Pay with SOL or USDC. No credit card required. No auto-charges. Annual plans save 20%.</p>
      </section>
      <section className="pb-20 px-6">
        <div className="max-w-6xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {tiers.map((tier) => (
            <Card key={tier.name} className={cn("bg-card border-border relative flex flex-col", tier.highlight && "border-primary")}>
              {tier.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-sm">Most Popular</div>}
              <CardHeader>
                <CardTitle className="text-base">{tier.name}</CardTitle>
                <div className="mt-2"><span className="text-3xl font-bold">{tier.price}</span><span className="text-muted-foreground text-sm">{tier.period}</span></div>
                <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <div className="p-6 pt-0">
                <Link href={tier.href} className="block">
                  <Button variant={tier.highlight ? "default" : "secondary"} className="w-full">{tier.cta}</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-12 max-w-2xl mx-auto">
          <Card className="bg-card border-primary/50">
            <CardContent className="p-6 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-sm bg-primary/10 text-primary text-xs font-semibold mb-3">LIMITED — 100 SPOTS</div>
              <h3 className="text-xl font-bold mb-2">Founding Member Lifetime Deal</h3>
              <p className="text-muted-foreground text-sm mb-4">Get Whale-tier access forever for a one-time payment of <span className="text-foreground font-semibold">$1,499</span>. First 100 members only.</p>
              <Link href="/register"><Button className="gap-2">Claim Your Spot <ArrowRight className="w-4 h-4" /></Button></Link>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
