import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
const PDF_BYTES = Buffer.from("%PDF-1.4\n%\xC4\xE5\xF2\xE5\xEB\xA7\n%%EOF\n", "binary");
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;
let localStorageRoot: string;

const adminUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@upload-migration-api.local`;

function jsonHeaders() {
  return {
    authorization: `Bearer ${adminAccessJwt}`,
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

function authHeaders(extra?: Record<string, string>) {
  return {
    authorization: `Bearer ${adminAccessJwt}`,
    "x-requested-with": "XMLHttpRequest",
    ...extra,
  };
}

async function assertProblemCode(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
  const body = (await response.json()) as {
    type: string;
    errors?: { code?: string; [key: string]: unknown };
  };
  assert.equal(body.errors?.code, code);
  return body;
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://stub.invalid";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key";
  process.env.CADSTONE_STORAGE_BACKEND = "local";
  localStorageRoot = await mkdtemp(path.join(os.tmpdir(), "cadstone-upload-migration-"));
  process.env.CADSTONE_LOCAL_STORAGE_ROOT = localStorageRoot;

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { jobs, users } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Upload Migration Admin",
    role: "admin",
  });
  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Upload Migration Job",
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });

  const stamp = new Date();
  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Upload Migration Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
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
  const { activityLog, jobs, users } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    await db.delete(activityLog).where(eq(activityLog.userId, adminUserId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(users).where(inArray(users.id, [adminUserId]));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
    if (localStorageRoot) {
      await rm(localStorageRoot, { recursive: true, force: true });
    }
  }
});

test("folder tree seeds migration folders and resolves numeric path aliases", async () => {
  const treeResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folder-tree?mediaType=document`, {
    headers: authHeaders(),
  });
  assert.equal(treeResponse.status, 200);
  const tree = (await treeResponse.json()) as {
    folders: Array<{ id: string; title: string; path: string; normalizedTitle: string }>;
  };

  assert.ok(tree.folders.some((folder) => folder.title === "01. PLANS"));
  assert.ok(tree.folders.some((folder) => folder.title === "11. SHOP DRAWINGS"));
  assert.ok(tree.folders.some((folder) => folder.title === "Pre-Sale Documents"));

  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "document",
      path: "1. PLANS",
    }),
  });
  assert.equal(resolveResponse.status, 200);
  const resolved = (await resolveResponse.json()) as {
    folder: { id: string; title: string; path: string };
    matchedBy: string;
  };
  assert.equal(resolved.folder.title, "01. PLANS");
  assert.equal(resolved.matchedBy, "normalized");

  const createResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "document",
      path: "Agent Migration/Batch 01",
      createIfMissing: true,
    }),
  });
  assert.equal(createResponse.status, 200);
  const created = (await createResponse.json()) as {
    folder: { title: string; path: string };
    createdFolders: Array<{ id: string }>;
  };
  assert.equal(created.folder.title, "Batch 01");
  assert.equal(created.folder.path, "Agent Migration/Batch 01");
  assert.equal(created.createdFolders.length, 2);
});

