CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('email', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."payment_currency" AS ENUM('SOL', 'USDC');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scan_type" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'expired', 'lifetime', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('free', 'hunter', 'alpha', 'whale');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" varchar(128) NOT NULL,
	"target_type" varchar(64),
	"target_id" varchar(128),
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" varchar(64),
	"password_hash" text,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "discovered_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" varchar(64) NOT NULL,
	"wallet_age_days" integer,
	"bot_score" real,
	"winrate_7d" real,
	"winrate_30d" real,
	"winrate_alltime" real,
	"pnl_7d" numeric(18, 6),
	"pnl_30d" numeric(18, 6),
	"pnl_alltime" numeric(18, 6),
	"total_trades" integer,
	"last_active" timestamp,
	"tags" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovered_wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "lifetime_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"total_slots" integer DEFAULT 100 NOT NULL,
	"remaining_slots" integer DEFAULT 100 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_sol" numeric(18, 9),
	"amount_usdc" numeric(18, 6),
	"currency" "payment_currency" NOT NULL,
	"tx_signature" varchar(128),
	"reference_key" varchar(64) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"tier" "tier" NOT NULL,
	"is_lifetime" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tx_signature_unique" UNIQUE("tx_signature"),
	CONSTRAINT "payments_reference_key_unique" UNIQUE("reference_key")
);
--> statement-breakpoint
CREATE TABLE "scan_wallet_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"wallet_address" varchar(64) NOT NULL,
	"realized_pnl" numeric(18, 6),
	"amount_bought" numeric(18, 6),
	"pnl_ratio" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" "scan_type" NOT NULL,
	"status" "scan_status" DEFAULT 'running' NOT NULL,
	"trending_coins" jsonb,
	"wallets_found" integer DEFAULT 0,
	"duration_ms" integer,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" "tier" DEFAULT 'free' NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"payment_currency" "payment_currency",
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" varchar(64) NOT NULL,
	"nickname" varchar(64),
	"notify_on_trade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255),
	"password_hash" text,
	"wallet_address" varchar(64),
	"auth_method" "auth_method" DEFAULT 'email' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(64) NOT NULL,
	"token_address" varchar(64) NOT NULL,
	"token_symbol" varchar(32),
	"side" "trade_side" NOT NULL,
	"amount_usd" numeric(18, 6),
	"amount_token" numeric(30, 12),
	"tx_signature" varchar(128) NOT NULL,
	"block_time" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_wallet_results" ADD CONSTRAINT "scan_wallet_results_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_watchlist" ADD CONSTRAINT "user_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_admin_idx" ON "admin_audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "audit_time_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_user_idx" ON "admin_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_username_idx" ON "admin_users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_address_idx" ON "discovered_wallets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "wallets_winrate_idx" ON "discovered_wallets" USING btree ("winrate_30d");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_reference_idx" ON "payments" USING btree ("reference_key");--> statement-breakpoint
CREATE INDEX "payments_tx_idx" ON "payments" USING btree ("tx_signature");--> statement-breakpoint
CREATE INDEX "scan_results_scan_idx" ON "scan_wallet_results" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "scan_results_wallet_idx" ON "scan_wallet_results" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "scans_user_idx" ON "scans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchlist_user_idx" ON "user_watchlist" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_user_wallet_idx" ON "user_watchlist" USING btree ("user_id","wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_idx" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "trades_wallet_idx" ON "wallet_trades" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "trades_token_idx" ON "wallet_trades" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "trades_time_idx" ON "wallet_trades" USING btree ("block_time");