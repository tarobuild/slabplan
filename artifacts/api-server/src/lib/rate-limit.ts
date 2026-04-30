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
      buckets.set(bucketKey, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      next();
      return;
    }

    if (existing.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      next(new HttpError(429, options.message, { retryAfter }));
      return;
    }

    existing.count += 1;
    next();
  };
}
