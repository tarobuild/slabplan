import type { NextFunction, Request, RequestHandler, Response } from "express";
import { HttpError } from "./http";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  keyPrefix: string;
  max: number;
  windowMs: number;
  message: string;
  resolveKey: (req: Request) => string | null;
};

// This in-memory bucket map is per-instance. The production deploy is a single
// Reserved VM (see `replit.md` → "Deployment target — Reserved VM, not autoscale"),
// so a single in-process map is the source of truth. If anyone ever switches the
// deployment type to autoscale, this must be moved to a shared store (Postgres or
// Redis) — otherwise each instance enforces its own counters and the effective
// rate limit becomes `instances × configured_max`.
const buckets = new Map<string, RateLimitBucket>();
const MAX_BUCKETS = 5000;

function pruneExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
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
 */
export function clearRateLimitBucket(keyPrefix: string, key: string): void {
  buckets.delete(`${keyPrefix}:${key}`);
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.resolveKey(req);

    if (!key) {
      next();
      return;
    }

    const now = Date.now();

    if (buckets.size >= MAX_BUCKETS) {
      pruneExpiredBuckets(now);
    }

    const bucketKey = `${options.keyPrefix}:${key}`;
    const existing = buckets.get(bucketKey);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + options.windowMs;
      buckets.set(bucketKey, {
        count: 1,
        resetAt,
      });
      setBindingRateLimitHeaders(res, options.max, options.max - 1, resetAt);
      next();
      return;
    }

    if (existing.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      setBindingRateLimitHeaders(res, options.max, 0, existing.resetAt);
      next(new HttpError(429, options.message, { retryAfter }, "rate-limited"));
      return;
    }

    existing.count += 1;
    setBindingRateLimitHeaders(res, options.max, options.max - existing.count, existing.resetAt);
    next();
  };
}
