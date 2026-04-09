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

// Well-known mints used for USD denomination
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);

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

/**
 * Fetch the current SOL/USD spot price from Jupiter.
 * Used to convert lamport flows on every swap into USD for PNL math.
 * Cached for 60s.
 */
export async function getSolPriceUsd(): Promise<number> {
  return getTokenPrice(SOL_MINT);
}

// ─── Top Traders from Token ────────────────────────────────────────────────

/**
 * Get top traders for a token by fetching recent swap transactions and
 * extracting the human signer (fee payer) of each swap.
 *
 * IMPORTANT: We *only* use `tx.feePayer`, not `tokenInputs[].userAccount` /
 * `tokenOutputs[].userAccount`. For Jupiter / aggregator swaps, those user
 * account fields point at routing PDAs (program-owned accounts that move
 * tokens between AMMs as part of the swap path), not human wallets. Querying
 * those PDAs for swap history returns empty results, which silently
 * eliminates every candidate wallet downstream.
 *
 * The fee payer is the wallet that signed and paid for the transaction —
 * that's the actual trader.
 */
export async function fetchTopTradersForToken(
  tokenMint: string,
  limit = 50
): Promise<Array<{ walletAddress: string; realizedPnl: number; amountBought: number; pnlRatio: number }>> {
  const apiKey = getApiKey();

  // Fetch recent parsed swap transactions involving this token
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

  // Count appearances per fee payer so we can prefer wallets that have
  // traded this token multiple times (more likely to be active humans, less
  // likely to be one-shot test wallets).
  const feePayerCounts = new Map<string, number>();
  for (const tx of txns) {
    if (!tx.events?.swap) continue;
    const fp = tx.feePayer;
    if (!fp || fp.startsWith("11111")) continue;
    feePayerCounts.set(fp, (feePayerCounts.get(fp) ?? 0) + 1);
  }

  const wallets = [...feePayerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([addr]) => addr);

  return wallets.map((addr) => ({
    walletAddress: addr,
    realizedPnl: 0, // populated later by pipeline
    amountBought: 0,
    pnlRatio: 0,
  }));
}

// ─── Wallet Transaction History ────────────────────────────────────────────

/**
 * Fetch all swap transactions for a wallet (last 90 days max).
 *
 * @param solPriceUsd - Current SOL/USD price used to denominate the SOL leg
 *   of every swap into USD. Pass the same value for the whole scan so PNL is
 *   self-consistent. If 0/omitted, swaps that pay/receive SOL will have
 *   amountUsd = 0 and won't contribute to profitability/win-rate math.
 */
export async function fetchWalletSwaps(
  walletAddress: string,
  daysBack = 30,
  solPriceUsd = 0
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

      const parsed = parseSwapTransaction(tx, walletAddress, solPriceUsd);
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
 * Parse a Helius transaction into a structured swap.
 *
 * Determines whether the wallet bought or sold the non-stable token, and
 * computes the USD value of the swap from the SOL/USDC/USDT counter-leg.
 *
 * @param solPriceUsd - SOL/USD spot price (passed in so a single scan stays
 *   self-consistent and we don't refetch the price 10k times).
 */
function parseSwapTransaction(
  tx: HeliusTransaction,
  walletAddress: string,
  solPriceUsd: number
): ParsedSwap | null {
  if (!tx.events?.swap) return null;

  const swap = tx.events.swap;
  const blockTime = new Date(tx.timestamp * 1000);

  const tokenOutputs = swap.tokenOutputs ?? [];
  const tokenInputs = swap.tokenInputs ?? [];

  // Wallet's non-stable token movements. Stables are the *payment* leg —
  // we never want to mark a USDC receipt as a "buy of USDC".
  const receivedNonStable = tokenOutputs.find(
    (o) =>
      o.userAccount === walletAddress &&
      o.mint &&
      !STABLE_MINTS.has(o.mint) &&
      o.tokenAmount > 0
  );
  const sentNonStable = tokenInputs.find(
    (i) =>
      i.userAccount === walletAddress &&
      i.mint &&
      !STABLE_MINTS.has(i.mint) &&
      i.tokenAmount > 0
  );

  // Compute the USD value the wallet paid (when buying) or received (when
  // selling) by inspecting the SOL/stablecoin leg of the swap.
  const usdValueOfWalletInputs = (): number => {
    const solPaid =
      swap.nativeInput && swap.nativeInput.account === walletAddress
        ? Number(swap.nativeInput.amount) / 1e9
        : 0;
    const stablePaid = tokenInputs
      .filter(
        (i) =>
          i.userAccount === walletAddress &&
          i.mint &&
          STABLE_MINTS.has(i.mint)
      )
      .reduce((sum, i) => sum + i.tokenAmount, 0);
    return solPaid * solPriceUsd + stablePaid;
  };

  const usdValueOfWalletOutputs = (): number => {
    const solReceived =
      swap.nativeOutput && swap.nativeOutput.account === walletAddress
        ? Number(swap.nativeOutput.amount) / 1e9
        : 0;
    const stableReceived = tokenOutputs
      .filter(
        (o) =>
          o.userAccount === walletAddress &&
          o.mint &&
          STABLE_MINTS.has(o.mint)
      )
      .reduce((sum, o) => sum + o.tokenAmount, 0);
    return solReceived * solPriceUsd + stableReceived;
  };

  if (receivedNonStable) {
    return {
      walletAddress,
      tokenAddress: receivedNonStable.mint,
      side: "buy",
      amountToken: receivedNonStable.tokenAmount,
      amountUsd: usdValueOfWalletInputs(),
      txSignature: tx.signature,
      blockTime,
      programId: tx.source ?? "",
    };
  }

  if (sentNonStable) {
    return {
      walletAddress,
      tokenAddress: sentNonStable.mint,
      side: "sell",
      amountToken: sentNonStable.tokenAmount,
      amountUsd: usdValueOfWalletOutputs(),
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
