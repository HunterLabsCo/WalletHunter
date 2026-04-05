import Link from "next/link";
import {
  Search,
  Shield,
  TrendingUp,
  Zap,
  Eye,
  BarChart3,
  ArrowRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: Search,
    title: "Auto-Discovery",
    description:
      "Scans trending Solana coins on DexScreener and extracts the top-performing wallets automatically.",
  },
  {
    icon: Shield,
    title: "Bot Filtering",
    description:
      "Advanced behavioral analysis removes bots, snipers, and MEV wallets. Only real human traders make it through.",
  },
  {
    icon: TrendingUp,
    title: "Win Rate Tracking",
    description:
      "FIFO cost basis calculations give you accurate 7-day, 30-day, and all-time win rates for every wallet.",
  },
  {
    icon: Zap,
    title: "Real-Time Scans",
    description:
      "Trending coins rotate every few hours. WalletHunter runs scans on schedule so you never miss alpha.",
  },
  {
    icon: Eye,
    title: "Watchlist",
    description:
      "Track your favorite discovered wallets. Get notified when they make moves.",
  },
  {
    icon: BarChart3,
    title: "Detailed Analytics",
    description:
      "PNL breakdowns, trade history, token diversity, and hold time patterns for every wallet.",
  },
];

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Get a taste of what WalletHunter finds.",
    features: [
      "See last 5 discovered wallets",
      "30-day win rate only",
      "2 manual scans per day",
      "3 watchlist slots",
    ],
    cta: "Get Started",
    href: "/register",
    highlight: false,
  },
  {
    name: "Hunter",
    price: "$49",
    period: "/mo",
    description: "For active traders who want an edge.",
    features: [
      "Full wallet results",
      "7d + 30d win rates",
      "3 manual scans/day + auto every 6h",
      "10 watchlist slots",
      "JSON export",
    ],
    cta: "Start Hunting",
    href: "/register",
    highlight: false,
  },
  {
    name: "Alpha",
    price: "$99",
    period: "/mo",
    description: "Serious alpha. Serious results.",
    features: [
      "Everything in Hunter",
      "All-time win rates",
      "10 scans/day + auto every 2h",
      "50 watchlist slots",
      "In-app notifications",
      "Charts + analytics",
    ],
    cta: "Get Alpha",
    href: "/register",
    highlight: true,
  },
  {
    name: "Whale",
    price: "$199",
    period: "/mo",
    description: "Maximum firepower. No limits.",
    features: [
      "Everything in Alpha",
      "Unlimited scans + auto every 30min",
      "200 watchlist slots",
      "Telegram notifications",
      "CSV export",
      "API access",
      "90-day scan archive",
    ],
    cta: "Go Whale",
    href: "/register",
    highlight: false,
  },
];

