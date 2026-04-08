import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  decimal,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  real,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const authMethodEnum = pgEnum("auth_method", ["email", "wallet"]);
export const tierEnum = pgEnum("tier", ["free", "hunter", "alpha", "whale"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "expired", "lifetime", "cancelled"]);
export const paymentCurrencyEnum = pgEnum("payment_currency", ["SOL", "USDC"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "confirmed", "failed"]);
export const scanTypeEnum = pgEnum("scan_type", ["auto", "manual"]);
export const scanStatusEnum = pgEnum("scan_status", ["running", "completed", "failed"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const adminRoleEnum = pgEnum("admin_role", ["owner", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }),
  passwordHash: text("password_hash"),
  walletAddress: varchar("wallet_address", { length: 64 }),
  authMethod: authMethodEnum("auth_method").notNull().default("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_wallet_idx").on(t.walletAddress)]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull().unique(),
  tier: tierEnum("tier").notNull().default("free"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  paymentCurrency: paymentCurrencyEnum("payment_currency"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [index("subscriptions_user_idx").on(t.userId)]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  amountSol: decimal("amount_sol", { precision: 18, scale: 9 }),
  amountUsdc: decimal("amount_usdc", { precision: 18, scale: 6 }),
  currency: paymentCurrencyEnum("currency").notNull(),
  txSignature: varchar("tx_signature", { length: 128 }).unique(),
  referenceKey: varchar("reference_key", { length: 64 }).notNull().unique(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  tier: tierEnum("tier").notNull(),
  isLifetime: boolean("is_lifetime").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("payments_user_idx").on(t.userId), index("payments_reference_idx").on(t.referenceKey), index("payments_tx_idx").on(t.txSignature)]);

export const scans = pgTable("scans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  type: scanTypeEnum("type").notNull(),
  status: scanStatusEnum("status").notNull().default("running"),
  trendingCoins: jsonb("trending_coins"),
  walletsFound: integer("wallets_found").default(0),
  duration: integer("duration_ms"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [index("scans_user_idx").on(t.userId)]);

export const discoveredWallets = pgTable("discovered_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: varchar("address", { length: 64 }).notNull().unique(),
  walletAgeDays: integer("wallet_age_days"),
  botScore: real("bot_score"),
  winrate7d: real("winrate_7d"),
  winrate30d: real("winrate_30d"),
  winrateAlltime: real("winrate_alltime"),
  pnl7d: decimal("pnl_7d", { precision: 18, scale: 6 }),
  pnl30d: decimal("pnl_30d", { precision: 18, scale: 6 }),
  pnlAlltime: decimal("pnl_alltime", { precision: 18, scale: 6 }),
  totalTrades: integer("total_trades"),
  lastActive: timestamp("last_active"),
  tags: jsonb("tags").$type<string[]>(),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("wallets_address_idx").on(t.address), index("wallets_winrate_idx").on(t.winrate30d)]);

export const walletTrades = pgTable("wallet_trades", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletAddress: varchar("wallet_address", { length: 64 }).notNull(),
  tokenAddress: varchar("token_address", { length: 64 }).notNull(),
  tokenSymbol: varchar("token_symbol", { length: 32 }),
  side: tradeSideEnum("side").notNull(),
  amountUsd: decimal("amount_usd", { precision: 18, scale: 6 }),
  amountToken: decimal("amount_token", { precision: 30, scale: 12 }),
  txSignature: varchar("tx_signature", { length: 128 }).notNull(),
  blockTime: timestamp("block_time").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("trades_wallet_idx").on(t.walletAddress), index("trades_token_idx").on(t.tokenAddress), index("trades_time_idx").on(t.blockTime)]);

export const scanWalletResults = pgTable("scan_wallet_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  scanId: uuid("scan_id").references(() => scans.id).notNull(),
  walletAddress: varchar("wallet_address", { length: 64 }).notNull(),
  realizedPnl: decimal("realized_pnl", { precision: 18, scale: 6 }),
  amountBought: decimal("amount_bought", { precision: 18, scale: 6 }),
  pnlRatio: real("pnl_ratio"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("scan_results_scan_idx").on(t.scanId), index("scan_results_wallet_idx").on(t.walletAddress)]);

export const userWatchlist = pgTable("user_watchlist", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  walletAddress: varchar("wallet_address", { length: 64 }).notNull(),
  nickname: varchar("nickname", { length: 64 }),
  notifyOnTrade: boolean("notify_on_trade").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("watchlist_user_idx").on(t.userId), uniqueIndex("watchlist_user_wallet_idx").on(t.userId, t.walletAddress)]);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  // userId is nullable: admin accounts are completely separate from regular users.
  // Kept for backward-compat with any pre-existing rows that linked to a user.
  userId: uuid("user_id").references(() => users.id).unique(),
  username: varchar("username", { length: 64 }),
  passwordHash: text("password_hash"),
  role: adminRoleEnum("role").notNull().default("admin"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("admin_user_idx").on(t.userId),
  uniqueIndex("admin_username_idx").on(t.username),
]);

export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminUserId: uuid("admin_user_id").references(() => adminUsers.id).notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  targetType: varchar("target_type", { length: 64 }),
  targetId: varchar("target_id", { length: 128 }),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("audit_admin_idx").on(t.adminUserId), index("audit_time_idx").on(t.createdAt)]);

export const appConfig = pgTable("app_config", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: uuid("updated_by").references(() => adminUsers.id),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("notifications_user_idx").on(t.userId), index("notifications_read_idx").on(t.userId, t.read)]);

export const lifetimeDeals = pgTable("lifetime_deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  totalSlots: integer("total_slots").notNull().default(100),
  remainingSlots: integer("remaining_slots").notNull().default(100),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  subscription: one(subscriptions, { fields: [users.id], references: [subscriptions.userId] }),
  payments: many(payments),
  watchlist: many(userWatchlist),
  notifications: many(notifications),
  scans: many(scans),
}));
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({ user: one(users, { fields: [subscriptions.userId], references: [users.id] }) }));
export const paymentsRelations = relations(payments, ({ one }) => ({ user: one(users, { fields: [payments.userId], references: [users.id] }) }));
export const scansRelations = relations(scans, ({ one, many }) => ({ user: one(users, { fields: [scans.userId], references: [users.id] }), results: many(scanWalletResults) }));
export const scanWalletResultsRelations = relations(scanWalletResults, ({ one }) => ({ scan: one(scans, { fields: [scanWalletResults.scanId], references: [scans.id] }) }));
export const userWatchlistRelations = relations(userWatchlist, ({ one }) => ({ user: one(users, { fields: [userWatchlist.userId], references: [users.id] }) }));
export const notificationsRelations = relations(notifications, ({ one }) => ({ user: one(users, { fields: [notifications.userId], references: [users.id] }) }));
export const adminUsersRelations = relations(adminUsers, ({ one, many }) => ({ user: one(users, { fields: [adminUsers.userId], references: [users.id] }), auditLogs: many(adminAuditLog) }));
export const adminAuditLogRelations = relations(adminAuditLog, ({ one }) => ({ admin: one(adminUsers, { fields: [adminAuditLog.adminUserId], references: [adminUsers.id] }) }));
