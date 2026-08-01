import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
const realFetch = globalThis.fetch;

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
let validAccessToken: string;
let validViewToken: string;
let expiredViewToken: string;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-key";
  // Pin the access secret so the expired-token test can hand-craft a
  // file_view JWT with the same secret the route's verifier uses.
  process.env.JWT_ACCESS_SECRET = "signed-link-reuse-access-secret";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const storage = await import("../src/lib/storage.ts");
  const { db } = await import("@workspace/db");
  const { clients, files, folders, jobs, users } = await import("@workspace/db/schema");

  await prepareApp();

  // Replace storage streaming with an in-process stub so the success path
  // does not require object storage. The route must still pass token
  // verification, user lookup, and authorization to reach this stub.
  storage.__streamStoredFileTesting.setImpl(async (res, _url, opts) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${opts.disposition}; filename="${opts.filename}"`);
    if (opts.cacheControl) {
      res.setHeader("Cache-Control", opts.cacheControl);
    }
    res.status(200).end(filePayload);
    return { bytesStreamed: filePayload.length, aborted: false };
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

  validAccessToken = auth.signAccessToken(adminPublicUser);
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
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.equal(second.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(firstBody, filePayload);
  assert.deepEqual(secondBody, filePayload);
});

test("authenticated users can mint a signed download URL", async () => {
  const response = await fetch(`${baseUrl}/api/files/${fileId}/signed-download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${validAccessToken}`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const body = (await response.json()) as { url?: unknown; expiresIn?: unknown };

  assert.equal(response.status, 200);
  assert.equal(body.expiresIn, 5 * 60);
  assert.equal(typeof body.url, "string");
  assert.match(body.url, new RegExp(`^/api/files/${fileId}/download-signed\\?token=`));
});

test("Supabase signed and unsigned downloads use first-party native streaming", async () => {
  const storage = await import("../src/lib/storage.ts");
  const { db } = await import("@workspace/db");
  const { files } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const unicodeName = "608 Radcliffe – ’plans’.zip";
  const providerRequests: Array<{ method: string; url: URL }> = [];
  const previousEnv = new Map(
    [
      "CADSTONE_STORAGE_BACKEND",
      "SUPABASE_URL",
      "SUPABASE_STORAGE_BUCKET",
      "SUPABASE_SERVICE_ROLE_KEY",
    ].map((name) => [name, process.env[name]] as const),
  );
  process.env.CADSTONE_STORAGE_BACKEND = "supabase";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_STORAGE_BUCKET = "cadstone-files";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  storage.__storageWriteTesting.reset();
  storage.__streamStoredFileTesting.reset();
  await db
    .update(files)
    .set({ originalName: unicodeName })
    .where(eq(files.id, fileId));

  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === new URL(baseUrl).origin) {
      return realFetch(input, init);
    }

    const method = init?.method ?? "GET";
    providerRequests.push({ method, url });
    assert.equal(url.origin, "https://example.supabase.co");
    assert.equal(method, "GET");
    assert.match(
      decodeURIComponent(url.pathname),
      new RegExp(`/storage/v1/object/cadstone-files/slabplan${fileUrl}$`),
    );
    return new Response(filePayload, {
      status: 200,
      headers: {
        "content-length": String(filePayload.length),
        "content-type": "application/pdf",
      },
    });
  }) as typeof fetch;

  try {
    const viewMinted = await realFetch(`${baseUrl}/api/files/${fileId}/signed-view`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validAccessToken}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const viewBody = (await viewMinted.json()) as {
      delivery?: unknown;
      url?: unknown;
    };
    assert.equal(viewMinted.status, 200);
    assert.equal(viewBody.delivery, "application");
    assert.match(
      viewBody.url as string,
      new RegExp(`^/api/files/${fileId}/view-signed\\?token=`),
    );

    const minted = await realFetch(`${baseUrl}/api/files/${fileId}/signed-download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validAccessToken}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const mintBody = (await minted.json()) as {
      delivery?: unknown;
      url?: unknown;
    };

    assert.equal(minted.status, 200);
    assert.equal(mintBody.delivery, "application");
    assert.equal(typeof mintBody.url, "string");
    assert.match(
      mintBody.url as string,
      new RegExp(`^/api/files/${fileId}/download-signed\\?token=`),
    );
    assert.equal((mintBody.url as string).includes("supabase.co"), false);

    const downloaded = await realFetch(new URL(mintBody.url as string, baseUrl));
    const bytes = Buffer.from(await downloaded.arrayBuffer());

    assert.equal(downloaded.status, 200);
    assert.deepEqual(bytes, filePayload);
    assert.match(downloaded.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.match(
      downloaded.headers.get("content-disposition") ?? "",
      /filename="608 Radcliffe _ _plans_\.zip"/,
    );
    const extendedName = /filename\*=UTF-8''([^;]*)/.exec(
      downloaded.headers.get("content-disposition") ?? "",
    )?.[1];
    assert.ok(extendedName);
    assert.equal(decodeURIComponent(extendedName), unicodeName);
    assert.equal(downloaded.headers.get("content-length"), null);
    assert.equal(downloaded.headers.get("transfer-encoding"), "chunked");
    assert.equal(providerRequests.length, 2);

    storage.__storageWriteTesting.reset();
    const unsigned = await realFetch(`${baseUrl}/api/files/${fileId}/download`, {
      headers: {
        Authorization: `Bearer ${validAccessToken}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const unsignedBytes = Buffer.from(await unsigned.arrayBuffer());

    assert.equal(unsigned.status, 200);
    assert.deepEqual(unsignedBytes, filePayload);
    assert.match(unsigned.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(unsigned.headers.get("content-length"), null);
    assert.equal(unsigned.headers.get("transfer-encoding"), "chunked");
    assert.equal(
      providerRequests.length,
      4,
      "the unsigned route must inspect and then stream the native object",
    );
    assert.equal(
      providerRequests.some((request) =>
        ["POST", "PATCH", "DELETE"].includes(request.method),
      ),
      false,
      "native delivery must not mutate or delete provider data",
    );
  } finally {
    globalThis.fetch = realFetch;
    await db
      .update(files)
      .set({ originalName: "signed-link-reuse.pdf" })
      .where(eq(files.id, fileId));
    for (const [name, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    storage.__storageWriteTesting.reset();
    storage.__streamStoredFileTesting.setImpl(async (res, _url, opts) => {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${opts.disposition}; filename="${opts.filename}"`);
      if (opts.cacheControl) {
        res.setHeader("Cache-Control", opts.cacheControl);
      }
      res.status(200).end(filePayload);
      return { bytesStreamed: filePayload.length, aborted: false };
    });
  }
});