const faqs = [
  {
    q: "How does WalletHunter find wallets?",
    a: "We scan trending Solana coins on DexScreener, extract top traders, then run them through profitability filters and advanced bot detection. Only verified human wallets with strong track records make it to your dashboard.",
  },
  {
    q: "Are these real wallets?",
    a: "Yes. Every wallet address is real and verifiable on-chain. We pull live data from the Solana blockchain. No fake data, no simulations.",
  },
  {
    q: "How accurate is the bot filter?",
    a: "Our multi-signal behavioral analysis scores wallets across 10+ dimensions including trading patterns, timing, gas fees, and known bot programs. It catches the vast majority of bots, snipers, and MEV wallets.",
  },
  {
    q: "How are win rates calculated?",
    a: "We use FIFO (First In, First Out) cost basis to pair buy and sell transactions per token. A win is when the sell value exceeds the cost basis. Rugged tokens with zero liquidity count as losses.",
  },
  {
    q: "What payment methods do you accept?",
    a: "SOL and USDC on Solana. Connect your wallet (Phantom, Solflare, or Backpack), sign the transaction, and your subscription activates instantly.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Subscriptions are month-to-month. Simply don't renew when your period ends. There are no auto-charges — you control every payment.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">W</span>
            </div>
            <span className="font-bold text-foreground text-lg">
              Wallet<span className="text-primary">Hunter</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/login"><Button variant="ghost" size="sm">Sign In</Button></Link>
            <Link href="/register"><Button size="sm">Get Started</Button></Link>
          </div>
        </div>
      </nav>

      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-sm bg-primary/10 text-primary text-sm font-medium mb-6">
            <Zap className="w-4 h-4" />
            Solana Wallet Intelligence
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-6">
            Find the wallets<br />
            <span className="text-primary">printing money</span> on Solana
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            WalletHunter scans trending coins, filters out bots, and surfaces the most profitable human traders.
            Stop guessing. Start copying the wallets that actually win.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/register"><Button size="lg" className="gap-2">Start Hunting <ArrowRight className="w-4 h-4" /></Button></Link>
            <Link href="#how-it-works"><Button variant="secondary" size="lg">How It Works</Button></Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Free tier available. No credit card required.</p>
        </div>
      </section>

      <section id="how-it-works" className="py-20 px-6 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">How It Works</h2>
          <p className="text-muted-foreground text-center mb-16 max-w-xl mx-auto">Three steps between you and the most profitable wallets on Solana.</p>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Scan Trending Coins", desc: "WalletHunter monitors DexScreener for the hottest Solana tokens and extracts the top traders from each." },
              { step: "02", title: "Filter Out the Noise", desc: "Bots, snipers, and MEV wallets are detected and removed. Only wallets with real human trading patterns survive." },
              { step: "03", title: "Get Your Alpha", desc: "Browse curated wallets with verified win rates, PNL data, and trade history. Add the best to your watchlist." },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="text-5xl font-bold text-primary/20 mb-4">{item.step}</div>
                <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Built for Solana Traders</h2>
          <p className="text-muted-foreground text-center mb-16 max-w-xl mx-auto">Every feature is designed to give you an unfair advantage in discovering and tracking profitable wallets.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="bg-card border-border">
                <CardHeader>
                  <feature.icon className="w-10 h-10 text-primary mb-2" />
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-20 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Simple Pricing</h2>
          <p className="text-muted-foreground text-center mb-16 max-w-xl mx-auto">Pay with SOL or USDC. No credit card. No auto-charges. Cancel anytime by simply not renewing.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {tiers.map((tier) => (
              <Card key={tier.name} className={cn("bg-card border-border relative flex flex-col", tier.highlight && "border-primary")}>
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-sm">Most Popular</div>
                )}
                <CardHeader>
                  <CardTitle className="text-base">{tier.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{tier.price}</span>
                    <span className="text-muted-foreground text-sm">{tier.period}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{feature}</span>
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
                <p className="text-muted-foreground text-sm mb-4">
                  Get Whale-tier access forever for a one-time payment of{" "}
                  <span className="text-foreground font-semibold">$1,499</span>. First 100 members only. Once they&apos;re gone, they&apos;re gone.
                </p>
                <Link href="/register"><Button className="gap-2">Claim Your Spot <ArrowRight className="w-4 h-4" /></Button></Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-16">Frequently Asked Questions</h2>
          <div className="space-y-8">
            {faqs.map((faq) => (
              <div key={faq.q}>
                <h3 className="text-base font-semibold mb-2">{faq.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">
            Stop searching manually.<br />
            <span className="text-primary">Let the hunter work for you.</span>
          </h2>
          <p className="text-muted-foreground mb-8">Join WalletHunter and get the most profitable Solana wallets delivered to your dashboard.</p>
          <Link href="/register"><Button size="lg" className="gap-2">Start Hunting — Free <ArrowRight className="w-4 h-4" /></Button></Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-sm flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">W</span>
            </div>
            <span>WalletHunter</span>
          </div>
          <p>&copy; {new Date().getFullYear()} WalletHunter. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
