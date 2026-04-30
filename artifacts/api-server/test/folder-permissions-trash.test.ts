import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;
let pmAccessJwt: string;
let workerAccessJwt: string;

const adminUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const workerUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const noUploadParentId = crypto.randomUUID();
const writableParentId = crypto.randomUUID();
const destinationNoUploadId = crypto.randomUUID();
const sourceFolderId = crypto.randomUUID();
const visibleTrashFolderId = crypto.randomUUID();
const restrictedTrashFolderId = crypto.randomUUID();
const workerDeletedFileId = crypto.randomUUID();
const restrictedDeletedFileId = crypto.randomUUID();

const adminEmail = `admin-${adminUserId}@folder-permissions-trash-test.local`;
const pmEmail = `pm-${pmUserId}@folder-permissions-trash-test.local`;
const workerEmail = `worker-${workerUserId}@folder-permissions-trash-test.local`;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { files, folders, jobAssignees, jobs, users } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Folder Admin",
      role: "admin",
    },
    {
      id: pmUserId,
      email: pmEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Folder PM",
      role: "project_manager",
    },
    {
      id: workerUserId,
      email: workerEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Folder Worker",
      role: "crew_member",
    },
  ]);
  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Folder Permission Job",
    createdBy: adminUserId,
    projectManagerId: pmUserId,
  });
  await db.insert(jobAssignees).values({ jobId, userId: workerUserId });

  await db.insert(folders).values([
    {
      id: noUploadParentId,
      title: "ZZZ No Upload Parent",
      scope: "job",
      jobId,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
    {
      id: writableParentId,
      title: "ZZZ Writable Parent",
      scope: "job",
      jobId,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { project_manager: true },
    },
    {
      id: destinationNoUploadId,
      title: "ZZZ No Upload Destination",
      scope: "job",
      jobId,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
    {
      id: sourceFolderId,
      title: "ZZZ Source Folder",
      scope: "job",
      jobId,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { project_manager: true },
    },
    {
      id: visibleTrashFolderId,
      title: "ZZZ Visible Trash Folder",
      scope: "job",
      jobId,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { project_manager: true },
    },
    {
      id: restrictedTrashFolderId,
      title: "ZZZ Restricted Trash Folder",
      scope: "job",
      jobId,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { admin: true },
      uploadingPermissions: { admin: true },
    },
  ]);

  await db.insert(files).values([
    {
      id: workerDeletedFileId,
      folderId: visibleTrashFolderId,
      filename: "worker-deleted.pdf",
      originalName: "Worker Deleted.pdf",
      fileUrl: `/uploads/folder-permissions/${workerDeletedFileId}.pdf`,
      fileSize: 10,
      mimeType: "application/pdf",
      uploadedBy: workerUserId,
      deletedAt: new Date(),
    },
    {
      id: restrictedDeletedFileId,
      folderId: restrictedTrashFolderId,
      filename: "restricted-deleted.pdf",
      originalName: "Restricted Deleted.pdf",
      fileUrl: `/uploads/folder-permissions/${restrictedDeletedFileId}.pdf`,
      fileSize: 10,
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
      deletedAt: new Date(),
    },
  ]);

  const stamp = new Date();
  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Folder Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  pmAccessJwt = auth.signAccessToken({
    id: pmUserId,
    email: pmEmail,
    fullName: "ZZZ Folder PM",
    role: "project_manager",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  workerAccessJwt = auth.signAccessToken({
    id: workerUserId,
    email: workerEmail,
    fullName: "ZZZ Folder Worker",
    role: "crew_member",
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
  const { inArray, eq } = await import("drizzle-orm");

  try {
    await db.delete(activityLog).where(inArray(activityLog.userId, [adminUserId, pmUserId, workerUserId]));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(users).where(inArray(users.id, [adminUserId, pmUserId, workerUserId]));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

function jsonHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

test("creating a folder requires upload permission on the parent", async () => {
  const denied = await fetch(`${baseUrl}/api/jobs/${jobId}/folders`, {
    method: "POST",
    headers: jsonHeaders(pmAccessJwt),
    body: JSON.stringify({
      mediaType: "document",
      parentFolderId: noUploadParentId,
      title: `Denied Child ${crypto.randomUUID()}`,
    }),
  });
  assert.equal(denied.status, 403);

  const ok = await fetch(`${baseUrl}/api/jobs/${jobId}/folders`, {
    method: "POST",
    headers: jsonHeaders(pmAccessJwt),
    body: JSON.stringify({
      mediaType: "document",
      parentFolderId: writableParentId,
      title: `Allowed Child ${crypto.randomUUID()}`,
    }),
  });
  assert.equal(ok.status, 201);
});

test("moving a folder requires upload permission on the destination", async () => {
  const denied = await fetch(`${baseUrl}/api/folders/${sourceFolderId}/move`, {
    method: "PUT",
    headers: jsonHeaders(pmAccessJwt),
    body: JSON.stringify({ destinationFolderId: destinationNoUploadId }),
  });
  assert.equal(denied.status, 403);

  const { db } = await import("@workspace/db");
  const { folders } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  await db
    .update(folders)
    .set({ uploadingPermissions: { project_manager: true } })
    .where(eq(folders.id, destinationNoUploadId));

  const ok = await fetch(`${baseUrl}/api/folders/${sourceFolderId}/move`, {
    method: "PUT",
    headers: jsonHeaders(pmAccessJwt),
    body: JSON.stringify({ destinationFolderId: destinationNoUploadId }),
  });
  assert.equal(ok.status, 200);
});

test("trash listing respects folder visibility", async () => {
  const workerResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/trash?mediaType=document`, {
    headers: { authorization: `Bearer ${workerAccessJwt}` },
  });
  assert.equal(workerResponse.status, 200);
  const workerBody = (await workerResponse.json()) as {
    files: Array<{ id: string; originalName: string }>;
  };
  assert.equal(workerBody.files.some((file) => file.id === workerDeletedFileId), true);
  assert.equal(workerBody.files.some((file) => file.id === restrictedDeletedFileId), false);
  assert.equal(JSON.stringify(workerBody).includes("Restricted Deleted"), false);

  const adminResponse = await fetch(`${baseUrl}/api/jobs/${jobId}/trash?mediaType=document`, {
    headers: { authorization: `Bearer ${adminAccessJwt}` },
  });
  assert.equal(adminResponse.status, 200);
  const adminBody = (await adminResponse.json()) as {
    files: Array<{ id: string; originalName: string }>;
  };
  assert.equal(adminBody.files.some((file) => file.id === workerDeletedFileId), true);
  assert.equal(adminBody.files.some((file) => file.id === restrictedDeletedFileId), true);
});
