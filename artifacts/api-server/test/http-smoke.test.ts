import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // The shared db client (lib/db) prefers SUPABASE_DATABASE_URL when set, but
  // that points at the production pooler with a 15-client cap that the test
  // suites blow through immediately. Force tests to use the local DATABASE_URL.
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

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
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const { pool } = await import("@workspace/db");
  await pool.end();
});

// /livez is the always-200 shallow liveness probe; /healthz performs the
// deep DB+storage readiness check (covered separately in healthz-deep.test.ts).
// We use /livez here so these smoke tests don't depend on a configured
// PRIVATE_OBJECT_DIR or test-database wiring beyond a TCP listener.

test("liveness endpoint stays public", async () => {
  const response = await fetch(`${baseUrl}/api/livez`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("liveness endpoint applies security headers", async () => {
  const response = await fetch(`${baseUrl}/api/livez`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("cors allows configured app origin", async () => {
  const response = await fetch(`${baseUrl}/api/livez`, {
    headers: {
      origin: "https://app.example.com",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.example.com");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("cors allows replit dev origin", async () => {
  const response = await fetch(`${baseUrl}/api/livez`, {
    headers: {
      origin: "https://workspace.kirk.replit.dev",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://workspace.kirk.replit.dev");
});

test("cors does not reflect disallowed origins", async () => {
  const response = await fetch(`${baseUrl}/api/livez`, {
    headers: {
      origin: "https://evil.example.com",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("state-changing requests require the XMLHttpRequest header", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "unauthorized@example.com",
      password: "Cadstone123!",
      full_name: "Unauthorized User",
    }),
  });

  assert.equal(response.status, 403);
});

test("register endpoint rejects unauthenticated callers", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      email: "unauthorized@example.com",
      password: "Cadstone123!",
      full_name: "Unauthorized User",
    }),
  });

  assert.equal(response.status, 401);
});

test("uploads require authentication", async () => {
  const response = await fetch(`${baseUrl}/uploads/nonexistent-file.txt`);

  assert.equal(response.status, 401);
});

test("protected routes reject missing bearer tokens", async () => {
  const response = await fetch(`${baseUrl}/api/users`);

  assert.equal(response.status, 401);
});
