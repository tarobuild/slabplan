import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  HealthGetHealthzResponse,
  HealthGetLivezResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { headBucket } from "../lib/storage";

const router: IRouter = Router();

const READINESS_TIMEOUT_MS = 1500;

type CheckResult = {
  ok: boolean;
  error?: { code: string; message: string };
};

function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), {
          code: "TIMEOUT",
        }),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type HealthChecks = {
  db: () => Promise<void>;
  storage: () => Promise<void>;
};

const defaultChecks: HealthChecks = {
  db: async () => {
    await db.execute(sql`select 1`);
  },
  storage: async () => {
    await headBucket();
  },
};

let activeChecks: HealthChecks = defaultChecks;

/**
 * Internal hook used by the test suite to swap the deep-healthz checks with
 * stubs (e.g. simulate a DB outage). Not part of the public API.
 */
export const __healthCheckTesting = {
  setChecks(overrides: Partial<HealthChecks>) {
    activeChecks = { ...activeChecks, ...overrides };
  },
  reset() {
    activeChecks = defaultChecks;
  },
};

async function runCheck(
  label: string,
  fn: () => Promise<void>,
): Promise<CheckResult> {
  try {
    await withTimeout(label, fn(), READINESS_TIMEOUT_MS);
    return { ok: true };
  } catch (err) {
    const error = err as { code?: string; message?: string };
    const code = typeof error.code === "string" ? error.code : "ERROR";
    const message = typeof error.message === "string" ? error.message : "Check failed";
    return { ok: false, error: { code, message } };
  }
}

// Shallow liveness probe — always 200 as long as the event loop is alive
// enough to answer. Used by the autoscale container-level liveness probe and
// by tests that just want to confirm the API is up. Deep readiness lives at
// /healthz.
router.get("/livez", (_req, res) => {
  const data = HealthGetLivezResponse.parse({ status: "ok" });
  res.json(data);
});

// Deep readiness probe. Exercises the primary DB and the upload bucket in
// parallel with a hard 1.5s timeout per check. A single failing dependency
// flips the response to 503 + status:"degraded" so a load balancer can stop
// routing traffic to a broken instance.
router.get("/healthz", async (_req, res, next) => {
  const startedAt = Date.now();
  try {
    const [dbResult, storageResult] = await Promise.all([
      runCheck("db", activeChecks.db),
      runCheck("storage", activeChecks.storage),
    ]);

    const errors: Array<{ code: string; message: string }> = [];
    if (!dbResult.ok && dbResult.error) errors.push(dbResult.error);
    if (!storageResult.ok && storageResult.error) errors.push(storageResult.error);

    const allOk = dbResult.ok && storageResult.ok;
    const durationMs = Date.now() - startedAt;
    const payload = HealthGetHealthzResponse.parse({
      status: allOk ? "ok" : "degraded",
      db: dbResult.ok,
      storage: storageResult.ok,
      durationMs,
      errors,
    });

    if (!allOk) {
      logger.warn(
        { errorCode: "HEALTHZ_DEGRADED", db: dbResult.ok, storage: storageResult.ok, durationMs, errors },
        "healthz reported degraded status",
      );
    }

    res.status(allOk ? 200 : 503).json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
