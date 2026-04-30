import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import {
  createGlobalApiRateLimit,
  createPerUserApiRateLimit,
  createRateLimit,
} from "../src/lib/rate-limit.ts";
import { HttpError } from "../src/lib/http.ts";

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

function runMiddleware(
  middleware: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request,
  res: Response,
): unknown {
  let captured: unknown = undefined;
  middleware(req, res, (error) => {
    captured = error;
  });
  return captured;
}

test("createRateLimit blocks requests after the configured threshold", () => {
  const middleware = createRateLimit({
    keyPrefix: "test:login",
    max: 2,
    windowMs: 60_000,
    message: "Too many attempts.",
    resolveKey: (req) => req.ip || null,
  });

  const request = createRequest({ ip: "127.0.0.1" });
  const { response, headers } = createResponse();
  const forwardedErrors: unknown[] = [];

  middleware(request, response, (error) => {
    forwardedErrors.push(error);
  });
  middleware(request, response, (error) => {
    forwardedErrors.push(error);
  });
  middleware(request, response, (error) => {
    forwardedErrors.push(error);
  });

  assert.deepEqual(forwardedErrors.slice(0, 2), [undefined, undefined]);
  assert.ok(forwardedErrors[2] instanceof HttpError);
  assert.equal((forwardedErrors[2] as HttpError).statusCode, 429);
  assert.equal(headers.get("Retry-After"), "60");
});

test("two users sharing one IP get separate per-user buckets", () => {
  // Use unique key prefixes via a fresh limiter so other tests cannot bleed in.
  const perUser = createRateLimit({
    keyPrefix: "test:nat:perUser",
    max: 5,
    windowMs: 60_000,
    message: "user limit",
    resolveKey: (req) => (req.auth?.userId ? `u:${req.auth.userId}` : null),
  });

  const userA = createRequest({ ip: "10.0.0.1", auth: { userId: "user-a" } });
  const userB = createRequest({ ip: "10.0.0.1", auth: { userId: "user-b" } });

  // User A burns its entire bucket.
  for (let i = 0; i < 5; i += 1) {
    const { response } = createResponse();
    const err = runMiddleware(perUser, userA, response);
    assert.equal(err, undefined, `request ${i} for user-a should pass`);
  }

  const { response: aBlocked } = createResponse();
  const aBlockedErr = runMiddleware(perUser, userA, aBlocked);
  assert.ok(aBlockedErr instanceof HttpError);
  assert.equal((aBlockedErr as HttpError).statusCode, 429);

  // User B is on the same IP but has its own bucket and is unaffected.
  const { response: bResp, headers: bHeaders } = createResponse();
  const bErr = runMiddleware(perUser, userB, bResp);
  assert.equal(bErr, undefined);
  assert.equal(bHeaders.get("X-RateLimit-Limit"), "5");
  assert.equal(bHeaders.get("X-RateLimit-Remaining"), "4");
});

test("PAT and interactive session for the same user are bucketed separately", () => {
  const perUser = createPerUserApiRateLimit();

  const userId = `pat-vs-session-${Date.now()}`;
  const sessionReq = createRequest({ auth: { userId } });
  const patReq = createRequest({ auth: { userId, patId: "pat-123" } });
  const otherPatReq = createRequest({ auth: { userId, patId: "pat-456" } });

  // First call to each bucket should populate it independently.
  const sessionRes = createResponse();
  assert.equal(runMiddleware(perUser, sessionReq, sessionRes.response), undefined);
  const initialRemaining = Number(sessionRes.headers.get("X-RateLimit-Remaining"));
  assert.ok(initialRemaining > 0);
  const perUserMax = Number(sessionRes.headers.get("X-RateLimit-Limit"));
  assert.equal(initialRemaining, perUserMax - 1);

  const patRes = createResponse();
  assert.equal(runMiddleware(perUser, patReq, patRes.response), undefined);
  assert.equal(Number(patRes.headers.get("X-RateLimit-Remaining")), perUserMax - 1);

  const otherPatRes = createResponse();
  assert.equal(runMiddleware(perUser, otherPatReq, otherPatRes.response), undefined);
  assert.equal(Number(otherPatRes.headers.get("X-RateLimit-Remaining")), perUserMax - 1);

  // A second call to the session bucket only decrements the session bucket.
  const sessionRes2 = createResponse();
  assert.equal(runMiddleware(perUser, sessionReq, sessionRes2.response), undefined);
  assert.equal(Number(sessionRes2.headers.get("X-RateLimit-Remaining")), perUserMax - 2);

  // The PAT buckets are untouched.
  const patRes2 = createResponse();
  assert.equal(runMiddleware(perUser, patReq, patRes2.response), undefined);
  assert.equal(Number(patRes2.headers.get("X-RateLimit-Remaining")), perUserMax - 2);
});

