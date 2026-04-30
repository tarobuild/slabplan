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

function setRateLimitHeaders(res: Response, max: number, remaining: number, resetAt: number) {
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
}

/**
 * A "header-only" rate limiter for the entire `/api` surface. Every response
 * carries `X-RateLimit-Limit/Remaining/Reset` so well-behaved clients (and
 * AI agents) can pace themselves; well over the threshold turns into a hard
 * 429 with `Retry-After` so abusive callers stop banging the server. The
 * default budget is generous (1000 req/min per identity) because per-route
 * limiters still gate sensitive endpoints (login, uploads, etc.).
 */
export function createGlobalApiRateLimit(): RequestHandler {
  return createRateLimit({
    keyPrefix: "global:api",
    max: 1000,
    windowMs: 60_000,
    message: "Too many API requests. Please slow down.",
    resolveKey: (req) => {
      const userId = req.auth?.userId ?? null;
      if (userId) return `u:${userId}`;
      const ip = req.ip || req.socket?.remoteAddress || null;
      return ip ? `ip:${ip}` : null;
    },
  });
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
      setRateLimitHeaders(res, options.max, options.max - 1, resetAt);
      next();
      return;
    }

    if (existing.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      setRateLimitHeaders(res, options.max, 0, existing.resetAt);
      next(new HttpError(429, options.message, { retryAfter }, "rate-limited"));
      return;
    }

    existing.count += 1;
    setRateLimitHeaders(res, options.max, options.max - existing.count, existing.resetAt);
    next();
  };
}
