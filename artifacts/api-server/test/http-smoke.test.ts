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
  process.env.DATABASE_URL ??= testDatabaseUrl;

  const { default: app } = await import("../src/app.ts");

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

test("health endpoint stays public", async () => {
  const response = await fetch(`${baseUrl}/api/healthz`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("register endpoint rejects unauthenticated callers", async () => {
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