test("photo and video folder resolver creates nested media folders and accepts uploads", async () => {
  const photoResolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "photo",
      path: "10. PICTURES/OpenClaw Test Photo Folder",
      createIfMissing: true,
    }),
  });
  assert.equal(photoResolveResponse.status, 200);
  const photoResolved = (await photoResolveResponse.json()) as {
    folder: { id: string; title: string; mediaType: string; path: string };
    breadcrumb: Array<{ id: string; title: string; mediaType: string }>;
    createdFolders: Array<{ id: string; title: string; mediaType: string }>;
    matchedBy: string;
    requestedPath: string;
  };
  assert.equal(photoResolved.folder.title, "OpenClaw Test Photo Folder");
  assert.equal(photoResolved.folder.mediaType, "photo");
  assert.equal(photoResolved.folder.path, "10. PICTURES/OpenClaw Test Photo Folder");
  assert.equal(photoResolved.breadcrumb.map((folder) => folder.title).join("/"), photoResolved.folder.path);
  assert.equal(photoResolved.createdFolders.length, 1);
  assert.equal(photoResolved.createdFolders[0]?.mediaType, "photo");
  assert.equal(photoResolved.matchedBy, "created");
  assert.equal(photoResolved.requestedPath, "10. PICTURES/OpenClaw Test Photo Folder");

  const photoChildListResponse = await fetch(
    `${baseUrl}/api/jobs/${jobId}/folders?mediaType=photo&parentId=${photoResolved.breadcrumb[0]?.id}`,
    { headers: authHeaders() },
  );
  assert.equal(photoChildListResponse.status, 200);
  const photoChildList = (await photoChildListResponse.json()) as {
    folders: Array<{ id: string; title: string; mediaType: string; path: string }>;
  };
  assert.ok(
    photoChildList.folders.some((folder) =>
      folder.id === photoResolved.folder.id &&
      folder.mediaType === "photo" &&
      folder.path === "10. PICTURES/OpenClaw Test Photo Folder"
    ),
  );

  const photoUploadForm = new FormData();
  photoUploadForm.append("files", new Blob([PDF_BYTES], { type: "application/pdf" }), "openclaw-test-photo-import.pdf");
  const photoUploadResponse = await fetch(`${baseUrl}/api/folders/${photoResolved.folder.id}/files`, {
    method: "POST",
    headers: authHeaders(),
    body: photoUploadForm,
  });
  assert.equal(photoUploadResponse.status, 201);
  const photoUploadBody = (await photoUploadResponse.json()) as {
    folder: { id: string; mediaType: string };
    files: Array<{ id: string; folderId: string; originalName: string }>;
    uploadResults: Array<{ status: string }>;
  };
  assert.equal(photoUploadBody.folder.mediaType, "photo");
  assert.equal(photoUploadBody.files.length, 1);
  assert.equal(photoUploadBody.files[0]?.folderId, photoResolved.folder.id);
  assert.equal(photoUploadBody.files[0]?.originalName, "openclaw-test-photo-import.pdf");
  assert.equal(photoUploadBody.uploadResults[0]?.status, "uploaded");

  const videoResolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "video",
      path: "Global Videos/OpenClaw Test Video Folder",
      createIfMissing: true,
    }),
  });
  assert.equal(videoResolveResponse.status, 200);
  const videoResolved = (await videoResolveResponse.json()) as {
    folder: { title: string; mediaType: string; path: string };
    createdFolders: Array<{ title: string; mediaType: string }>;
  };
  assert.equal(videoResolved.folder.title, "OpenClaw Test Video Folder");
  assert.equal(videoResolved.folder.mediaType, "video");
  assert.equal(videoResolved.folder.path, "Global Videos/OpenClaw Test Video Folder");
  assert.equal(videoResolved.createdFolders.length, 1);
  assert.equal(videoResolved.createdFolders[0]?.mediaType, "video");
});

test("path upload creates nested photo folders and stores files in the resolved destination", async () => {
  const form = new FormData();
  form.append("mediaType", "photo");
  form.append("folderPath", "10. PICTURES/OpenClaw Zip Tree/Nested Leaf");
  form.append("createIfMissing", "true");
  form.append("files", new Blob([PDF_BYTES], { type: "application/pdf" }), "zip-tree-photo-import.pdf");

  const response = await fetch(`${baseUrl}/api/jobs/${jobId}/files/by-path`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    folder: { mediaType: string };
    files: Array<{ folderId: string; originalName: string }>;
    resolvedFolder: {
      folder: { id: string; mediaType: string; path: string };
      createdFolders: Array<{ title: string; mediaType: string }>;
    };
    uploadResults: Array<{ status: string }>;
  };
  assert.equal(body.resolvedFolder.folder.mediaType, "photo");
  assert.equal(body.resolvedFolder.folder.path, "10. PICTURES/OpenClaw Zip Tree/Nested Leaf");
  assert.equal(body.folder.mediaType, "photo");
  assert.equal(body.resolvedFolder.createdFolders.length, 2);
  assert.deepEqual(
    body.resolvedFolder.createdFolders.map((folder) => [folder.title, folder.mediaType]),
    [
      ["OpenClaw Zip Tree", "photo"],
      ["Nested Leaf", "photo"],
    ],
  );
  assert.equal(body.files.length, 1);
  assert.equal(body.files[0]?.folderId, body.resolvedFolder.folder.id);
  assert.equal(body.files[0]?.originalName, "zip-tree-photo-import.pdf");
  assert.equal(body.uploadResults[0]?.status, "uploaded");
});

