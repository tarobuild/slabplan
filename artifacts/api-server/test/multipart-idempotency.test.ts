import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;
const adminUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@multipart-idempotency-test.local`;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const express = (await import("express")).default;
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { requireAuth } = await import("../src/middleware/require-auth.ts");
  const {
    idempotencyMiddleware,
  } = await import("../src/middleware/idempotency.ts");
  const { uploadArray, ensureTempUploadDir } = await import(
    "../src/lib/uploads.ts"
  );

  await ensureTempUploadDir();

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Multipart Idempotency Admin",
    role: "admin",
  });

  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Multipart Idempotency Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Tiny app: requireAuth → idempotencyMiddleware (skips multipart) →
  // uploadArray (which internally invokes multipartIdempotencyMiddleware
  // after multer parses) → handler. This exercises the real production
  // pipeline without dragging in folder/job setup.
  const app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(idempotencyMiddleware());
  app.post(
    "/test-upload",
    uploadArray("files", 5),
    (req, res) => {
      // Echo back the count + first file's hash so the test can detect
      // double-execution (duplicate handler invocations would generate
      // different `requestId` values for what's supposed to be the same
      // logical request).
      const files = (req.files as Express.Multer.File[]) ?? [];
      res.status(201).json({
        requestId: crypto.randomUUID(),
        count: files.length,
        firstHash: files[0]?.contentHash ?? null,
        firstSize: files[0]?.size ?? null,
      });
    },
  );
  app.use((err: unknown, _req: unknown, res: import("express").Response, _next: unknown) => {
    const error = err as { statusCode?: number; message?: string; type?: string };
    res
      .status(error.statusCode ?? 500)
      .type("application/json")
      .json({
        type: error.type ?? "internal-error",
        message: error.message ?? "Internal error",
      });
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { users, idempotencyKeys } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  try {
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, adminUserId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

function buildFormData(content: Buffer, filename: string): FormData {
  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(content)], { type: "text/plain" }),
    filename,
  );
  return form;
}

test("hashing storage attaches a deterministic SHA-256 to every uploaded file", async () => {
  const content = Buffer.from("the quick brown fox jumps over the lazy dog");
  const expected = crypto.createHash("sha256").update(content).digest("hex");

  const response = await fetch(`${baseUrl}/test-upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "idempotency-key": `mp-hash-${crypto.randomUUID()}`,
    },
    body: buildFormData(content, "fox.txt"),
  });
  assert.equal(response.status, 201, "upload must succeed");
  const body = (await response.json()) as {
    count: number;
    firstHash: string;
    firstSize: number;
  };
  assert.equal(body.count, 1);
  assert.equal(
    body.firstHash,
    expected,
    "contentHash must equal SHA-256 of the uploaded bytes",
  );
  assert.equal(body.firstSize, content.length);
});

test("multipart replay with the same key + same file returns Idempotent-Replayed: true", async () => {
  const content = Buffer.from(`replay-${crypto.randomUUID()}`);
  const idempotencyKey = `mp-replay-${crypto.randomUUID()}`;

  const first = await fetch(`${baseUrl}/test-upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "idempotency-key": idempotencyKey,
    },
    body: buildFormData(content, "first.txt"),
  });
  assert.equal(first.status, 201, "first upload must succeed");
  assert.equal(
    first.headers.get("idempotent-replayed"),
    null,
    "the original request must NOT carry the replay marker",
  );
  const firstBody = await first.text();
  const firstParsed = JSON.parse(firstBody) as { requestId: string };
  assert.ok(firstParsed.requestId, "first response must include a requestId");

  // Replay with the same key + same content. The handler must NOT run a
  // second time — the cached body (including the original requestId) is
  // what we expect back.
  const second = await fetch(`${baseUrl}/test-upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "idempotency-key": idempotencyKey,
    },
    body: buildFormData(content, "first.txt"),
  });
  assert.equal(second.status, 201, "replay must echo the original status");
  assert.equal(
    second.headers.get("idempotent-replayed"),
    "true",
    "replay must set Idempotent-Replayed: true",
  );
  const secondBody = await second.text();
  assert.equal(
    secondBody,
    firstBody,
    "replay body must be byte-identical to the cached response",
  );
});

test("multipart retry with the same key + DIFFERENT file content returns 409", async () => {
  const idempotencyKey = `mp-conflict-${crypto.randomUUID()}`;

  const first = await fetch(`${baseUrl}/test-upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "idempotency-key": idempotencyKey,
    },
    body: buildFormData(Buffer.from("original content v1"), "doc.txt"),
  });
  assert.equal(first.status, 201, "first upload must succeed");

  // Retry with the SAME key but completely different file bytes. Without
  // file-content hashing this would silently replay the cached 201 and
  // drop the new upload — which is the data-loss bug Task #165 is
  // about. The middleware must surface a 409 instead.
  const conflict = await fetch(`${baseUrl}/test-upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "idempotency-key": idempotencyKey,
    },
    body: buildFormData(Buffer.from("REPLACED content v2 — totally new"), "doc.txt"),
  });
  assert.equal(
    conflict.status,
    409,
    "different file bytes with the same key must fail loudly",
  );
  const body = (await conflict.json()) as { type: string; message: string };
  assert.equal(
    body.type,
    "idempotency-conflict",
    "error must use the existing idempotency-conflict problem type",
  );
  assert.match(
    body.message,
    /upload contents/i,
    "error message must mention the upload contents specifically",
  );
});

