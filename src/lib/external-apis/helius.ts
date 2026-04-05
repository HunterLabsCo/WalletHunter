/**
 * Helius API client
 * Docs: https://docs.helius.dev
 * Free tier: 1M credits/month, ~10 req/s
 */

function getApiKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) {
    throw new Error(
      "HELIUS_API_KEY is not set. Please add it to your .env.local file."
    );
  }
  return key;
}

const HELIUS_BASE = "https://api.helius.xyz";
const RPC_BASE = "https://mainnet.helius-rpc.com";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  fee: number;
  feePayer: string;
  type: string;
  source: string;
  accountData: Array<{ account: string; nativeBalanceChange: number }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  events?: {
    swap?: HeliusSwapEvent;
  };
}

export interface HeliusSwapEvent {
  nativeInput?: { account: string; amount: string };
  nativeOutput?: { account: string; amount: string };
  tokenInputs?: Array<{
    userAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  tokenOutputs?: Array<{
    userAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  tokenFees?: Array<{ userAccount: string; tokenAmount: number; mint: string }>;
  nativeFees?: Array<{ account: string; amount: string }>;
  innerSwaps?: HeliusSwapEvent[];
}

export interface ParsedSwap {
  walletAddress: string;
  tokenAddress: string;
  tokenSymbol?: string;
  side: "buy" | "sell";
  amountUsd: number;
  amountToken: number;
  txSignature: string;
  blockTime: Date;
  programId: string;
}

export interface WalletStats {
  address: string;
  firstTransactionTime: number | null;
  walletAgeDays: number;
  totalSwaps30d: number;
  failedTxRatio: number;
  swapTimestamps: number[]; // for burst detection
  uniqueTokens7d: string[];
  medianHoldTimeSeconds: number;
  dexPrograms: string[]; // unique DEX programs used
  priorityFees: number[]; // for variance calculation
  positionSizes: number[]; // for variance calculation
  firstBlockBuys: number; // count of buys in first 2 blocks
  totalBuys: number;
  jitoTipCount: number; // known MEV program interactions
  lossCount: number; // realized losses
}

// ─── Token Metadata Cache ──────────────────────────────────────────────────

const tokenPriceCache = new Map<string, { price: number; ts: number }>();

export async function getTokenPrice(mint: string): Promise<number> {
  const cached = tokenPriceCache.get(mint);
  if (cached && Date.now() - cached.ts < 60_000) return cached.price;

  try {
    const res = await fetch(
      `https://price.jup.ag/v6/price?ids=${mint}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const price = data.data?.[mint]?.price ?? 0;
    tokenPriceCache.set(mint, { price, ts: Date.now() });
    return price;
  } catch {
    return 0;
  }
}

// ─── Top Traders from Token ────────────────────────────────────────────────

/**
 * Get top traders for a token by fetching recent swap transactions
 * and ranking by realized PNL
 */
export async function fetchTopTradersForToken(
  tokenMint: string,
  limit = 50
): Promise<Array<{ walletAddress: string; realizedPnl: number; amountBought: number; pnlRatio: number }>> {
  const apiKey = getApiKey();

  // Fetch recent parsed transactions for this token
  const res = await fetch(
    `${HELIUS_BASE}/v0/addresses/${tokenMint}/transactions?api-key=${apiKey}&type=SWAP&limit=100`,
    { next: { revalidate: 0 } }
  );

  if (!res.ok) {
    throw new Error(
      `Helius top traders fetch failed: ${res.status} ${res.statusText}`
    );
  }

  const txns: HeliusTransaction[] = await res.json();

  // Collect unique wallet addresses from swap events
  const walletSet = new Set<string>();
  for (const tx of txns) {
    if (tx.events?.swap) {
      const swap = tx.events.swap;
      const accounts = [
        ...(swap.tokenInputs ?? []).map((t) => t.userAccount),
        ...(swap.tokenOutputs ?? []).map((t) => t.userAccount),
      ];
      for (const acc of accounts) {
        if (acc && !acc.startsWith("11111")) walletSet.add(acc);
      }
    }
    if (tx.feePayer) walletSet.add(tx.feePayer);
  }

  // We return the wallets — PNL calculation happens in the pipeline
  // with full trade history per wallet
  const wallets = Array.from(walletSet).slice(0, limit);

  return wallets.map((addr) => ({
    walletAddress: addr,
    realizedPnl: 0, // populated later by pipeline
    amountBought: 0,
    pnlRatio: 0,
  }));
}

// ─── Wallet Transaction History ────────────────────────────────────────────

/**
 * Fetch all swap transactions for a wallet (last 90 days max)
 */
export async function fetchWalletSwaps(
  walletAddress: string,
  daysBack = 30
): Promise<ParsedSwap[]> {
  const apiKey = getApiKey();
  const cutoffTime = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const swaps: ParsedSwap[] = [];
  let before: string | undefined;

  for (let page = 0; page < 10; page++) {
    const url = new URL(
      `${HELIUS_BASE}/v0/addresses/${walletAddress}/transactions`
    );
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("type", "SWAP");
    url.searchParams.set("limit", "100");
    if (before) url.searchParams.set("before", before);

    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    if (!res.ok) break;

    const txns: HeliusTransaction[] = await res.json();
    if (!txns.length) break;

    let reachedCutoff = false;
    for (const tx of txns) {
      if (tx.timestamp < cutoffTime) {
        reachedCutoff = true;
        break;
      }

      const parsed = parseSwapTransaction(tx, walletAddress);
      if (parsed) swaps.push(parsed);
    }

    if (reachedCutoff) break;
    before = txns[txns.length - 1].signature;
    // Small delay to respect rate limits
    await new Promise((r) => setTimeout(r, 110));
  }

  return swaps;
}

/**
 * Parse a Helius transaction into a structured swap
 */
function parseSwapTransaction(
  tx: HeliusTransaction,
  walletAddress: string
): ParsedSwap | null {
  if (!tx.events?.swap) return null;

  const swap = tx.events.swap;
  const blockTime = new Date(tx.timestamp * 1000);

  // Determine if this is a buy or sell relative to the wallet
  // Buy = wallet receives token, Sell = wallet sends token
  const tokenOutputs = swap.tokenOutputs ?? [];
  const tokenInputs = swap.tokenInputs ?? [];

  // Find outputs going TO this wallet (wallet received tokens = BUY)
  const received = tokenOutputs.find((o) => o.userAccount === walletAddress);
  // Find inputs FROM this wallet (wallet sent tokens = SELL)
  const sent = tokenInputs.find((i) => i.userAccount === walletAddress);

  if (received && received.mint && received.tokenAmount > 0) {
    return {
      walletAddress,
      tokenAddress: received.mint,
      side: "buy",
      amountToken: received.tokenAmount,
      amountUsd: 0, // priced later
      txSignature: tx.signature,
      blockTime,
      programId: tx.source ?? "",
    };
  }

  if (sent && sent.mint && sent.tokenAmount > 0) {
    return {
      walletAddress,
      tokenAddress: sent.mint,
      side: "sell",
      amountToken: sent.tokenAmount,
      amountUsd: 0, // priced later
      txSignature: tx.signature,
      blockTime,
      programId: tx.source ?? "",
    };
  }

  return null;
}

// ─── Wallet Age & Stats ─────────────────────────────────────────────────────

/**
 * Get basic wallet stats needed for bot filtering
 */
export async function fetchWalletStats(
  walletAddress: string
): Promise<Pick<WalletStats, "walletAgeDays" | "firstTransactionTime">> {
  const apiKey = getApiKey();

  // Get oldest transaction to determine wallet age
  const res = await fetch(
    `${HELIUS_BASE}/v0/addresses/${walletAddress}/transactions?api-key=${apiKey}&limit=1&before=`,
    { next: { revalidate: 0 } }
  );

  if (!res.ok) {
    return { walletAgeDays: 0, firstTransactionTime: null };
  }

  // Use RPC to get account creation time more accurately
  const rpcRes = await fetch(`${RPC_BASE}/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [walletAddress, { limit: 1, commitment: "finalized" }],
    }),
    next: { revalidate: 0 },
  });