test("state-changing requests without the CSRF header return a structured reason", async () => {
  const response = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ mediaType: "photo", path: "CSRF Check", createIfMissing: true }),
  });

  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
  const body = (await response.json()) as {
    type: string;
    errors: { code: string; header: string; retryable: boolean };
  };
  assert.match(body.type, /\/csrf$/);
  assert.equal(body.errors.code, "CSRF_HEADER_REQUIRED");
  assert.equal(body.errors.header, "X-Requested-With");
  assert.equal(body.errors.retryable, true);
});

test("chunked upload start, chunk, and complete report structured CSRF failures", async () => {
  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "photo",
      path: "Anwar 403 Regression/Chunked CSRF Stage Check",
      createIfMissing: true,
    }),
  });
  assert.equal(resolveResponse.status, 200);
  const resolved = (await resolveResponse.json()) as { folder: { id: string } };

  const headerlessStart = await fetch(`${baseUrl}/api/folders/${resolved.folder.id}/files/chunked`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      originalName: "csrf-stage.jpg",
      mimeType: "image/jpeg",
      totalSize: JPEG_BYTES.length,
      totalChunks: 1,
    }),
  });
  await assertProblemCode(headerlessStart, 403, "CSRF_HEADER_REQUIRED");

  const startResponse = await fetch(`${baseUrl}/api/folders/${resolved.folder.id}/files/chunked`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      originalName: "csrf-stage.jpg",
      mimeType: "image/jpeg",
      totalSize: JPEG_BYTES.length,
      totalChunks: 1,
    }),
  });
  assert.equal(startResponse.status, 201);
  const start = (await startResponse.json()) as { session: { uploadId: string } };

  const headerlessChunk = await fetch(
    `${baseUrl}/api/folders/${resolved.folder.id}/files/chunked/${start.session.uploadId}/chunks/0`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${adminAccessJwt}`,
        "content-type": "application/octet-stream",
      },
      body: JPEG_BYTES,
    },
  );
  await assertProblemCode(headerlessChunk, 403, "CSRF_HEADER_REQUIRED");

  const headerlessComplete = await fetch(
    `${baseUrl}/api/folders/${resolved.folder.id}/files/chunked/${start.session.uploadId}/complete`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminAccessJwt}` },
    },
  );
  await assertProblemCode(headerlessComplete, 403, "CSRF_HEADER_REQUIRED");
});

test("photo upload accepts Anwar report filenames and folders without normalization", async () => {
  const examples = [
    { folderPath: "Anwar 403 Regression/Guest house", fileName: "20251203_085058.jpg" },
    { folderPath: "Anwar 403 Regression/15th", fileName: "20250617_080747.jpg" },
    { folderPath: "Anwar 403 Regression/BATH#4", fileName: "20260316_133406.jpg" },
    { folderPath: "Anwar 403 Regression/Primer nivel", fileName: "20260220_093040.jpg" },
    { folderPath: "Anwar 403 Regression/Exterior floor", fileName: "20260309_143038.jpg" },
  ];

  for (const example of examples) {
    const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        mediaType: "photo",
        path: example.folderPath,
        createIfMissing: true,
      }),
    });
    assert.equal(resolveResponse.status, 200);
    const resolved = (await resolveResponse.json()) as {
      folder: { id: string; mediaType: string; path: string };
    };
    assert.equal(resolved.folder.mediaType, "photo");

    const form = new FormData();
    form.append("files", new Blob([JPEG_BYTES], { type: "image/jpeg" }), example.fileName);
    const uploadResponse = await fetch(`${baseUrl}/api/folders/${resolved.folder.id}/files`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    assert.equal(uploadResponse.status, 201, `${example.folderPath}/${example.fileName}`);
    const uploadBody = (await uploadResponse.json()) as {
      files: Array<{ originalName: string; mimeType: string | null }>;
      uploadResults: Array<{ status: string }>;
    };
    assert.equal(uploadBody.files[0]?.originalName, example.fileName);
    assert.equal(uploadBody.files[0]?.mimeType, "image/jpeg");
    assert.equal(uploadBody.uploadResults[0]?.status, "uploaded");
  }
});