test("signed first click streams an unmaterialized manifest while native copy builds in background", async () => {
  const storage = await import("../src/lib/storage.ts");
  const payload = Buffer.from("signed-manifest-first-click-payload");
  const manifest = {
    version: 1,
    kind: "cadstone-supabase-multipart",
    totalBytes: payload.length,
    contentType: "application/pdf",
    parts: [
      {
        index: 0,
        fileUrl: `${fileUrl}.parts/000000`,
        size: payload.length,
      },
    ],
  };
  const previousEnv = new Map(
    [
      "CADSTONE_STORAGE_BACKEND",
      "SUPABASE_URL",
      "SUPABASE_STORAGE_BUCKET",
      "SUPABASE_SERVICE_ROLE_KEY",
    ].map((name) => [name, process.env[name]] as const),
  );
  process.env.CADSTONE_STORAGE_BACKEND = "supabase";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_STORAGE_BUCKET = "cadstone-files";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  storage.__storageWriteTesting.reset();
  storage.__streamStoredFileTesting.reset();

  let materialized = false;
  const providerRequests: Array<{ method: string; path: string }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === new URL(baseUrl).origin) {
      return realFetch(input, init);
    }

    const method = init?.method ?? "GET";
    const decodedPath = decodeURIComponent(url.pathname);
    providerRequests.push({ method, path: decodedPath });
    if (
      method === "GET" &&
      url.pathname === "/storage/v1/bucket/cadstone-files"
    ) {
      return new Response(
        JSON.stringify({
          id: "cadstone-files",
          name: "cadstone-files",
          public: false,
          file_size_limit: 2 * 1024 * 1024 * 1024,
        }),
        { status: 200 },
      );
    }

    const objectPrefix = "/storage/v1/object/cadstone-files/";
    if (method === "GET" && url.pathname.startsWith(objectPrefix)) {
      const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
      const sourceKey = `slabplan${fileUrl}`;
      if (key === sourceKey) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: {
            "content-type":
              "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
          },
        });
      }
      if (key === `${sourceKey}.parts/000000`) {
        return new Response(payload, {
          status: 200,
          headers: { "content-length": String(payload.length) },
        });
      }
      if (key === `${sourceKey}.cadstone-native`) {
        if (!materialized) return new Response(null, { status: 404 });
        const range = new Headers(init?.headers).get("range");
        if (range === "bytes=0-0") {
          return new Response(payload.subarray(0, 1), {
            status: 206,
            headers: {
              "content-length": "1",
              "content-range": `bytes 0-0/${payload.length}`,
            },
          });
        }
        return new Response(payload, {
          status: 200,
          headers: { "content-length": String(payload.length) },
        });
      }
    }
    if (method === "POST" && url.pathname === "/storage/v1/upload/resumable") {
      return new Response(null, {
        status: 201,
        headers: { location: "/storage/v1/upload/resumable/signed-manifest" },
      });
    }
    if (method === "PATCH" && url.pathname.endsWith("/signed-manifest")) {
      materialized = true;
      return new Response(null, {
        status: 204,
        headers: { "upload-offset": String(payload.length) },
      });
    }
    throw new Error(`Unexpected provider request: ${method} ${url.href}`);
  }) as typeof fetch;

  try {
    const signedUrl = `${baseUrl}/api/files/${fileId}/download-signed?token=${encodeURIComponent(validViewToken)}`;
    const first = await realFetch(signedUrl);
    const firstBytes = Buffer.from(await first.arrayBuffer());

    assert.equal(first.status, 200);
    assert.deepEqual(firstBytes, payload);
    assert.equal(first.headers.get("content-length"), null);
    assert.equal(first.headers.get("transfer-encoding"), "chunked");
    await storage.__storageWriteTesting.waitForNativeMaterialization(fileUrl);

    const second = await realFetch(signedUrl);
    assert.equal(second.status, 200);
    assert.deepEqual(Buffer.from(await second.arrayBuffer()), payload);
    assert.equal(
      providerRequests.filter((request) => request.method === "POST").length,
      1,
    );
    assert.equal(
      providerRequests.filter((request) =>
        request.path.includes(".parts/000000"),
      ).length,
      2,
      "first-click delivery and background materialization each read the source part once",
    );
    assert.equal(
      providerRequests.filter((request) => request.method === "DELETE").length,
      0,
    );
  } finally {
    await storage.__storageWriteTesting
      .waitForNativeMaterialization(fileUrl)
      .catch(() => undefined);
    globalThis.fetch = realFetch;
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    storage.__storageWriteTesting.reset();
    storage.__streamStoredFileTesting.setImpl(async (res, _url, opts) => {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${opts.disposition}; filename="${opts.filename}"`,
      );
      if (opts.cacheControl) res.setHeader("Cache-Control", opts.cacheControl);
      res.status(200).end(filePayload);
      return { bytesStreamed: filePayload.length, aborted: false };
    });
  }
});

test("authorized users can mint a fresh short-lived download URL for every click", async () => {
  async function mintDownloadUrl() {
    const response = await fetch(`${baseUrl}/api/files/${fileId}/signed-download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validAccessToken}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const body = (await response.json()) as { url?: unknown; expiresIn?: unknown };

    assert.equal(response.status, 200);
    assert.equal(body.expiresIn, 5 * 60);
    assert.equal(typeof body.url, "string");

    return body.url;
  }

  const firstUrl = await mintDownloadUrl();
  const secondUrl = await mintDownloadUrl();

  assert.notEqual(firstUrl, secondUrl, "each click should receive a fresh signed URL");
  assert.match(firstUrl, new RegExp(`^/api/files/${fileId}/download-signed\\?token=`));
  assert.match(secondUrl, new RegExp(`^/api/files/${fileId}/download-signed\\?token=`));
});

