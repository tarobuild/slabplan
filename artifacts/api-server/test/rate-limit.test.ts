import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import {
  _resetRateLimitCleanupForTests,
  clearRateLimitBucket,
  createGlobalApiRateLimit,
  createPerUserApiRateLimit,
  createRateLimit,
} from "../src/lib/rate-limit.ts";
import { HttpError } from "../src/lib/http.ts";

// The Postgres-backed limiter (Task #296) keys every bucket on the
// composite `${keyPrefix}:${resolvedKey}` string. Tests share one
// database, so they MUST use unique keyPrefixes (or a per-test suffix
// on the resolved key) to avoid bleeding state between runs.

before(async () => {
  // Make sure the table exists; setup-test-db / drizzle-kit push runs
  // before tests, but `pool` is lazy so a quick `select 1` ensures the
  // connection is actually live before the first middleware call.
  await pool.query("select 1");
  await pool.query("delete from rate_limit_buckets");
  _resetRateLimitCleanupForTests();
});

after(async () => {
  // Best-effort cleanup so a re-run starts from a clean state. The
  // shared pool is closed by the test runner's process teardown.
  await pool.query("delete from rate_limit_buckets").catch(() => {});
});

type AuthFixture = {
  userId: string;
  email?: string;
  role?: string;
  type?: "access" | "upload";
  patId?: string;
  patScope?: "read" | "read_write";
};

function createRequest(opts: { ip?: string; auth?: AuthFixture } = {}): Request {
  const auth = opts.auth
    ? {
        userId: opts.auth.userId,
        email: opts.auth.email ?? "user@example.com",
        role: opts.auth.role ?? "manager",
        type: opts.auth.type ?? "access",
        patId: opts.auth.patId,
        patScope: opts.auth.patScope,
      }
    : undefined;

  return {
    ip: opts.ip,
    body: {},
    auth,
  } as unknown as Request;
}

function createResponse() {
  const headers = new Map<string, string>();

  return {
    response: {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      getHeader(name: string) {
        return headers.get(name);
      },
    } as unknown as Response,
    headers,
  };
}

// The middleware schedules its real work after a Postgres round-trip,
// so callers MUST await this helper rather than reading `next`'s
// captured argument synchronously.
function runMiddleware(
  middleware: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request,
  res: Response,
): Promise<unknown> {
  return new Promise((resolve) => {
    middleware(req, res, (error) => {
      resolve(error);
    });
  });
}

test("createRateLimit blocks requests after the configured threshold", async () => {
  const middleware = createRateLimit({
    keyPrefix: `test:login:${Date.now()}`,
    max: 2,
    windowMs: 60_000,
    message: "Too many attempts.",
    resolveKey: (req) => req.ip || null,
  });

  const request = createRequest({ ip: "127.0.0.1" });
  const { response, headers } = createResponse();

  const errors = [
    await runMiddleware(middleware, request, response),
    await runMiddleware(middleware, request, response),
    await runMiddleware(middleware, request, response),
  ];

  assert.deepEqual(errors.slice(0, 2), [undefined, undefined]);
  assert.ok(errors[2] instanceof HttpError);
  assert.equal((errors[2] as HttpError).statusCode, 429);
  // Window is 60s, so Retry-After should be a positive integer ≤ 60.
  const retryAfter = Number(headers.get("Retry-After"));
  assert.ok(retryAfter >= 1 && retryAfter <= 60);
});

test("two users sharing one IP get separate per-user buckets", async () => {
  // Use unique key prefixes via a fresh limiter so other tests cannot bleed in.
  const perUser = createRateLimit({
    keyPrefix: `test:nat:perUser:${Date.now()}`,
    max: 5,
    windowMs: 60_000,
    message: "user limit",
    resolveKey: (req) => (req.auth?.userId ? `u:${req.auth.userId}` : null),
  });

  const userA = createRequest({ ip: "10.0.0.1", auth: { userId: `nat-a-${Date.now()}` } });
  const userB = createRequest({ ip: "10.0.0.1", auth: { userId: `nat-b-${Date.now()}` } });

  // User A burns its entire bucket.
  for (let i = 0; i < 5; i += 1) {
    const { response } = createResponse();
    const err = await runMiddleware(perUser, userA, response);
    assert.equal(err, undefined, `request ${i} for user-a should pass`);
  }

  const { response: aBlocked } = createResponse();
  const aBlockedErr = await runMiddleware(perUser, userA, aBlocked);
  assert.ok(aBlockedErr instanceof HttpError);
  assert.equal((aBlockedErr as HttpError).statusCode, 429);

  // User B is on the same IP but has its own bucket and is unaffected.
  const { response: bResp, headers: bHeaders } = createResponse();
  const bErr = await runMiddleware(perUser, userB, bResp);
  assert.equal(bErr, undefined);
  assert.equal(bHeaders.get("X-RateLimit-Limit"), "5");
  assert.equal(bHeaders.get("X-RateLimit-Remaining"), "4");
});

