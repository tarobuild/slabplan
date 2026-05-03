import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

// ---------------------------------------------------------------------------
// End-to-end regression for #274.
//
// We spawn the production bundle (`node ./dist/index.mjs`), then POST a
// real PDF to `/api/folders/:id/files`. If file-type's transitive
// strtok3/token-types graph is missing from production node_modules
// the request would fail with HTTP 415 (`Magic-byte sniff failed; …
// ERR_MODULE_NOT_FOUND`). A 201 here proves the bundled server can
// actually serve uploads end-to-end after `pnpm install --prod`.
// ---------------------------------------------------------------------------

const apiServerDir = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const distEntry = path.join(apiServerDir, "dist", "index.mjs");

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.CADSTONE_TEST_DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

// Shared secrets so we can sign access tokens in this process and have
// the spawned bundled server accept them.
const sharedAccessSecret = crypto.randomBytes(32).toString("hex");
const sharedRefreshSecret = crypto.randomBytes(32).toString("hex");
const sharedUploadSecret = crypto.randomBytes(32).toString("hex");

const adminUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@build-smoke.local`;
const folderId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const clientId = crypto.randomUUID();

let serverProcess: ChildProcess | null = null;
let baseUrl = "";
let adminToken = "";
let teardownDb: (() => Promise<void>) | null = null;
let bootSkipReason: string | null = null;

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n%\xC4\xE5\xF2\xE5\xEB\xA7\n%%EOF\n",
  "binary",
);

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    import("node:net").then((net) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (typeof addr === "object" && addr) {
          const port = addr.port;
          srv.close(() => resolve(port));
        } else {
          srv.close();
          reject(new Error("Could not allocate port"));
        }
      });
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/healthz`);
      if (r.status === 200) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Bundled server never became healthy at ${url}. lastErr=${String(lastErr)}`,
  );
}

before(async () => {
  if (!existsSync(distEntry)) {
    bootSkipReason = `dist bundle missing at ${distEntry} — run \`pnpm --filter @workspace/api-server run build\` first`;
    return;
  }

  // Seed an admin + a folder against the test DB *from this process* so
  // we can reuse the same DB the spawned server will read.
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.JWT_ACCESS_SECRET = sharedAccessSecret;
  process.env.JWT_REFRESH_SECRET = sharedRefreshSecret;
  process.env.JWT_UPLOAD_SECRET = sharedUploadSecret;

  const auth = await import("../src/lib/auth.ts");
  const { db, pool } = await import("@workspace/db");
  const { users, folders, jobs, clients } = await import(
    "@workspace/db/schema"
  );
  const { eq } = await import("drizzle-orm");

  await db.insert(clients).values({
    id: clientId,
    companyName: `BuildSmoke Client ${clientId}`,
  });

  await db.insert(jobs).values({
    id: jobId,
    title: `BuildSmoke Job ${jobId}`,
    clientId,
    status: "open",
  });

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "Build Smoke Admin",
    role: "admin",
  });

  await db.insert(folders).values({
    id: folderId,
    title: `BuildSmoke Folder ${folderId}`,
    scope: "job",
    jobId,
    mediaType: "document",
  });

  adminToken = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "Build Smoke Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  teardownDb = async () => {
    try {
      await db.delete(folders).where(eq(folders.id, folderId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(clients).where(eq(clients.id, clientId));
      await db.delete(users).where(eq(users.id, adminUserId));
    } finally {
      await pool.end();
    }
  };

  const port = await pickPort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, [distEntry], {
    cwd: apiServerDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_ACCESS_SECRET: sharedAccessSecret,
      JWT_REFRESH_SECRET: sharedRefreshSecret,
      JWT_UPLOAD_SECRET: sharedUploadSecret,
      CORS_ALLOWED_ORIGINS: "https://app.example.com",
    },
  });

  let stderrBuf = "";
  serverProcess.stderr?.on("data", (c) => {
    stderrBuf += c.toString();
  });
  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      // Log so the test failure has context if startup blew up.
      console.error(
        `[build-pdf-upload] bundled server exited code=${code}\nstderr=\n${stderrBuf}`,
      );
    }
  });

  await waitForHealth(baseUrl, 30_000);
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        serverProcess?.kill("SIGKILL");
        resolve();
      }, 5_000);
      serverProcess?.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  if (teardownDb) {
    try {
      await teardownDb();
    } catch {
      /* best-effort */
    }
  }
});

test("bundled server accepts a real PDF upload (no ERR_MODULE_NOT_FOUND in prod path)", async (t) => {
  if (bootSkipReason) {
    t.skip(bootSkipReason);
    return;
  }

  const fd = new FormData();
  fd.append(
    "files",
    new Blob([new Uint8Array(PDF_BYTES)], { type: "application/pdf" }),
    "build-smoke.pdf",
  );

  const res = await fetch(`${baseUrl}/api/folders/${folderId}/files`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "x-requested-with": "XMLHttpRequest",
    },
    body: fd,
  });
  const text = await res.text();
  assert.equal(
    res.status,
    201,
    `Expected 201 from bundled server PDF upload, got ${res.status}. Body=${text}`,
  );
  // Defence-in-depth: explicitly assert the production-error breadcrumb
  // never reaches the client.
  assert.doesNotMatch(text, /Magic-byte sniff failed/);
  assert.doesNotMatch(text, /ERR_MODULE_NOT_FOUND/);
});
