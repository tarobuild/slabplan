import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "@workspace/db";
import { HttpError } from "./http";
import { logger } from "./logger";

type RateLimitOptions = {
  keyPrefix: string;
  max: number;
  windowMs: number;
  message: string;
  resolveKey: (req: Request) => string | null;
};

// Counters live in Postgres (`rate_limit_buckets` table — see
// `lib/db/migrations/0014_rate_limit_buckets.sql`) so every API instance
// behind a load balancer shares the same buckets. With the previous
// per-process in-memory map, an attacker could multiply their allowed
// budget by the number of running instances.
//
// Atomicity: every accept/reject decision is a single SQL statement
// (`INSERT ... ON CONFLICT ... RETURNING`). Two concurrent requests for
// the same bucket race on the same row, so the post-image `count` is
// correct even with N application instances and connection-pool
// concurrency. Postgres `now()` is the source of truth for the window
// clock, so app-server clock skew can never widen or shrink a window.
//
// Window resets: when a request comes in after `reset_at`, the same
// statement atomically replaces the row with a fresh window
// (`count = 1`, `reset_at = now() + windowMs`). No separate "expire"
// path is required.
//
// Cleanup: `cleanupExpiredBuckets()` opportunistically deletes rows
// whose window ended a while ago, so one-shot keys (e.g. a single
// failed login from an IP that never returns) do not accumulate.

// Periodic cleanup configuration. The limiter checks how long it has
// been since the last cleanup on every consume() call and only fires
// the DELETE when enough time has elapsed — bounded I/O even under
// load. Tunable for tests.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
// Keep expired rows around briefly so two requests racing across the
// reset boundary don't both create fresh windows; the second one will
// hit the just-rolled bucket instead.
const CLEANUP_EXPIRED_GRACE_MS = 60 * 1000;

let lastCleanupAt = 0;
let cleanupInflight: Promise<void> | null = null;

async function cleanupExpiredBuckets(now: number): Promise<void> {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  if (cleanupInflight) return;

  lastCleanupAt = now;
  cleanupInflight = (async () => {
    try {
      await pool.query(
        `DELETE FROM rate_limit_buckets
          WHERE reset_at < (now() - ($1::int || ' milliseconds')::interval)`,
        [CLEANUP_EXPIRED_GRACE_MS],
      );
    } catch (error) {
      // Cleanup is best-effort; never let it fail a request path.
      logger.warn({ err: error }, "rate-limit cleanup failed");
    } finally {
      cleanupInflight = null;
    }
  })();
}

type ConsumeResult = {
  count: number;
  resetAt: Date;
  max: number;
};

async function consumeBucket(
  bucketKey: string,
  max: number,
  windowMs: number,
): Promise<ConsumeResult> {
  // Single-statement upsert. The CASE expressions on `count` and
  // `reset_at` collapse two semantics into one atomic write:
  //   - if the existing row's window has already expired (reset_at
  //     <= now()), start a fresh window: count = 1, reset_at = now() + window
  //   - otherwise increment count and keep the existing reset_at
  // The RETURNING gives us the post-image so the caller can decide
  // 200 vs 429 from a single round-trip.
  const result = await pool.query<{
    count: number;
    reset_at: Date;
  }>(
    `INSERT INTO rate_limit_buckets (bucket_key, count, reset_at)
     VALUES ($1, 1, now() + ($2::int || ' milliseconds')::interval)
     ON CONFLICT (bucket_key) DO UPDATE SET
       count = CASE
         WHEN rate_limit_buckets.reset_at <= now() THEN 1
         ELSE rate_limit_buckets.count + 1
       END,
       reset_at = CASE
         WHEN rate_limit_buckets.reset_at <= now()
           THEN now() + ($2::int || ' milliseconds')::interval
         ELSE rate_limit_buckets.reset_at
       END
     RETURNING count, reset_at`,
    [bucketKey, windowMs],
  );

  const row = result.rows[0];
  return { count: row.count, resetAt: row.reset_at, max };
}

