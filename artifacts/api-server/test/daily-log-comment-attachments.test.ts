import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminToken: string;

const adminUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const dailyLogId = crypto.randomUUID();

// 1x1 transparent PNG. Used as a small valid image so the
// `validateUploadForMediaType("photo")` allowlist accepts the upload
// without us having to maintain a fixture file on disk.
const tinyPngBytes = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478da6300010000000500010d0a2db40000000049454e44ae426082",
  "hex",
);

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";
  process.env.SUPABASE_URL ??= "https://storage.example.invalid";
  process.env.SUPABASE_STORAGE_BUCKET ??= "cadstone-files";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const storageMod = await import("../src/lib/storage.ts");
  const { db } = await import("@workspace/db");
  const { users, jobs, dailyLogs } = await import("@workspace/db/schema");

  storageMod.__storageWriteTesting.setImpls({
    writeBuffer: async () => undefined,
    writeFromPath: async () => undefined,
  });

  await prepareApp();

  const adminEmail = `admin-${adminUserId}@daily-log-comment-attachments-test.local`;
  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Comment Attachments Admin",
    role: "admin",
  });

  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Comment Attachments Job",
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });

  await db.insert(dailyLogs).values({
    id: dailyLogId,
    jobId,
    logDate: "2025-05-01",
    title: "ZZZ Comment Attachments Log",
    notes: "comment-attachments seed",
    createdBy: adminUserId,
    shareInternalUsers: true,
  });

  adminToken = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Comment Attachments Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
  const { users, jobs, dailyLogs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  try {
    // Daily logs cascade-delete folders → files (and the comments JSON
    // lives on the comments row which cascades from the daily log too),
    // so deleting the seed daily log unwinds anything the upload route
    // wrote during the test.
    await db.delete(dailyLogs).where(eq(dailyLogs.id, dailyLogId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
    const storageMod = await import("../src/lib/storage.ts");
    storageMod.__storageWriteTesting.reset();
  }
});

function pngBlob(): Blob {
  return new Blob([tinyPngBytes], { type: "image/png" });
}

test("POST /daily-logs/:id/comment-attachments persists files and the resulting comment carries fileId/fileUrl", async () => {
  const form = new FormData();
  form.append("files", pngBlob(), "first.png");
  form.append("files", pngBlob(), "second.png");

  const uploadResponse = await fetch(
    `${baseUrl}/api/daily-logs/${dailyLogId}/comment-attachments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: form,
    },
  );

  const uploadText = await uploadResponse.text();
  assert.equal(
    uploadResponse.status,
    201,
    `multipart upload should succeed, got ${uploadResponse.status}: ${uploadText}`,
  );

  const uploadBody = JSON.parse(uploadText) as {
    files: Array<{
      id: string;
      originalName: string;
      mimeType: string | null;
      fileSize: number | null;
      fileUrl: string | null;
    }>;
  };

  assert.equal(uploadBody.files.length, 2);
  for (const file of uploadBody.files) {
    assert.match(file.id, /^[0-9a-fA-F-]{36}$/);
    assert.equal(file.mimeType, "image/png");
    assert.ok(file.fileUrl, "uploaded file row should have a fileUrl");
  }

  // Now post a comment that references those files via the new
  // `{fileId}` shape and confirm the server resolves them and persists
  // the new attachment record.
  const commentResponse = await fetch(
    `${baseUrl}/api/daily-logs/${dailyLogId}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        body: "with two attachments",
        attachments: uploadBody.files.map((f) => ({ fileId: f.id })),
      }),
    },
  );

  const commentText = await commentResponse.text();
  assert.equal(
    commentResponse.status,
    201,
    `comment POST should succeed, got ${commentResponse.status}: ${commentText}`,
  );

  const commentBody = JSON.parse(commentText) as {
    comments: Array<{
      body: string;
      attachments: Array<{
        name: string;
        url: string | null;
        mimeType: string | null;
        fileId: string | null;
        fileUrl: string | null;
      }>;
    }>;
  };

  const created = commentBody.comments.find((c) => c.body === "with two attachments");
  assert.ok(created, "the just-posted comment should appear in the response");
  assert.equal(created.attachments.length, 2);
  for (const attachment of created.attachments) {
    assert.ok(
      attachment.fileId,
      "new comment attachments should carry a fileId",
    );
    assert.ok(
      attachment.fileUrl,
      "new comment attachments should carry a fileUrl pointing at /uploads/...",
    );
    assert.equal(attachment.mimeType, "image/png");
  }
});

test("POST /daily-logs/:id/comments rejects unknown fileIds with 400", async () => {
  // A fileId that is well-formed but does not exist in the
  // comment-attachments folder for this daily log must be rejected so
  // attachments can't silently disappear or get spoofed.
  const fakeId = crypto.randomUUID();

  const response = await fetch(
    `${baseUrl}/api/daily-logs/${dailyLogId}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        body: "should not persist",
        attachments: [{ fileId: fakeId }],
      }),
    },
  );

  assert.equal(response.status, 400, await response.text());
});

test("POST /daily-logs/:id/comment-attachments rejects oversize uploads with 413 LIMIT_FILE_SIZE", async () => {
  // 11 MB exceeds the 10 MB per-attachment cap. Multer's global limit
  // fires LIMIT_FILE_SIZE which the problem-json mapper turns into 413.
  const oversize = Buffer.alloc(11 * 1024 * 1024, 0);
  const form = new FormData();
  form.append("files", new Blob([oversize], { type: "image/png" }), "huge.png");

  const response = await fetch(
    `${baseUrl}/api/daily-logs/${dailyLogId}/comment-attachments`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "X-Requested-With": "XMLHttpRequest" },
      body: form,
    },
  );

  const oversizeText = await response.text();
  assert.equal(response.status, 413, oversizeText);
  const body = JSON.parse(oversizeText) as {
    status: number;
    errors?: { code?: string };
  };
  assert.equal(body.errors?.code, "UPLOAD_TOO_LARGE");
  assert.equal(body.errors?.multerCode, "LIMIT_FILE_SIZE");
});

test("POST /daily-logs/:id/comment-attachments rejects too-many-files with a 4xx", async () => {
  // The route is configured with maxCount=10 AND limits.files=10. Sending
  // 11 PNG parts trips one of the two multer guards (LIMIT_FILE_COUNT or
  // LIMIT_UNEXPECTED_FILE depending on which counter saturates first).
  // Either is acceptable here; what matters is that the request is
  // rejected before any of the eleven files can be persisted.
  const form = new FormData();
  for (let i = 0; i < 11; i += 1) {
    form.append("files", pngBlob(), `f${i}.png`);
  }

  const response = await fetch(
    `${baseUrl}/api/daily-logs/${dailyLogId}/comment-attachments`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "X-Requested-With": "XMLHttpRequest" },
      body: form,
    },
  );

  assert.ok(
    response.status === 400 || response.status === 413,
    `expected 400 or 413, got ${response.status}`,
  );
  const body = (await response.json()) as {
    errors?: { code?: string };
  };
  assert.ok(
    body.errors?.code === "LIMIT_UNEXPECTED_FILE" ||
      body.errors?.code === "UPLOAD_TOO_MANY_FILES",
    `expected LIMIT_UNEXPECTED_FILE or LIMIT_FILE_COUNT, got ${body.errors?.code}`,
  );
});