  if (!rpcRes.ok) return { walletAgeDays: 0, firstTransactionTime: null };

  const rpcData = await rpcRes.json();
  const signatures = rpcData.result ?? [];

  // Also get the oldest signature to find wallet creation
  const oldestRes = await fetch(`${RPC_BASE}/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "getSignaturesForAddress",
      params: [
        walletAddress,
        { limit: 1, commitment: "finalized", before: undefined },
      ],
    }),
    next: { revalidate: 0 },
  });

  void signatures;
  void res;

  if (!oldestRes.ok) return { walletAgeDays: 0, firstTransactionTime: null };

  // Fetch the first ever transaction
  const firstTxRes = await fetch(`${RPC_BASE}/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "getSignaturesForAddress",
      params: [
        walletAddress,
        {
          limit: 1000,
          commitment: "finalized",
        },
      ],
    }),
    next: { revalidate: 0 },
  });

  if (!firstTxRes.ok) return { walletAgeDays: 0, firstTransactionTime: null };

  const firstTxData = await firstTxRes.json();
  const allSigs = firstTxData.result ?? [];

  if (!allSigs.length) return { walletAgeDays: 0, firstTransactionTime: null };

  // Oldest is last in the array (sorted newest-first)
  const oldest = allSigs[allSigs.length - 1];
  const firstTs: number = oldest.blockTime ?? 0;

  if (!firstTs) return { walletAgeDays: 0, firstTransactionTime: null };

  const ageDays = Math.floor((Date.now() / 1000 - firstTs) / 86400);

  return { walletAgeDays: ageDays, firstTransactionTime: firstTs };
}

// ─── Batch RPC Calls ────────────────────────────────────────────────────────

/**
 * Get transaction count for a wallet in last 30 days via RPC
 */
export async function fetchRecentTransactionCount(
  walletAddress: string,
  daysBack = 30
): Promise<{ total: number; failed: number }> {
  const apiKey = getApiKey();
  const cutoff = Math.floor(Date.now() / 1000) - daysBack * 86400;

  const res = await fetch(`${RPC_BASE}/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [walletAddress, { limit: 1000, commitment: "finalized" }],
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) return { total: 0, failed: 0 };

  const data = await res.json();
  const sigs: Array<{ blockTime: number; err: unknown }> = data.result ?? [];

  const recent = sigs.filter((s) => s.blockTime >= cutoff);
  const failed = recent.filter((s) => s.err !== null).length;

  return { total: recent.length, failed };
}