test("createPerUserApiRateLimit is a no-op for unauthenticated requests", () => {
  const middleware = createPerUserApiRateLimit();
  const { response, headers } = createResponse();
  const err = runMiddleware(middleware, createRequest({ ip: "10.1.1.1" }), response);
  assert.equal(err, undefined);
  assert.equal(headers.get("X-RateLimit-Limit"), undefined);
});

test("when both limiters fire the headers reflect the stricter (binding) limit", () => {
  // Looser limiter runs first (mimics the global IP limiter on a fresh window),
  // then the stricter limiter overlays. The stricter values must win.
  const looseLimiter = createRateLimit({
    keyPrefix: "test:binding:loose",
    max: 100,
    windowMs: 60_000,
    message: "loose",
    resolveKey: () => "shared",
  });
  const strictLimiter = createRateLimit({
    keyPrefix: "test:binding:strict",
    max: 10,
    windowMs: 60_000,
    message: "strict",
    resolveKey: () => "shared",
  });

  const req = createRequest({ ip: "10.2.2.2" });
  const { response, headers } = createResponse();

  assert.equal(runMiddleware(looseLimiter, req, response), undefined);
  // After the loose limiter, it has set its own (large) headers.
  assert.equal(headers.get("X-RateLimit-Limit"), "100");
  assert.equal(headers.get("X-RateLimit-Remaining"), "99");

  assert.equal(runMiddleware(strictLimiter, req, response), undefined);
  // The stricter limit should have overwritten the headers because it has
  // fewer remaining requests (9 < 99).
  assert.equal(headers.get("X-RateLimit-Limit"), "10");
  assert.equal(headers.get("X-RateLimit-Remaining"), "9");
});

test("the looser limiter does not overwrite an already-stricter header", () => {
  // Reverse order: stricter runs first, then looser. Headers should remain
  // pinned to the stricter values.
  const strictLimiter = createRateLimit({
    keyPrefix: "test:binding:strict-first",
    max: 5,
    windowMs: 60_000,
    message: "strict",
    resolveKey: () => "shared",
  });
  const looseLimiter = createRateLimit({
    keyPrefix: "test:binding:loose-first",
    max: 200,
    windowMs: 60_000,
    message: "loose",
    resolveKey: () => "shared",
  });

  const req = createRequest({ ip: "10.3.3.3" });
  const { response, headers } = createResponse();

  assert.equal(runMiddleware(strictLimiter, req, response), undefined);
  assert.equal(headers.get("X-RateLimit-Limit"), "5");
  assert.equal(headers.get("X-RateLimit-Remaining"), "4");

  assert.equal(runMiddleware(looseLimiter, req, response), undefined);
  // Loose limiter has 199 remaining vs strict's 4; strict still binds.
  assert.equal(headers.get("X-RateLimit-Limit"), "5");
  assert.equal(headers.get("X-RateLimit-Remaining"), "4");
});

test("a 429 from one limiter sets binding headers to 0 remaining even if the other is loose", () => {
  // Simulates: loose IP limiter has plenty of room, but the stricter per-user
  // limiter is exhausted. The visible headers must show the per-user 0
  // remaining so the client knows it is the binding constraint.
  const looseLimiter = createRateLimit({
    keyPrefix: "test:binding:429:loose",
    max: 1000,
    windowMs: 60_000,
    message: "loose",
    resolveKey: () => "shared",
  });
  const strictLimiter = createRateLimit({
    keyPrefix: "test:binding:429:strict",
    max: 1,
    windowMs: 60_000,
    message: "strict",
    resolveKey: () => "shared",
  });

  const req = createRequest({ ip: "10.4.4.4" });

  // First request consumes the strict bucket entirely.
  {
    const { response } = createResponse();
    assert.equal(runMiddleware(looseLimiter, req, response), undefined);
    assert.equal(runMiddleware(strictLimiter, req, response), undefined);
  }

  // Second request: loose still has room, strict is exhausted → 429.
  const { response, headers } = createResponse();
  assert.equal(runMiddleware(looseLimiter, req, response), undefined);
  // Loose set headers showing 998 remaining of 1000.
  assert.equal(headers.get("X-RateLimit-Remaining"), "998");

  const err = runMiddleware(strictLimiter, req, response);
  assert.ok(err instanceof HttpError);
  assert.equal((err as HttpError).statusCode, 429);
  assert.equal(headers.get("X-RateLimit-Limit"), "1");
  assert.equal(headers.get("X-RateLimit-Remaining"), "0");
  assert.ok(headers.get("Retry-After"));
});

