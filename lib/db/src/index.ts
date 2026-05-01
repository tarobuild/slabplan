import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";
const rawSupabaseUrl = process.env.SUPABASE_DATABASE_URL;
const fallbackUrl = process.env.DATABASE_URL;

// Only honor SUPABASE_DATABASE_URL in production. In development we always use
// the runtime-managed DATABASE_URL (Helium) so that local work cannot
// accidentally read or write the live Supabase data. This keeps dev and prod
// strictly separated without relying on artifact.toml `[services.env]` to
// blank the variable (the empty-string trick previously clobbered the prod
// secret and crashed every deploy — see incident 2026-04-30).
const supabaseUrl = isProduction ? rawSupabaseUrl : undefined;

if (isProduction && !supabaseUrl) {
  // Hard fail in production: the runtime-managed DATABASE_URL points at a
  // throwaway Helium instance that has none of our real data and a stale
  // schema. Silently falling back to it once put the live site in a broken
  // state where login crashed on `column "is_active" does not exist`. Crash
  // loud at startup instead — the deployment's "Secrets" tab must include
  // SUPABASE_DATABASE_URL.
  throw new Error(
    "SUPABASE_DATABASE_URL is required in production but is not set. " +
      "Add it to the deployment's Secrets and republish.",
  );
}

const connectionString = supabaseUrl || fallbackUrl;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

try {
  const parsed = new URL(connectionString);
  const source = supabaseUrl ? "SUPABASE_DATABASE_URL" : "DATABASE_URL";
  console.log(
    `[db] connecting via ${source} host=${parsed.hostname} db=${parsed.pathname.slice(1)}`,
  );
} catch {
  console.log("[db] connecting (unparseable connection string)");
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema/index.js";
export { DEFAULT_SEED_PASSWORD, SEED_USERS, seedDatabase } from "./seed";