test("photo upload can retry the same JPEG through the chunked path", async () => {
  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "photo",
      path: "Anwar 403 Regression/Chunked Retry",
      createIfMissing: true,
    }),
  });
  assert.equal(resolveResponse.status, 200);
  const resolved = (await resolveResponse.json()) as { folder: { id: string } };
  const checksum = crypto.createHash("sha256").update(JPEG_BYTES).digest("hex");

  const startResponse = await fetch(`${baseUrl}/api/folders/${resolved.folder.id}/files/chunked`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      originalName: "20260316_133406.jpg",
      mimeType: "image/jpeg",
      totalSize: JPEG_BYTES.length,
      totalChunks: 2,
      contentHash: checksum,
    }),
  });
  assert.equal(startResponse.status, 201);
  const start = (await startResponse.json()) as { session: { uploadId: string } };
  const chunks = [JPEG_BYTES.subarray(0, 8), JPEG_BYTES.subarray(8)];

  for (const [index, chunk] of chunks.entries()) {
    const chunkResponse = await fetch(
      `${baseUrl}/api/folders/${resolved.folder.id}/files/chunked/${start.session.uploadId}/chunks/${index}`,
      {
        method: "PUT",
        headers: authHeaders({ "content-type": "application/octet-stream" }),
        body: chunk,
      },
    );
    assert.equal(chunkResponse.status, 200);
  }

  const completeResponse = await fetch(
    `${baseUrl}/api/folders/${resolved.folder.id}/files/chunked/${start.session.uploadId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(),
    },
  );
  assert.equal(completeResponse.status, 201);
  const complete = (await completeResponse.json()) as {
    status: string;
    files: Array<{ originalName: string; mimeType: string | null; contentHash: string | null }>;
  };
  assert.equal(complete.status, "uploaded");
  assert.equal(complete.files[0]?.originalName, "20260316_133406.jpg");
  assert.equal(complete.files[0]?.mimeType, "image/jpeg");
  assert.equal(complete.files[0]?.contentHash, checksum);
});

test("photo upload can send chunks as base64 text to avoid raw binary edge rejection", async () => {
  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "photo",
      path: "Anwar 403 Regression/Base64 Chunk Retry",
      createIfMissing: true,
    }),
  });
  assert.equal(resolveResponse.status, 200);
  const resolved = (await resolveResponse.json()) as { folder: { id: string } };
  const checksum = crypto.createHash("sha256").update(JPEG_BYTES).digest("hex");

  const startResponse = await fetch(`${baseUrl}/api/folders/${resolved.folder.id}/files/chunked`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      originalName: "20251203_085058.jpg",
      mimeType: "image/jpeg",
      totalSize: JPEG_BYTES.length,
      totalChunks: 2,
      contentHash: checksum,
    }),
  });
  assert.equal(startResponse.status, 201);
  const start = (await startResponse.json()) as { session: { uploadId: string } };
  const chunks = [JPEG_BYTES.subarray(0, 8), JPEG_BYTES.subarray(8)];

  for (const [index, chunk] of chunks.entries()) {
    const chunkResponse = await fetch(
      `${baseUrl}/api/folders/${resolved.folder.id}/files/chunked/${start.session.uploadId}/chunks/${index}`,
      {
        method: "PUT",
        headers: authHeaders({ "content-type": "text/plain" }),
        body: chunk.toString("base64"),
      },
    );
    assert.equal(chunkResponse.status, 200);
    const chunkBody = (await chunkResponse.json()) as { transport?: string; checksum: string };
    assert.equal(chunkBody.transport, "base64");
    assert.equal(chunkBody.checksum, crypto.createHash("sha256").update(chunk).digest("hex"));
  }

  const completeResponse = await fetch(
    `${baseUrl}/api/folders/${resolved.folder.id}/files/chunked/${start.session.uploadId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(),
    },
  );
  assert.equal(completeResponse.status, 201);
  const complete = (await completeResponse.json()) as {
    status: string;
    files: Array<{ originalName: string; mimeType: string | null; contentHash: string | null }>;
  };
  assert.equal(complete.status, "uploaded");
  assert.equal(complete.files[0]?.originalName, "20251203_085058.jpg");
  assert.equal(complete.files[0]?.mimeType, "image/jpeg");
  assert.equal(complete.files[0]?.contentHash, checksum);
});