test("PAT and interactive session for the same user are bucketed separately", async () => {
  const perUser = createPerUserApiRateLimit();

  const userId = `pat-vs-session-${Date.now()}-${Math.random()}`;
  const sessionReq = createRequest({ auth: { userId } });
  const patReq = createRequest({ auth: { userId, patId: "pat-123" } });
  const otherPatReq = createRequest({ auth: { userId, patId: "pat-456" } });

  // First call to each bucket should populate it independently.
  const sessionRes = createResponse();
  assert.equal(await runMiddleware(perUser, sessionReq, sessionRes.response), undefined);
  const initialRemaining = Number(sessionRes.headers.get("X-RateLimit-Remaining"));
  assert.ok(initialRemaining > 0);
  const perUserMax = Number(sessionRes.headers.get("X-RateLimit-Limit"));
  assert.equal(initialRemaining, perUserMax - 1);

  const patRes = createResponse();
  assert.equal(await runMiddleware(perUser, patReq, patRes.response), undefined);
  assert.equal(Number(patRes.headers.get("X-RateLimit-Remaining")), perUserMax - 1);

  const otherPatRes = createResponse();
  assert.equal(await runMiddleware(perUser, otherPatReq, otherPatRes.response), undefined);
  assert.equal(Number(otherPatRes.headers.get("X-RateLimit-Remaining")), perUserMax - 1);

  // A second call to the session bucket only decrements the session bucket.
  const sessionRes2 = createResponse();
  assert.equal(await runMiddleware(perUser, sessionReq, sessionRes2.response), undefined);
  assert.equal(Number(sessionRes2.headers.get("X-RateLimit-Remaining")), perUserMax - 2);

  // The PAT buckets are untouched.
  const patRes2 = createResponse();
  assert.equal(await runMiddleware(perUser, patReq, patRes2.response), undefined);
  assert.equal(Number(patRes2.headers.get("X-RateLimit-Remaining")), perUserMax - 2);
});

test("createPerUserApiRateLimit is a no-op for unauthenticated requests", async () => {
  const middleware = createPerUserApiRateLimit();
  const { response, headers } = createResponse();
  const err = await runMiddleware(middleware, createRequest({ ip: "10.1.1.1" }), response);
  assert.equal(err, undefined);
  assert.equal(headers.get("X-RateLimit-Limit"), undefined);
});

test("when both limiters fire the headers reflect the stricter (binding) limit", async () => {
  const looseLimiter = createRateLimit({
    keyPrefix: `test:binding:loose:${Date.now()}`,
    max: 100,
    windowMs: 60_000,
    message: "loose",
    resolveKey: () => "shared",
  });
  const strictLimiter = createRateLimit({
    keyPrefix: `test:binding:strict:${Date.now()}`,
    max: 10,
    windowMs: 60_000,
    message: "strict",
    resolveKey: () => "shared",
  });

  const req = createRequest({ ip: "10.2.2.2" });
  const { response, headers } = createResponse();

  assert.equal(await runMiddleware(looseLimiter, req, response), undefined);
  assert.equal(headers.get("X-RateLimit-Limit"), "100");
  assert.equal(headers.get("X-RateLimit-Remaining"), "99");

  assert.equal(await runMiddleware(strictLimiter, req, response), undefined);
  assert.equal(headers.get("X-RateLimit-Limit"), "10");
  assert.equal(headers.get("X-RateLimit-Remaining"), "9");
});

test("the looser limiter does not overwrite an already-stricter header", async () => {
  const strictLimiter = createRateLimit({
    keyPrefix: `test:binding:strict-first:${Date.now()}`,
    max: 5,
    windowMs: 60_000,
    message: "strict",
    resolveKey: () => "shared",
  });
  const looseLimiter = createRateLimit({
    keyPrefix: `test:binding:loose-first:${Date.now()}`,
    max: 200,
    windowMs: 60_000,
    message: "loose",
    resolveKey: () => "shared",
  });

  const req = createRequest({ ip: "10.3.3.3" });
  const { response, headers } = createResponse();

  assert.equal(await runMiddleware(strictLimiter, req, response), undefined);
  assert.equal(headers.get("X-RateLimit-Limit"), "5");
  assert.equal(headers.get("X-RateLimit-Remaining"), "4");

  assert.equal(await runMiddleware(looseLimiter, req, response), undefined);
  assert.equal(headers.get("X-RateLimit-Limit"), "5");
  assert.equal(headers.get("X-RateLimit-Remaining"), "4");
});

