import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { idempotencyKeys } from "@workspace/db/schema";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_MIN_LEN = 8;
const KEY_MAX_LEN = 255;

// Sentinel values used while a request is in flight. The schema requires
// status_code / response_body / response_content_type to be NOT NULL, so we
// reserve the row with these placeholders. A status_code of 0 is the
// "still-processing" marker — successful responses overwrite it on res.finish,
// non-2xx responses delete the reservation so the client can retry.
const PENDING_STATUS = 0;
const PENDING_BODY = "";
const PENDING_CONTENT_TYPE = "application/json";

function isReplayableMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

function hashRequestBody(req: Request): string {
  const raw = req.body && typeof req.body === "object" ? JSON.stringify(req.body) : String(req.body ?? "");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function sweepExpired() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    await db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, new Date()));
  } catch (err) {
    logger.warn({ err }, "idempotency sweep failed");
  }
}

export function idempotencyMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!isReplayableMethod(req.method)) {
      next();
      return;
    }

    const headerValue = req.headers["idempotency-key"];
    const key =
      typeof headerValue === "string"
        ? headerValue.trim()
        : Array.isArray(headerValue)
          ? String(headerValue[0]).trim()
          : "";

    if (!key) {
      next();
      return;
    }

    if (!req.auth?.userId) {
      // Without an identity we cannot scope the key — fail open and continue.
      // This middleware is mounted after requireAuth, so the only way to land
      // here is auth that resolved without a userId, which is treated as a
      // soft skip rather than a hard error.
      next();
      return;
    }

    if (key.length < KEY_MIN_LEN || key.length > KEY_MAX_LEN) {
      next(
        new HttpError(
          400,
          `Idempotency-Key must be between ${KEY_MIN_LEN} and ${KEY_MAX_LEN} characters.`,
          undefined,
          "validation",
        ),
      );
      return;
    }

    void sweepExpired();

    const userId = req.auth.userId;
    const method = req.method.toUpperCase();
    const path = (req.originalUrl || req.url || "").split("?")[0]!;
    const requestHash = hashRequestBody(req);
    const expiresAt = new Date(Date.now() + TTL_MS);

    // Step 1: atomically reserve the slot. INSERT ... ON CONFLICT DO NOTHING
    // means at most one concurrent request wins the race; the loser falls
    // through to the lookup branch and either replays a finished response or
    // is told the request is in flight.
    let reservation: { userId: string }[];
    try {
      reservation = await db
        .insert(idempotencyKeys)
        .values({
          userId,
          key,
          method,
          path,
          requestHash,
          statusCode: PENDING_STATUS,
          responseBody: PENDING_BODY,
          responseContentType: PENDING_CONTENT_TYPE,
          expiresAt,
        })
        .onConflictDoNothing({
          target: [
            idempotencyKeys.userId,
            idempotencyKeys.key,
            idempotencyKeys.method,
            idempotencyKeys.path,
          ],
        })
        .returning({ userId: idempotencyKeys.userId });
    } catch (err) {
      logger.error({ err }, "idempotency reservation failed");
      next();
      return;
    }

    if (reservation.length === 0) {
      // Lost the race (or a previous request already populated the row).
      // Fetch the existing record and either replay it or 409.
      let existing;
      try {
        [existing] = await db
          .select({
            statusCode: idempotencyKeys.statusCode,
            responseBody: idempotencyKeys.responseBody,
            responseContentType: idempotencyKeys.responseContentType,
            requestHash: idempotencyKeys.requestHash,
            expiresAt: idempotencyKeys.expiresAt,
          })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              eq(idempotencyKeys.key, key),
              eq(idempotencyKeys.method, method),
              eq(idempotencyKeys.path, path),
            ),
          )
          .limit(1);
      } catch (err) {
        logger.error({ err }, "idempotency lookup failed");
        next();
        return;
      }

      if (!existing) {
        // The row vanished between conflict and lookup (sweeper raced us).
        // Treat as a miss: let the request proceed without replay protection.
        next();
        return;
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        // Stale row — delete it and fall through. The next retry by the
        // client will re-reserve cleanly.
        try {
          await db
            .delete(idempotencyKeys)
            .where(
              and(
                eq(idempotencyKeys.userId, userId),
                eq(idempotencyKeys.key, key),
                eq(idempotencyKeys.method, method),
                eq(idempotencyKeys.path, path),
              ),
            );
        } catch {
          // Sweeper will catch this eventually.
        }
        next();
        return;
      }

      if (existing.requestHash !== requestHash) {
        next(
          new HttpError(
            409,
            "Idempotency-Key was previously used with a different request body.",
            undefined,
            "idempotency-conflict",
          ),
        );
        return;
      }

      if (existing.statusCode === PENDING_STATUS) {
        // Original request is still executing. Tell the client to wait.
        const retryAfter = 2;
        res.setHeader("Retry-After", String(retryAfter));
        next(
          new HttpError(
            409,
            "A request with this Idempotency-Key is already in progress. Try again in a moment.",
            { retryAfter },
            "idempotency-in-progress",
          ),
        );
        return;
      }

      res.setHeader("Idempotent-Replayed", "true");
      res
        .status(existing.statusCode)
        .type(existing.responseContentType)
        .send(existing.responseBody);
      return;
    }

    // Step 2: we own the slot. Capture the outgoing response and persist it
    // (or release the reservation on failure) when the response finishes.
    const chunks: Buffer[] = [];
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    (res as Response & { write: typeof res.write }).write = function patchedWrite(
      this: Response,
      chunk: unknown,
      ...rest: unknown[]
    ) {
      if (chunk) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(typeof chunk === "string" ? chunk : String(chunk));
        chunks.push(buf);
      }
      // @ts-expect-error rest forwarded as-is
      return originalWrite(chunk, ...rest);
    };

    (res as Response & { end: typeof res.end }).end = function patchedEnd(
      this: Response,
      chunk?: unknown,
      ...rest: unknown[]
    ) {
      if (chunk) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(typeof chunk === "string" ? chunk : String(chunk));
        chunks.push(buf);
      }
      // @ts-expect-error rest forwarded as-is
      return originalEnd(chunk, ...rest);
    };

    let settled = false;
    const settle = async (finished: boolean) => {
      if (settled) return;
      settled = true;

      if (finished && res.statusCode > 0) {
        // Persist the exact final response (success OR error) so retries
        // with the same key replay byte-for-byte. This matches Stripe-style
        // idempotency semantics.
        const body = Buffer.concat(chunks).toString("utf8");
        const contentType =
          (res.getHeader("content-type") as string | undefined) ?? "application/json";

        try {
          await db
            .update(idempotencyKeys)
            .set({
              statusCode: res.statusCode,
              responseBody: body,
              responseContentType: String(contentType).split(";")[0]!.trim(),
              expiresAt: new Date(Date.now() + TTL_MS),
            })
            .where(
              and(
                eq(idempotencyKeys.userId, userId),
                eq(idempotencyKeys.key, key),
                eq(idempotencyKeys.method, method),
                eq(idempotencyKeys.path, path),
                eq(idempotencyKeys.statusCode, PENDING_STATUS),
              ),
            );
        } catch (err) {
          logger.warn({ err }, "idempotency completion persist failed");
        }
        return;
      }

      // Connection aborted before the response could finish — release the
      // pending reservation so the client may retry. Only deletes rows
      // that are still in the sentinel state so a racing finish() that
      // wrote a final row is not clobbered.
      try {
        await db
          .delete(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              eq(idempotencyKeys.key, key),
              eq(idempotencyKeys.method, method),
              eq(idempotencyKeys.path, path),
              eq(idempotencyKeys.statusCode, PENDING_STATUS),
            ),
          );
      } catch (err) {
        logger.warn({ err }, "idempotency release failed");
      }
    };

    res.on("finish", () => {
      void settle(true);
    });
    res.on("close", () => {
      // `finish` fires before `close` on a normal completion, so settled
      // will already be true here and this becomes a no-op. Only matters
      // when the socket dies mid-response.
      void settle(false);
    });

    next();
  };
}