test("signed file download token serves the file as an attachment", async () => {
  const url = `${baseUrl}/api/files/${fileId}/download-signed?token=${encodeURIComponent(validViewToken)}`;

  const response = await fetch(url);
  const body = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.deepEqual(body, filePayload);
});

test("signed file browser routes return a readable page when storage fails before headers", async () => {
  const storage = await import("../src/lib/storage.ts");
  storage.__streamStoredFileTesting.setImpl(async () => {
    throw new Error("storage read failed before response headers");
  });

  try {
    const url = `${baseUrl}/api/files/${fileId}/download-signed?token=${encodeURIComponent(validViewToken)}`;
    const response = await fetch(url);
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(body, /File temporarily unavailable/);
    assert.match(body, /Please refresh and try again/);
    assert.match(body, /Reference:\s*<code>[\w.-]+<\/code>/);
  } finally {
    storage.__streamStoredFileTesting.setImpl(async (res, _url, opts) => {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${opts.disposition}; filename="${opts.filename}"`);
      if (opts.cacheControl) {
        res.setHeader("Cache-Control", opts.cacheControl);
      }
      res.status(200).end(filePayload);
      return { bytesStreamed: filePayload.length, aborted: false };
    });
  }
});

test("signed file-view token is rejected once its TTL elapses", async () => {
  const response = await fetch(
    `${baseUrl}/api/files/${fileId}/view-signed?token=${encodeURIComponent(expiredViewToken)}`,
  );

  assert.equal(response.status, 401);
});