test("a 429 from one limiter sets binding headers to 0 remaining even if the other is loose", async () => {
  const looseLimiter = createRateLimit({
    keyPrefix: `test:binding:429:loose:${Date.now()}`,
    max: 1000,
    windowMs: 60_000,
    message: "loose",
    resolveKey: () => "shared",
  });
  const strictLimiter = createRateLimit({
    keyPrefix: `test:binding:429:strict:${Date.now()}`,
    max: 1,
    windowMs: 60_000,
    message: "strict",
    resolveKey: () => "shared",
  });

  const req = createRequest({ ip: "10.4.4.4" });

  // First request consumes the strict bucket entirely.
  {
    const { response } = createResponse();
    assert.equal(await runMiddleware(looseLimiter, req, response), undefined);
    assert.equal(await runMiddleware(strictLimiter, req, response), undefined);
  }

  const { response, headers } = createResponse();
  assert.equal(await runMiddleware(looseLimiter, req, response), undefined);
  assert.equal(headers.get("X-RateLimit-Remaining"), "998");

  const err = await runMiddleware(strictLimiter, req, response);
  assert.ok(err instanceof HttpError);
  assert.equal((err as HttpError).statusCode, 429);
  assert.equal(headers.get("X-RateLimit-Limit"), "1");
  assert.equal(headers.get("X-RateLimit-Remaining"), "0");
  assert.ok(headers.get("Retry-After"));
});

test("end-to-end chain: two authenticated users sharing one IP do not throttle each other", async () => {
  const ipLimiter = createGlobalApiRateLimit();
  const perUserLimiter = createPerUserApiRateLimit();

  const sharedIp = `10.99.${(Date.now() & 0xff)}.1`;
  const userA = `nat-user-a-${Date.now()}-${Math.random()}`;
  const userB = `nat-user-b-${Date.now()}-${Math.random()}`;

  async function callChain(userId: string) {
    const req = createRequest({ ip: sharedIp, auth: { userId } });
    const { response, headers } = createResponse();
    const ipErr = await runMiddleware(ipLimiter, req, response);
    if (ipErr) return { error: ipErr, headers };
    const perUserErr = await runMiddleware(perUserLimiter, req, response);
    return { error: perUserErr, headers };
  }

  const probe = await callChain(userA);
  assert.equal(probe.error, undefined);
  const perUserMax = Number(probe.headers.get("X-RateLimit-Limit"));
  assert.ok(perUserMax > 1);

  // User A burns through the rest of their per-user bucket (we already
  // consumed 1 with the probe call above).
  for (let i = 1; i < perUserMax; i += 1) {
    const result = await callChain(userA);
    assert.equal(result.error, undefined, `user-a request ${i} should pass`);
  }

  const aBlocked = await callChain(userA);
  assert.ok(aBlocked.error instanceof HttpError);
  assert.equal((aBlocked.error as HttpError).statusCode, 429);
  assert.equal(Number(aBlocked.headers.get("X-RateLimit-Limit")), perUserMax);
  assert.equal(aBlocked.headers.get("X-RateLimit-Remaining"), "0");

  const bResult = await callChain(userB);
  assert.equal(bResult.error, undefined, "user-b on the same NAT must not be throttled by user-a");
  assert.equal(Number(bResult.headers.get("X-RateLimit-Limit")), perUserMax);
  assert.equal(Number(bResult.headers.get("X-RateLimit-Remaining")), perUserMax - 1);
});

test("end-to-end chain: an unauthenticated request still emits IP-based headers", async () => {
  const ipLimiter = createGlobalApiRateLimit();
  const perUserLimiter = createPerUserApiRateLimit();

  const req = createRequest({ ip: `10.50.${(Date.now() & 0xff)}.7` });
  const { response, headers } = createResponse();

  assert.equal(await runMiddleware(ipLimiter, req, response), undefined);
  const ipMax = Number(headers.get("X-RateLimit-Limit"));
  assert.ok(ipMax > 0);
  assert.equal(Number(headers.get("X-RateLimit-Remaining")), ipMax - 1);

  assert.equal(await runMiddleware(perUserLimiter, req, response), undefined);
  assert.equal(Number(headers.get("X-RateLimit-Limit")), ipMax);
  assert.equal(Number(headers.get("X-RateLimit-Remaining")), ipMax - 1);
});

