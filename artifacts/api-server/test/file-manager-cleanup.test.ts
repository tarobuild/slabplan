import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

const adminUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@file-manager-cleanup-test.local`;

const jobId = crypto.randomUUID();
const clientId = crypto.randomUUID();

// Folder tree we build for the copy test:
//   root
//     ├── live-child       (kept)
//     │      └── live-grandchild  (kept)
//     └── deleted-child    (soft-deleted; must NOT be resurrected)
//            └── deleted-grandchild (soft-deleted)
const rootFolderId = crypto.randomUUID();
const liveChildFolderId = crypto.randomUUID();
const liveGrandchildFolderId = crypto.randomUUID();
const deletedChildFolderId = crypto.randomUUID();
const deletedGrandchildFolderId = crypto.randomUUID();

// Files: one in the live child (kept), one in the live child but soft-deleted
// (must NOT be resurrected), one in the deleted child (also must NOT appear).
const liveFileId = crypto.randomUUID();
const deletedFileInLiveFolderId = crypto.randomUUID();
const fileInDeletedFolderId = crypto.randomUUID();

// Folder used by the permissions test.
const permissionsFolderId = crypto.randomUUID();

const testFolderIds = [
  rootFolderId,
  liveChildFolderId,
  liveGrandchildFolderId,
  deletedChildFolderId,
  deletedGrandchildFolderId,
  permissionsFolderId,
];
const testFileIds = [liveFileId, deletedFileInLiveFolderId, fileInDeletedFolderId];

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // The shared db client (lib/db) prefers SUPABASE_DATABASE_URL when set, but
  // that points at the production pooler with a 15-client cap that the test
  // suites blow through immediately. Force tests to use the local DATABASE_URL.
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;

  const { db } = await import("@workspace/db");
  const { clients, files, folders, jobs, users } = await import("@workspace/db/schema");

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ File Manager Cleanup Admin",
    role: "admin",
  });

  await db.insert(clients).values({
    id: clientId,
    companyName: "ZZZ File Manager Cleanup Client",
    createdBy: adminUserId,
  });

  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ File Manager Cleanup Job",
    clientId,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });

  const now = new Date();
  await db.insert(folders).values([
    {
      id: rootFolderId,
      jobId,
      scope: "job",
      title: "ZZZ Cleanup Root",
      mediaType: "document",
      isGlobal: false,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
    {
      id: liveChildFolderId,
      jobId,
      scope: "job",
      parentFolderId: rootFolderId,
      title: "ZZZ Cleanup Live Child",
      mediaType: "document",
      isGlobal: false,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
    {
      id: liveGrandchildFolderId,
      jobId,
      scope: "job",
      parentFolderId: liveChildFolderId,
      title: "ZZZ Cleanup Live Grandchild",
      mediaType: "document",
      isGlobal: false,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
    {
      id: deletedChildFolderId,
      jobId,
      scope: "job",
      parentFolderId: rootFolderId,
      title: "ZZZ Cleanup Deleted Child",
      mediaType: "document",
      isGlobal: false,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
      deletedAt: now,
    },
    {
      id: deletedGrandchildFolderId,
      jobId,
      scope: "job",
      parentFolderId: deletedChildFolderId,
      title: "ZZZ Cleanup Deleted Grandchild",
      mediaType: "document",
      isGlobal: false,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
      deletedAt: now,
    },
    {
      id: permissionsFolderId,
      jobId,
      scope: "job",
      title: "ZZZ Cleanup Permissions Folder",
      mediaType: "document",
      isGlobal: false,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    },
  ]);

  await db.insert(files).values([
    {
      id: liveFileId,
      folderId: liveChildFolderId,
      filename: "live.pdf",
      originalName: "live.pdf",
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
    },
    {
      id: deletedFileInLiveFolderId,
      folderId: liveChildFolderId,
      filename: "deleted-in-live-folder.pdf",
      originalName: "deleted-in-live-folder.pdf",
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
      deletedAt: now,
    },
    {
      id: fileInDeletedFolderId,
      folderId: deletedChildFolderId,
      filename: "in-deleted-folder.pdf",
      originalName: "in-deleted-folder.pdf",
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
    },
  ]);
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { clients, files, folders, jobs, users, activityLog } = await import(
    "@workspace/db/schema"
  );
  const { eq, inArray, like } = await import("drizzle-orm");

  try {
    // Activity rows reference the jobs/folders we created — drop them first.
    await db.delete(activityLog).where(eq(activityLog.userId, adminUserId));
    // The copy test creates additional folder/file rows we don't know the IDs
    // of ahead of time. Scope the cleanup to this job so we still drop them.
    await db.delete(files).where(inArray(files.id, testFileIds));
    await db
      .delete(files)
      .where(
        inArray(
          files.folderId,
          // Include any folder belonging to this job (covers copies).
          (
            await db
              .select({ id: folders.id })
              .from(folders)
              .where(eq(folders.jobId, jobId))
          ).map((row) => row.id),
        ),
      );
    await db.delete(folders).where(eq(folders.jobId, jobId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(eq(users.id, adminUserId));
    // Best-effort: clear any stragglers from earlier failed runs of this suite.
    await db
      .delete(users)
      .where(like(users.email, "%@file-manager-cleanup-test.local"));
  } finally {
    await pool.end();
  }
});

test("copyFolder skips soft-deleted descendants and files", async () => {
  const { copyFolder, getAllFoldersForJob, getAllFilesForFolderIds } = await import(
    "../src/lib/file-manager.ts"
  );

  const copied = await copyFolder({ folderId: rootFolderId, userId: adminUserId });

  // Sanity: the copy returns a brand new live folder.
  assert.notEqual(copied.id, rootFolderId);
  assert.equal(copied.deletedAt, null);
  assert.equal(copied.title, "ZZZ Cleanup Root Copy");

  const liveFoldersAfter = await getAllFoldersForJob(jobId, "document", false);
  const copiedSubtree = liveFoldersAfter.filter((folder) => {
    // Walk up parent chain to see if `copied` is an ancestor.
    let current: { id: string; parentFolderId: string | null } | undefined = folder;
    while (current) {
      if (current.id === copied.id) {
        return true;
      }
      const parentId: string | null = current.parentFolderId;
      current = parentId
        ? liveFoldersAfter.find((candidate) => candidate.id === parentId)
        : undefined;
    }
    return false;
  });

  // Expected: copied root + live child + live grandchild = 3 folders.
  // The two soft-deleted source folders must NOT appear in the copy.
  assert.equal(
    copiedSubtree.length,
    3,
    `Expected 3 copied folders, saw ${copiedSubtree.length}: ${copiedSubtree
      .map((folder) => folder.title)
      .join(", ")}`,
  );

  const copiedTitles = copiedSubtree.map((folder) => folder.title).sort();
  assert.deepEqual(copiedTitles, [
    "ZZZ Cleanup Live Child",
    "ZZZ Cleanup Live Grandchild",
    "ZZZ Cleanup Root Copy",
  ]);

  // None of the copied folders should be soft-deleted.
  for (const folder of copiedSubtree) {
    assert.equal(folder.deletedAt, null, `copied folder ${folder.title} was created soft-deleted`);
  }

  // The copied tree should contain only the one live file. The soft-deleted
  // file inside the live folder, and the file inside the soft-deleted folder,
  // must NOT have been re-created.
  const copiedFiles = await getAllFilesForFolderIds(
    copiedSubtree.map((folder) => folder.id),
    false,
  );
  assert.equal(
    copiedFiles.length,
    1,
    `Expected 1 copied file, saw ${copiedFiles.length}: ${copiedFiles
      .map((file) => file.filename)
      .join(", ")}`,
  );
  assert.equal(copiedFiles[0].filename, "live.pdf");
});

test("renameOrUpdateFolder clears permissions when payload sets them to null", async () => {
  const { renameOrUpdateFolder, getFolderOrThrow } = await import("../src/lib/file-manager.ts");

  // Sanity: starts with a non-null restriction.
  const before = await getFolderOrThrow(permissionsFolderId);
  assert.notEqual(before.viewingPermissions, null);
  assert.notEqual(before.uploadingPermissions, null);

  const updated = await renameOrUpdateFolder({
    folderId: permissionsFolderId,
    viewingPermissions: null,
    uploadingPermissions: null,
    userId: adminUserId,
  });

  assert.equal(updated.viewingPermissions, null);
  assert.equal(updated.uploadingPermissions, null);

  // Re-read to confirm the null was actually persisted (not just on the
  // returned row).
  const persisted = await getFolderOrThrow(permissionsFolderId);
  assert.equal(persisted.viewingPermissions, null);
  assert.equal(persisted.uploadingPermissions, null);
});

test("renameOrUpdateFolder leaves permissions untouched when omitted from the payload", async () => {
  const { db } = await import("@workspace/db");
  const { folders } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { renameOrUpdateFolder, getFolderOrThrow } = await import("../src/lib/file-manager.ts");

  // Re-seed a known restriction so this test is independent of the previous one.
  const seededViewing = { internal: true };
  const seededUploading = { admin: true, project_manager: true };
  await db
    .update(folders)
    .set({
      viewingPermissions: seededViewing,
      uploadingPermissions: seededUploading,
    })
    .where(eq(folders.id, permissionsFolderId));

  const updated = await renameOrUpdateFolder({
    folderId: permissionsFolderId,
    title: "ZZZ Cleanup Permissions Folder Renamed",
    userId: adminUserId,
  });

  assert.equal(updated.title, "ZZZ Cleanup Permissions Folder Renamed");
  assert.deepEqual(updated.viewingPermissions, seededViewing);
  assert.deepEqual(updated.uploadingPermissions, seededUploading);

  const persisted = await getFolderOrThrow(permissionsFolderId);
  assert.deepEqual(persisted.viewingPermissions, seededViewing);
  assert.deepEqual(persisted.uploadingPermissions, seededUploading);
});

test("renameOrUpdateFolder treats `viewingPermissions: undefined` as omitted", async () => {
  // Mirrors the route, which always sets `viewingPermissions: body.data.viewingPermissions`
  // even when the request body omitted the field (zod yields `undefined`).
  const { db } = await import("@workspace/db");
  const { folders } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { renameOrUpdateFolder, getFolderOrThrow } = await import("../src/lib/file-manager.ts");

  const seededViewing = { internal: true };
  const seededUploading = { admin: true };
  await db
    .update(folders)
    .set({
      viewingPermissions: seededViewing,
      uploadingPermissions: seededUploading,
    })
    .where(eq(folders.id, permissionsFolderId));

  await renameOrUpdateFolder({
    folderId: permissionsFolderId,
    title: "ZZZ Cleanup Permissions Folder Renamed Again",
    viewingPermissions: undefined,
    uploadingPermissions: undefined,
    userId: adminUserId,
  });

  const persisted = await getFolderOrThrow(permissionsFolderId);
  assert.deepEqual(persisted.viewingPermissions, seededViewing);
  assert.deepEqual(persisted.uploadingPermissions, seededUploading);
});
