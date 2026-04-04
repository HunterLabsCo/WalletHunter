import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Please add it to your .env.local file. See .env.example for instructions."
    );
  }
  const sql = neon(process.env.DATABASE_URL);
  return drizzle(sql, { schema });
}

// Lazy initialization — only connects when first accessed
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

// For convenience — throws at runtime if DB not configured, not at import time
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_, prop) {
    return Reflect.get(getDb(), prop);
  },
});