test("buckets are shared across limiter instances (simulates multiple API processes)", async () => {
  // Two separate limiter middleware instances built with the same
  // keyPrefix represent two API processes hitting the same Postgres
  // store. The counter must be shared — this is the core regression
  // guard for the task: with the old in-memory map each "process"
  // would have its own bucket and the effective limit would double.
  const keyPrefix = `test:multi-instance:${Date.now()}`;
  const opts = {
    keyPrefix,
    max: 3,
    windowMs: 60_000,
    message: "shared limit",
    resolveKey: () => "shared-key",
  };
  const instanceA = createRateLimit(opts);
  const instanceB = createRateLimit(opts);

  const req = createRequest({ ip: "10.10.10.10" });

  // Three accepted requests split across the two "instances".
  assert.equal(await runMiddleware(instanceA, req, createResponse().response), undefined);
  assert.equal(await runMiddleware(instanceB, req, createResponse().response), undefined);
  assert.equal(await runMiddleware(instanceA, req, createResponse().response), undefined);

  // The next request on EITHER instance must 429 — the global counter
  // is now at 3/3.
  const blockedOnB = await runMiddleware(instanceB, req, createResponse().response);
  assert.ok(blockedOnB instanceof HttpError);
  assert.equal((blockedOnB as HttpError).statusCode, 429);

  const blockedOnA = await runMiddleware(instanceA, req, createResponse().response);
  assert.ok(blockedOnA instanceof HttpError);
  assert.equal((blockedOnA as HttpError).statusCode, 429);
});

test("buckets survive process-level state (Postgres is the source of truth)", async () => {
  // Build a limiter, consume some budget, then build a brand-new
  // limiter with the same keyPrefix — the new one must see the
  // already-consumed counter. With the old in-memory map this test
  // would pass trivially (Map captured by closure) AND fail across
  // processes; with Postgres it passes for the same reason a second
  // API instance would: the row is durable.
  const keyPrefix = `test:durable:${Date.now()}`;
  const fixedKey = "stable-key";

  const first = createRateLimit({
    keyPrefix,
    max: 5,
    windowMs: 60_000,
    message: "durable",
    resolveKey: () => fixedKey,
  });
  for (let i = 0; i < 4; i += 1) {
    assert.equal(
      await runMiddleware(first, createRequest({ ip: "10.20.30.40" }), createResponse().response),
      undefined,
    );
  }

  // Brand-new limiter, no shared closure state — must still see the 4.
  const second = createRateLimit({
    keyPrefix,
    max: 5,
    windowMs: 60_000,
    message: "durable",
    resolveKey: () => fixedKey,
  });
  const { response: r5, headers: h5 } = createResponse();
  assert.equal(
    await runMiddleware(second, createRequest({ ip: "10.20.30.40" }), r5),
    undefined,
  );
  assert.equal(h5.get("X-RateLimit-Remaining"), "0");

  const blocked = await runMiddleware(
    second,
    createRequest({ ip: "10.20.30.40" }),
    createResponse().response,
  );
  assert.ok(blocked instanceof HttpError);
  assert.equal((blocked as HttpError).statusCode, 429);
});

test("clearRateLimitBucket resets the shared counter", async () => {
  const keyPrefix = `test:clear:${Date.now()}`;
  const fixedKey = "to-be-cleared";
  const limiter = createRateLimit({
    keyPrefix,
    max: 2,
    windowMs: 60_000,
    message: "clear me",
    resolveKey: () => fixedKey,
  });
  const req = createRequest({ ip: "10.30.30.30" });

  assert.equal(await runMiddleware(limiter, req, createResponse().response), undefined);
  assert.equal(await runMiddleware(limiter, req, createResponse().response), undefined);
  const blocked = await runMiddleware(limiter, req, createResponse().response);
  assert.ok(blocked instanceof HttpError);

  await clearRateLimitBucket(keyPrefix, fixedKey);

  // Bucket has been wiped — the next request starts a fresh window.
  const { response, headers } = createResponse();
  assert.equal(await runMiddleware(limiter, req, response), undefined);
  assert.equal(headers.get("X-RateLimit-Remaining"), "1");
});
