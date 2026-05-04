import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

// pg's own DatabaseError instances expose the constraint name (and other
// useful detail fields) only as separate properties — `error.message` itself
// just says "new row for relation \"X\" violates check constraint \"Y\"".
// Drizzle's DrizzleQueryError then wraps the pg error and replaces
// `error.message` with `Failed query: ...\nparams: ...`, dropping the
// constraint name from the visible message entirely. Tests (and log
// scrapers) want to grep the constraint name out of the message, so we
// augment the cause's message *before* drizzle wraps it: appending the
// constraint name (and hint/detail when present) into the pg error's own
// message, which drizzle then preserves on `.cause` and we re-include
// when re-raising. This is dev-only friction; real reporting paths still
// have the structured fields available on `.cause`.
type PgErrorLike = Error & {
  constraint?: string;
  detail?: string;
  hint?: string;
  code?: string;
};
function augmentPgError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const e = err as PgErrorLike;
  // Only touch errors that smell like pg DatabaseError (have a SQLSTATE code).
  if (typeof e.code !== "string" || e.code.length !== 5) return err;
  const parts: string[] = [];
  if (e.constraint) parts.push(`constraint: ${e.constraint}`);
  if (e.detail) parts.push(`detail: ${e.detail}`);
  if (e.hint) parts.push(`hint: ${e.hint}`);
  if (parts.length === 0) return err;
  if (e.message.includes(`constraint: ${e.constraint ?? ""}`)) return err;
  e.message = `${e.message} (${parts.join("; ")})`;
  return err;
}

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

// Wrap pool.query (and every checked-out client's query) so pg
// DatabaseError instances carry the constraint name (and detail/hint)
// inside their `.message` before drizzle's DrizzleQueryError wraps them.
// See augmentPgError above.
function wrapQuery<T extends { query: (...args: unknown[]) => unknown }>(target: T): void {
  const originalQuery = target.query.bind(target) as (
    ...args: unknown[]
  ) => unknown;
  (target as { query: typeof originalQuery }).query = function (
    ...args: unknown[]
  ) {
    try {
      const result = originalQuery(...args) as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        return (result as Promise<unknown>).catch((err) => {
          throw augmentPgError(err);
        });
      }
      return result;
    } catch (err) {
      throw augmentPgError(err);
    }
  };
}
wrapQuery(pool as unknown as { query: (...args: unknown[]) => unknown });
pool.on("connect", (client) => {
  wrapQuery(client as unknown as { query: (...args: unknown[]) => unknown });
});

export const db = drizzle(pool, { schema });

export * from "./schema/index.js";
export { DEFAULT_SEED_PASSWORD, SEED_USERS, seedDatabase } from "./seed";
