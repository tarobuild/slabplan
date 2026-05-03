import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Smoke tests for `POST /api/internal/run-db-backup`. These exercise
// the auth gating and dormant-when-unconfigured behaviour without
// actually spawning the real `pg_dump` script (we never reach the
// happy path here — that would require a live Postgres + sidecar).

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
  delete process.env.BACKUP_TRIGGER_SECRET;

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

test("backup webhook returns 503 while BACKUP_TRIGGER_SECRET is unset", async () => {
  delete process.env.BACKUP_TRIGGER_SECRET;
  const response = await fetch(`${baseUrl}/api/internal/run-db-backup`, {
    method: "POST",
    headers: { "x-backup-secret": "anything" },
  });
  assert.equal(response.status, 503);
});

test("backup webhook rejects a missing or wrong secret with 401 once configured", async () => {
  process.env.BACKUP_TRIGGER_SECRET =
    "x".repeat(48); // 32+ chars per route check
  try {
    const noHeader = await fetch(`${baseUrl}/api/internal/run-db-backup`, {
      method: "POST",
    });
    assert.equal(noHeader.status, 401);

    const wrongHeader = await fetch(`${baseUrl}/api/internal/run-db-backup`, {
      method: "POST",
      headers: { "x-backup-secret": "wrong-secret-not-32-chars-long-zz" },
    });
    assert.equal(wrongHeader.status, 401);
  } finally {
    delete process.env.BACKUP_TRIGGER_SECRET;
  }
});

test("backup webhook accepts a correct secret and resolves the script path", async () => {
  // Sanity check on the path resolver: the route must locate the
  // shipped `scripts/db-backup.mjs` from any of the supported launch
  // modes (test runs from the api-server package dir, so candidate #1
  // wins). If the path resolver regresses we'd see a 500 here.
  const secret = "z".repeat(48);
  process.env.BACKUP_TRIGGER_SECRET = secret;
  try {
    const response = await fetch(`${baseUrl}/api/internal/run-db-backup`, {
      method: "POST",
      headers: { "x-backup-secret": secret },
    });
    // 202 = backup spawned. We immediately return — the child process
    // will fail without a real DB, but that's an out-of-band exit
    // logged by the route, not part of the HTTP response.
    assert.equal(response.status, 202);
    const body = (await response.json()) as {
      status: string;
      pid: number | null;
    };
    assert.equal(body.status, "accepted");
    assert.ok(typeof body.pid === "number" && body.pid > 0);
  } finally {
    delete process.env.BACKUP_TRIGGER_SECRET;
  }
});