test("base64 chunk uploads return structured validation errors for malformed bodies", async () => {
  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      mediaType: "photo",
      path: "Anwar 403 Regression/Base64 Invalid",
      createIfMissing: true,
    }),
  });
  assert.equal(resolveResponse.status, 200);
  const resolved = (await resolveResponse.json()) as { folder: { id: string } };

  const startResponse = await fetch(`${baseUrl}/api/folders/${resolved.folder.id}/files/chunked`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      originalName: "bad-base64.jpg",
      mimeType: "image/jpeg",
      totalSize: JPEG_BYTES.length,
      totalChunks: 1,
    }),
  });
  assert.equal(startResponse.status, 201);
  const start = (await startResponse.json()) as { session: { uploadId: string } };

  const invalidChunk = await fetch(
    `${baseUrl}/api/folders/${resolved.folder.id}/files/chunked/${start.session.uploadId}/chunks/0`,
    {
      method: "PUT",
      headers: authHeaders({ "content-type": "text/plain" }),
      body: "not-valid-base64!@#",
    },
  );
  await assertProblemCode(invalidChunk, 400, "INVALID_BASE64_CHUNK");
});

test("duplicate preflight distinguishes exact matches and skip_exact clears the upload", async () => {
  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ mediaType: "document", path: "1. PLANS" }),
  });
  const resolved = (await resolveResponse.json()) as { folder: { id: string } };
  const folderId = resolved.folder.id;

  const form = new FormData();
  form.append("files", new Blob([PDF_BYTES], { type: "application/pdf" }), "same.pdf");
  const firstUpload = await fetch(`${baseUrl}/api/folders/${folderId}/files`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  assert.equal(firstUpload.status, 201);
  const firstBody = (await firstUpload.json()) as {
    files: Array<{ id: string; contentHash: string | null }>;
    uploadResults: Array<{ duplicate: { status: string } }>;
  };
  assert.equal(firstBody.files.length, 1);
  assert.equal(firstBody.uploadResults[0]?.duplicate.status, "none");

  const checksum = crypto.createHash("sha256").update(PDF_BYTES).digest("hex");
  assert.equal(firstBody.files[0]?.contentHash, checksum);

  const duplicateResponse = await fetch(
    `${baseUrl}/api/folders/${folderId}/files/duplicates?filename=${encodeURIComponent("same.pdf")}&size=${PDF_BYTES.length}&checksum=${checksum}`,
    { headers: authHeaders() },
  );
  assert.equal(duplicateResponse.status, 200);
  const duplicateBody = (await duplicateResponse.json()) as {
    duplicate: { status: string; matches: Array<{ id: string }> };
  };
  assert.equal(duplicateBody.duplicate.status, "already_exists_exact_match");
  assert.equal(duplicateBody.duplicate.matches.length, 1);

  const skipForm = new FormData();
  skipForm.append("files", new Blob([PDF_BYTES], { type: "application/pdf" }), "same.pdf");
  skipForm.append("duplicateAction", "skip_exact");
  const skippedUpload = await fetch(`${baseUrl}/api/folders/${folderId}/files`, {
    method: "POST",
    headers: authHeaders(),
    body: skipForm,
  });
  assert.equal(skippedUpload.status, 201);
  const skippedBody = (await skippedUpload.json()) as {
    files: unknown[];
    uploadResults: Array<{ status: string; duplicate: { status: string } }>;
  };
  assert.equal(skippedBody.files.length, 0);
  assert.equal(skippedBody.uploadResults[0]?.status, "skipped_exact_duplicate");
  assert.equal(skippedBody.uploadResults[0]?.duplicate.status, "already_exists_exact_match");
});