// Multiple limiters can run on the same request (e.g. global IP limiter before
// auth, per-user limiter after auth). The visible `X-RateLimit-*` headers must
// reflect the *binding* limit — the one a well-behaved client should pace
// itself against — which is the limiter with the fewest remaining requests.
// On ties, prefer the smaller absolute `max` because that constraint hits
// first under continued load.
function setBindingRateLimitHeaders(
  res: Response,
  max: number,
  remaining: number,
  resetAt: number,
) {
  const safeRemaining = Math.max(0, remaining);
  const existingLimit = res.getHeader("X-RateLimit-Limit");

  if (existingLimit === undefined) {
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(safeRemaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
    return;
  }

  const prevRemaining = Number(res.getHeader("X-RateLimit-Remaining"));
  const prevLimit = Number(existingLimit);

  const ourIsStricter =
    safeRemaining < prevRemaining ||
    (safeRemaining === prevRemaining && max < prevLimit);

  if (ourIsStricter) {
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(safeRemaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
  }
}

// Quota policy:
//
// We run two limiters end-to-end on `/api` traffic:
//   1. Global IP-based limiter (this file: `createGlobalApiRateLimit`),
//      mounted before `requireAuth` so headers appear on every response.
//   2. Per-identity limiter (`createPerUserApiRateLimit`), mounted after
//      `requireAuth`, keyed on userId (and PAT id when present).
//
// The per-user quota (`PER_USER_MAX`) is the *binding* constraint for
// authenticated traffic. The IP quota (`GLOBAL_IP_MAX`) is an anti-abuse
// backstop and is set well above `PER_USER_MAX × small-N-shared-users` so
// that, for a realistic NAT (office / coffee shop / mobile carrier), the
// per-user limiter is what actually fires. If someone is alone on an IP
// they hit the per-user limit first; if many users share an IP they each
// still get a full per-user budget and the IP backstop only catches truly
// pathological per-IP volume.
const GLOBAL_IP_MAX = 10_000;
const PER_USER_MAX = 2_000;

/**
 * IP-keyed limiter for the entire `/api` surface. Mounted BEFORE
 * `requireAuth`, so `req.auth` is not populated yet — keyed strictly on
 * remote IP. Every response carries `X-RateLimit-*` headers so
 * well-behaved clients and AI agents can pace themselves; well over the
 * threshold turns into a hard 429 with `Retry-After`.
 *
 * The quota is intentionally generous (an order of magnitude above the
 * per-user limit) because this is a backstop for anonymous abuse and for
 * capping pathological traffic from a single network — not the everyday
 * binding constraint for authenticated users sharing a NAT.
 */
export function createGlobalApiRateLimit(): RequestHandler {
  return createRateLimit({
    keyPrefix: "global:api",
    max: GLOBAL_IP_MAX,
    windowMs: 60_000,
    message: "Too many API requests from this network. Please slow down.",
    resolveKey: (req) => {
      const ip = req.ip || req.socket?.remoteAddress || null;
      return ip ? `ip:${ip}` : null;
    },
  });
}

/**
 * Per-identity limiter mounted AFTER `requireAuth`. Each authenticated
 * identity gets its own bucket so a single user behind a busy NAT cannot
 * be throttled by other users sharing their IP. Personal-access-token
 * traffic is bucketed separately from the user's interactive session (and
 * per-PAT), so a single misbehaving token can be throttled without
 * affecting the user's browser session or other PATs.
 *
 * Quota: higher than the per-route limiters (login, uploads, etc.) but
 * lower than the global IP backstop, so for authenticated traffic this is
 * the effective binding constraint and `X-RateLimit-*` headers reflect
 * the per-user budget.
 */
export function createPerUserApiRateLimit(): RequestHandler {
  return createRateLimit({
    keyPrefix: "perUser:api",
    max: PER_USER_MAX,
    windowMs: 60_000,
    message: "Too many API requests for this account. Please slow down.",
    resolveKey: (req) => {
      const userId = req.auth?.userId;
      if (!userId) return null;
      const patId = req.auth?.patId;
      return patId ? `u:${userId}:pat:${patId}` : `u:${userId}:session`;
    },
  });
}

// Per-user/PAT bucket key. Reused by the AI-parse and upload limiters
// below so they all key on the same identity dimension as the global
// per-user limiter — that way "PAT vs interactive session" stays a
// separate bucket everywhere, and a misbehaving script can be throttled
// without affecting the user's browser tabs.
function perUserBucketKey(req: Request) {
  const userId = req.auth?.userId;
  if (!userId) return null;
  const patId = req.auth?.patId;
  return patId ? `u:${userId}:pat:${patId}` : `u:${userId}:session`;
}

// Per-user limiter for the AI-backed financials parse endpoints. The AI
// provider charges real money per call, so the budget is intentionally
// tight — `AI_PARSE_PER_USER_MAX` (default 20) parses per
// `AI_PARSE_PER_USER_WINDOW_MS` (default 1 hour). Override via env when
// load-testing or for one-off bulk imports.
const AI_PARSE_PER_USER_MAX = Number(process.env.AI_PARSE_PER_USER_MAX ?? 20);
const AI_PARSE_PER_USER_WINDOW_MS = Number(
  process.env.AI_PARSE_PER_USER_WINDOW_MS ?? 60 * 60 * 1000,
);

export function createAiParsePerUserRateLimit(): RequestHandler {
  return createRateLimit({
    keyPrefix: "perUser:ai-parse",
    max: AI_PARSE_PER_USER_MAX,
    windowMs: AI_PARSE_PER_USER_WINDOW_MS,
    message:
      "Too many AI-parse requests for this account. Please slow down or try again later.",
    resolveKey: perUserBucketKey,
  });
}

// Per-user limiter for upload endpoints (folders, daily-logs, leads,
// schedule, resources, etc.). Defaults to 100 uploads per hour per
// identity — enough headroom for a normal day on site, low enough that
// a stuck client loop can't fill object storage. Override via env.
const UPLOAD_PER_USER_MAX = Number(process.env.UPLOAD_PER_USER_MAX ?? 100);
const UPLOAD_PER_USER_WINDOW_MS = Number(
  process.env.UPLOAD_PER_USER_WINDOW_MS ?? 60 * 60 * 1000,
);

export function createUploadPerUserRateLimit(): RequestHandler {
  return createRateLimit({
    keyPrefix: "perUser:uploads",
    max: UPLOAD_PER_USER_MAX,
    windowMs: UPLOAD_PER_USER_WINDOW_MS,
    message:
      "Too many uploads for this account. Please slow down or try again later.",
    resolveKey: perUserBucketKey,
  });
}

/**
 * Imperatively clear a single rate-limit bucket. Used by routes that want
 * a "reset on success" semantic — e.g. the login limiter, where a
 * successful authentication should wipe the failure counter for that IP
 * so a legitimate user who fat-fingered their password a few times is
 * not locked out for the rest of the window.
 *
 * `keyPrefix` and `key` must match the values passed to
 * `createRateLimit`/`resolveKey` exactly; the same `${keyPrefix}:${key}`
 * composition is used.
 *
 * Async because the buckets live in Postgres now (Task #296). Callers
 * may safely fire-and-forget — failure to clear is non-fatal (the user
 * can still log in; they will just exhaust their budget faster on the
 * next mistake), so we swallow errors to a log rather than failing the
 * surrounding request.
 */
export async function clearRateLimitBucket(
  keyPrefix: string,
  key: string,
): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM rate_limit_buckets WHERE bucket_key = $1`,
      [`${keyPrefix}:${key}`],
    );
  } catch (error) {
    logger.warn({ err: error, keyPrefix }, "clearRateLimitBucket failed");
  }
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.resolveKey(req);

    if (!key) {
      next();
      return;
    }

    const bucketKey = `${options.keyPrefix}:${key}`;

    // Fire opportunistic cleanup; do not await — never block a request
    // on housekeeping I/O.
    void cleanupExpiredBuckets(Date.now());

    consumeBucket(bucketKey, options.max, options.windowMs).then(
      ({ count, resetAt }) => {
        const resetAtMs = resetAt.getTime();

        if (count > options.max) {
          const retryAfter = Math.max(
            1,
            Math.ceil((resetAtMs - Date.now()) / 1000),
          );
          res.setHeader("Retry-After", String(retryAfter));
          setBindingRateLimitHeaders(res, options.max, 0, resetAtMs);
          next(
            new HttpError(429, options.message, { retryAfter }, "rate-limited"),
          );
          return;
        }

        setBindingRateLimitHeaders(
          res,
          options.max,
          options.max - count,
          resetAtMs,
        );
        next();
      },
      (error) => {
        // Fail open: a database hiccup must not lock every user out of
        // the API. Log loudly so the on-call notices, but let the
        // request through without rate-limit headers (the next limiter
        // in the chain will still try its own consume()).
        logger.error(
          { err: error, keyPrefix: options.keyPrefix },
          "rate-limit consume failed; failing open",
        );
        next();
      },
    );
  };
}

// Test-only helper: reset internal cleanup throttling so each test
// starts with a clean slate. Not exported through any production path.
export function _resetRateLimitCleanupForTests(): void {
  lastCleanupAt = 0;
  cleanupInflight = null;
}