test("end-to-end chain: two authenticated users sharing one IP do not throttle each other", () => {
  // Wire up the actual production chain: global IP limiter (mounted before
  // requireAuth in app.ts) followed by the per-user limiter (mounted after
  // requireAuth in routes/index.ts). This is the regression guard for the
  // task's primary outcome — one user behind a shared NAT must not be
  // rate-limited by other users on the same IP.
  const ipLimiter = createGlobalApiRateLimit();
  const perUserLimiter = createPerUserApiRateLimit();

  const sharedIp = `10.99.${(Date.now() & 0xff)}.1`;
  const userA = `nat-user-a-${Date.now()}`;
  const userB = `nat-user-b-${Date.now()}`;

  function callChain(userId: string) {
    const req = createRequest({ ip: sharedIp, auth: { userId } });
    const { response, headers } = createResponse();
    const ipErr = runMiddleware(ipLimiter, req, response);
    if (ipErr) return { error: ipErr, headers };
    const perUserErr = runMiddleware(perUserLimiter, req, response);
    return { error: perUserErr, headers };
  }

  // Read the per-user max from a single dry-run call so the test is robust
  // against future quota tweaks.
  const probe = callChain(userA);
  assert.equal(probe.error, undefined);
  const perUserMax = Number(probe.headers.get("X-RateLimit-Limit"));
  assert.ok(perUserMax > 1);

  // User A burns through the rest of their per-user bucket (we already
  // consumed 1 with the probe call above).
  for (let i = 1; i < perUserMax; i += 1) {
    const result = callChain(userA);
    assert.equal(result.error, undefined, `user-a request ${i} should pass`);
  }

  // The next user-A request must 429 — and the headers should reflect the
  // per-user limit (the binding constraint), not the still-roomy IP limit.
  const aBlocked = callChain(userA);
  assert.ok(aBlocked.error instanceof HttpError);
  assert.equal((aBlocked.error as HttpError).statusCode, 429);
  assert.equal(Number(aBlocked.headers.get("X-RateLimit-Limit")), perUserMax);
  assert.equal(aBlocked.headers.get("X-RateLimit-Remaining"), "0");

  // User B, on the same IP, has barely touched the IP bucket and has a
  // pristine per-user bucket. They must not be throttled by user A's spend.
  const bResult = callChain(userB);
  assert.equal(bResult.error, undefined, "user-b on the same NAT must not be throttled by user-a");
  assert.equal(Number(bResult.headers.get("X-RateLimit-Limit")), perUserMax);
  assert.equal(Number(bResult.headers.get("X-RateLimit-Remaining")), perUserMax - 1);
});

test("end-to-end chain: an unauthenticated request still emits IP-based headers", () => {
  // Sanity check the other half of the design: when there is no req.auth,
  // the per-user limiter is a no-op and the visible headers come from the
  // global IP limiter — preserving the header consistency that motivated
  // mounting the IP limiter before `requireAuth`.
  const ipLimiter = createGlobalApiRateLimit();
  const perUserLimiter = createPerUserApiRateLimit();

  const req = createRequest({ ip: `10.50.${(Date.now() & 0xff)}.7` });
  const { response, headers } = createResponse();

  assert.equal(runMiddleware(ipLimiter, req, response), undefined);
  // The IP limiter set the headers.
  const ipMax = Number(headers.get("X-RateLimit-Limit"));
  assert.ok(ipMax > 0);
  assert.equal(Number(headers.get("X-RateLimit-Remaining")), ipMax - 1);

  // Per-user limiter sees no auth, makes no changes.
  assert.equal(runMiddleware(perUserLimiter, req, response), undefined);
  assert.equal(Number(headers.get("X-RateLimit-Limit")), ipMax);
  assert.equal(Number(headers.get("X-RateLimit-Remaining")), ipMax - 1);
});