test("chunked upload assembles, validates, and persists a large-file session", async () => {
  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ mediaType: "document", path: "11. SHOP DRAWINGS" }),
  });
  const resolved = (await resolveResponse.json()) as { folder: { id: string } };
  const folderId = resolved.folder.id;
  const checksum = crypto.createHash("sha256").update(PDF_BYTES).digest("hex");

  const startResponse = await fetch(`${baseUrl}/api/folders/${folderId}/files/chunked`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      originalName: "chunked.pdf",
      mimeType: "application/pdf",
      totalSize: PDF_BYTES.length,
      totalChunks: 2,
      contentHash: checksum,
    }),
  });
  assert.equal(startResponse.status, 201);
  const startBody = (await startResponse.json()) as { session: { uploadId: string } };
  const uploadId = startBody.session.uploadId;

  const chunks = [PDF_BYTES.subarray(0, 12), PDF_BYTES.subarray(12)];
  for (const [index, chunk] of chunks.entries()) {
    const chunkResponse = await fetch(
      `${baseUrl}/api/folders/${folderId}/files/chunked/${uploadId}/chunks/${index}`,
      {
        method: "PUT",
        headers: authHeaders({ "content-type": "application/octet-stream" }),
        body: chunk,
      },
    );
    assert.equal(chunkResponse.status, 200);
  }

  const completeResponse = await fetch(
    `${baseUrl}/api/folders/${folderId}/files/chunked/${uploadId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(),
    },
  );
  assert.equal(completeResponse.status, 201);
  const completeBody = (await completeResponse.json()) as {
    status: string;
    files: Array<{ originalName: string; contentHash: string | null }>;
  };
  assert.equal(completeBody.status, "uploaded");
  assert.equal(completeBody.files[0]?.originalName, "chunked.pdf");
  assert.equal(completeBody.files[0]?.contentHash, checksum);
});

test("chunked upload start rejects impossible chunk counts", async () => {
  const resolveResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/folders/resolve`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ mediaType: "document", path: "11. SHOP DRAWINGS" }),
  });
  const resolved = (await resolveResponse.json()) as { folder: { id: string } };
  const folderId = resolved.folder.id;

  const previousMaxChunk = process.env.CADSTONE_CHUNKED_UPLOAD_MAX_CHUNK_BYTES;
  process.env.CADSTONE_CHUNKED_UPLOAD_MAX_CHUNK_BYTES = "10";

  try {
    const tooFewChunks = await fetch(`${baseUrl}/api/folders/${folderId}/files/chunked`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        originalName: "impossible.pdf",
        mimeType: "application/pdf",
        totalSize: PDF_BYTES.length,
        totalChunks: 1,
      }),
    });
    assert.equal(tooFewChunks.status, 400);
    const tooFewBody = (await tooFewChunks.json()) as {
      errors: { code: string; minimumChunks: number };
    };
    assert.equal(tooFewBody.errors.code, "INVALID_TOTAL_CHUNKS");
    assert.equal(tooFewBody.errors.minimumChunks, Math.ceil(PDF_BYTES.length / 10));

    const tooManyChunks = await fetch(`${baseUrl}/api/folders/${folderId}/files/chunked`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        originalName: "impossible.pdf",
        mimeType: "application/pdf",
        totalSize: 1,
        totalChunks: 2,
      }),
    });
    assert.equal(tooManyChunks.status, 400);
    const tooManyBody = (await tooManyChunks.json()) as {
      errors: { code: string; maximumChunks: number };
    };
    assert.equal(tooManyBody.errors.code, "INVALID_TOTAL_CHUNKS");
    assert.equal(tooManyBody.errors.maximumChunks, 1);
  } finally {
    if (previousMaxChunk === undefined) {
      delete process.env.CADSTONE_CHUNKED_UPLOAD_MAX_CHUNK_BYTES;
    } else {
      process.env.CADSTONE_CHUNKED_UPLOAD_MAX_CHUNK_BYTES = previousMaxChunk;
    }
  }
});
