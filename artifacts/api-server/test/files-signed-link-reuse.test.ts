import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

const adminUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@signed-link-reuse-test.local`;
const clientId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const folderId = crypto.randomUUID();
const fileId = crypto.randomUUID();
const fileUrl = `/uploads/signed-link-reuse-test/${fileId}.pdf`;
const filePayload = Buffer.from("signed-link-reuse-test-payload");

let server: Server;
let baseUrl: string;
let validViewToken: string;
let expiredViewToken: string;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";
  // Pin the access secret so the expired-token test can hand-craft a
  // file_view JWT with the same secret the route's verifier uses.
  process.env.JWT_ACCESS_SECRET = "signed-link-reuse-access-secret";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const storage = await import("../src/lib/storage.ts");
  const { db } = await import("@workspace/db");
  const { clients, files, folders, jobs, users } = await import("@workspace/db/schema");

  await prepareApp();

  // Replace GCS streaming with an in-process stub so the success path
  // does not require object storage. The route must still pass token
  // verification, user lookup, and authorization to reach this stub.
  storage.__streamStoredFileTesting.setImpl(async (res, _url, opts) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${opts.filename}"`);
    res.status(200).end(filePayload);
  });

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Signed Link Reuse Admin",
    role: "admin",
  });
  await db.insert(clients).values({
    id: clientId,
    companyName: "ZZZ Signed Link Reuse Client",
    createdBy: adminUserId,
  });
  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Signed Link Reuse Job",
    clientId,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });
  await db.insert(folders).values({
    id: folderId,
    jobId,
    scope: "job",
    title: "ZZZ Signed Link Reuse Folder",
    mediaType: "document",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true },
  });
  await db.insert(files).values({
    id: fileId,
    folderId,
    filename: "signed-link-reuse.pdf",
    originalName: "signed-link-reuse.pdf",
    mimeType: "application/pdf",
    fileUrl,
    uploadedBy: adminUserId,
  });

  const stamp = new Date();
  const adminPublicUser = {
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Signed Link Reuse Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  validViewToken = auth.signFileViewToken(adminPublicUser, fileId);

  const now = Math.floor(Date.now() / 1000);
  expiredViewToken = jwt.sign(
    {
      type: "file_view",
      email: adminEmail,
      role: "admin",
      fileId,
      iat: now - 600,
      exp: now - 60,
    },
    process.env.JWT_ACCESS_SECRET!,
    {
      subject: adminUserId,
      jwtid: crypto.randomBytes(16).toString("hex"),
      algorithm: "HS256",
    },
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const storage = await import("../src/lib/storage.ts");
  const { activityLog, clients, files, folders, idempotencyKeys, jobs, users } =
    await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  storage.__streamStoredFileTesting.reset();

  try {
    const userIds = [adminUserId];
    await db.delete(activityLog).where(inArray(activityLog.userId, userIds));
    await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.userId, userIds));
    await db.delete(files).where(eq(files.id, fileId));
    await db.delete(folders).where(eq(folders.id, folderId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

test("signed file-view token serves the same file twice within its TTL", async () => {
  const url = `${baseUrl}/api/files/${fileId}/view-signed?token=${encodeURIComponent(validViewToken)}`;

  const first = await fetch(url);
  const firstBody = Buffer.from(await first.arrayBuffer());
  const second = await fetch(url);
  const secondBody = Buffer.from(await second.arrayBuffer());

  assert.equal(first.status, 200, "first signed-view request must succeed");
  assert.equal(second.status, 200, "re-fetching the same signed link must also succeed");
  assert.deepEqual(firstBody, filePayload);
  assert.deepEqual(secondBody, filePayload);
});

test("signed file-view token is rejected once its TTL elapses", async () => {
  const response = await fetch(
    `${baseUrl}/api/files/${fileId}/view-signed?token=${encodeURIComponent(expiredViewToken)}`,
  );

  assert.equal(response.status, 401);
});
