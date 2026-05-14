import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let healthTesting: typeof import("../src/routes/health").__healthCheckTesting;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  await prepareApp();

  ({ __healthCheckTesting: healthTesting } = await import(
    "../src/routes/health.ts"
  ));

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  healthTesting.reset();
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  const { pool } = await import("@workspace/db");
  await pool.end();
});

test("healthz returns 200 + status:ok when both deps respond", async () => {
  healthTesting.setChecks({
    db: async () => undefined,
    storage: async () => undefined,
  });

  const response = await fetch(`${baseUrl}/api/healthz`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    status: string;
    db: boolean;
    storage: boolean;
    durationMs: number;
    errors: unknown[];
  };
  assert.equal(body.status, "ok");
  assert.equal(body.db, true);
  assert.equal(body.storage, true);
  assert.equal(typeof body.durationMs, "number");
  assert.ok(body.durationMs >= 0);
  assert.deepEqual(body.errors, []);
});

test("healthz reports db:false + 503 when the database check fails", async () => {
  healthTesting.setChecks({
    db: async () => {
      const err = new Error("connect ECONNREFUSED 127.0.0.1:5432");
      (err as { code?: string }).code = "ECONNREFUSED";
      throw err;
    },
    storage: async () => undefined,
  });

  const response = await fetch(`${baseUrl}/api/healthz`);
  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    status: string;
    db: boolean;
    storage: boolean;
    errors: Array<{ code: string; message: string }>;
  };
  assert.equal(body.status, "degraded");
  assert.equal(body.db, false);
  assert.equal(body.storage, true);
  assert.ok(body.errors.length >= 1);
  assert.equal(body.errors[0].code, "ECONNREFUSED");
});

test("healthz reports storage:false but stays routable when the bucket head check fails", async () => {
  healthTesting.setChecks({
    db: async () => undefined,
    storage: async () => {
      throw new Error("bucket cad-stone-prod is not reachable");
    },
  });

  const response = await fetch(`${baseUrl}/api/healthz`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    status: string;
    db: boolean;
    storage: boolean;
    errors: Array<{ code: string; message: string }>;
  };
  assert.equal(body.status, "degraded");
  assert.equal(body.db, true);
  assert.equal(body.storage, false);
  assert.ok(body.errors.length >= 1);
});

test("healthz times out a slow dependency at 1.5s and marks it degraded", async () => {
  // Promise that never resolves — simulates a stuck network call.
  healthTesting.setChecks({
    db: () => new Promise<void>(() => undefined),
    storage: async () => undefined,
  });

  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/healthz`);
  const elapsed = Date.now() - startedAt;
  assert.equal(response.status, 503);
  const body = (await response.json()) as { db: boolean; errors: Array<{ code: string }> };
  assert.equal(body.db, false);
  assert.ok(body.errors.some((e) => e.code === "TIMEOUT"));
  // Sanity check the hard timeout: must be well under 5s; we allow some
  // overhead for the test runner / fetch round-trip.
  assert.ok(
    elapsed < 4000,
    `healthz should respect the 1.5s per-check timeout; took ${elapsed}ms`,
  );
});

test("livez stays a shallow always-200 probe", async () => {
  // Even with a broken db check the shallow probe must still succeed.
  healthTesting.setChecks({
    db: async () => {
      throw new Error("db down");
    },
    storage: async () => undefined,
  });

  const response = await fetch(`${baseUrl}/api/livez`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
