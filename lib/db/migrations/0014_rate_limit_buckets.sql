-- Task #296: Shared rate-limit buckets.
--
-- Move the in-memory token-bucket map (api-server's
-- `src/lib/rate-limit.ts`) into a Postgres-backed table so multiple
-- API instances behind a load balancer share the same counters. With
-- the old per-process map, an attacker could multiply their allowed
-- request budget by the number of running instances. This table is
-- the single source of truth.
--
-- Schema:
--   - `bucket_key` is the composite `${keyPrefix}:${resolvedKey}` string
--     the limiter already builds (e.g. `auth:login:ip:1.2.3.4`,
--     `perUser:api:u:<uuid>:session`). Keeping the prefix in the row
--     means a single key namespace covers every limiter (login, AI
--     parse, uploads, global IP, per-user) without per-limiter tables.
--   - `count` is the number of accepted requests in the current
--     window. Incremented atomically via INSERT ... ON CONFLICT.
--   - `reset_at` is when the window rolls over. The limiter compares
--     against `now()` (Postgres time, not the application clock) so
--     skewed app clocks cannot widen or shrink a window.
--
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "bucket_key" text PRIMARY KEY,
  "count" integer NOT NULL,
  "reset_at" timestamptz NOT NULL
);
--> statement-breakpoint

-- Cleanup helper index — the limiter periodically deletes expired
-- rows so a table doesn't grow unbounded for one-shot keys (e.g. a
-- single failed login from an IP that never returns).
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_reset_at_idx"
  ON "rate_limit_buckets" ("reset_at");
