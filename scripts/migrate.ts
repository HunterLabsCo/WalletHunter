/**
 * Run database migration via Neon HTTP driver.
 * Usage: npx tsx scripts/migrate.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve } from "path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(url);

  // Read migration file and split on drizzle's statement breakpoints
  const migrationPath = resolve(__dirname, "../drizzle/0000_nasty_pretty_boy.sql");
  const raw = readFileSync(migrationPath, "utf-8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Running ${statements.length} statements...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 80).replace(/\n/g, " ");
    try {
      await sql(stmt);
      console.log(`  [${i + 1}/${statements.length}] OK: ${preview}...`);
    } catch (err: any) {
      // Skip "already exists" errors so the script is idempotent
      if (err.message?.includes("already exists")) {
        console.log(`  [${i + 1}/${statements.length}] SKIP (already exists): ${preview}...`);
      } else {
        console.error(`  [${i + 1}/${statements.length}] FAIL: ${preview}...`);
        console.error(`  Error: ${err.message}`);
        process.exit(1);
      }
    }
  }

  console.log("Migration complete!");
}

main();
