import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";
  // Use a tiny limit so the rate-limit test doesn't fire 31 requests.
  process.env.CLIENT_ERROR_PER_IP_MAX = "3";
  process.env.CLIENT_ERROR_PER_IP_WINDOW_MS = "60000";

  const { default: app, prepareApp } = await import("../src/app.ts");
  await prepareApp();

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  const { pool } = await import("@workspace/db");
  await pool.end();
});

function postReport(body: unknown) {
  return fetch(`${baseUrl}/api/_client-error`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  });
}

test("happy path: anonymous report returns 204 with empty body", async () => {
  const response = await postReport({
    message: "Cannot read properties of undefined (reading 'foo')",
    stack: "Error: …\n  at Component (file.tsx:10:5)",
    componentStack: "in <Component>",
    url: "https://app.example.com/dashboard?secret=hunter2#fragment",
    userAgent: "Mozilla/5.0 (test runner)",
    releaseSha: "abc1234",
  });

  assert.equal(response.status, 204);
  const text = await response.text();
  assert.equal(text, "", "204 must not echo the payload back");
});

test("invalid payload (missing required fields) returns 400 problem+json", async () => {
  const response = await postReport({ stack: "no message" });
  assert.equal(response.status, 400);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );
  const body = (await response.json()) as { type: string; status: number };
  assert.equal(body.status, 400);
  assert.match(body.type, /validation/);
});

test("oversized stack is accepted (server truncates internally) — request still 204", async () => {
  // The endpoint must not reject a giant stack outright; it truncates server-
  // side before logging. A 16 KB stack is well over the 8 KB log cap but the
  // client should still see a 204.
  const bigStack = "X".repeat(16 * 1024);
  const response = await postReport({
    message: "boom",
    stack: bigStack,
    url: "https://app.example.com/jobs/abc",
  });
  assert.equal(response.status, 204);
});

test("per-IP rate limit kicks in after the configured threshold", async () => {
  // CLIENT_ERROR_PER_IP_MAX is set to 3 in the before() hook for this suite.
  // The earlier tests in this file already consumed a few requests from
  // 127.0.0.1, but this test fires from the same loopback IP so it will hit
  // the limit immediately. Burn until we see a 429.
  let saw429 = false;
  for (let i = 0; i < 20; i += 1) {
    const response = await postReport({
      message: "loop crash",
      url: "https://app.example.com/jobs/loop",
    });
    if (response.status === 429) {
      saw429 = true;
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/problem\+json/,
      );
      assert.ok(
        response.headers.get("retry-after"),
        "429 must include a Retry-After header",
      );
      break;
    }
    assert.equal(
      response.status,
      204,
      `pre-limit request ${i} should still 204`,
    );
  }
  assert.ok(saw429, "expected the limiter to fire a 429 within 20 requests");
});

test("CSRF gate rejects state-changing reports without X-Requested-With", async () => {
  // Sanity check that the report endpoint still goes through the global CSRF
  // gate so a CSRF-style cross-origin form POST cannot quietly fill the log
  // sink. ErrorBoundary always sets X-Requested-With.
  const response = await fetch(`${baseUrl}/api/_client-error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "boom",
      url: "https://app.example.com/x",
    }),
  });
  assert.equal(response.status, 403);
});
