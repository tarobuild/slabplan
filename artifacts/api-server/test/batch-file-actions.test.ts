import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

const adminUserId = crypto.randomUUID();
const sourceFolderId = crypto.randomUUID();
const destinationFolderId = crypto.randomUUID();
const photoFolderId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@batch-file-actions.local`;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://stub.invalid";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key";

  const { db } = await import("@workspace/db");
  const { folders, users } = await import("@workspace/db/schema");

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Batch File Admin",
    role: "admin",
  });
  await db.insert(folders).values([
    {
      id: sourceFolderId,
      title: `ZZZ Batch Source ${sourceFolderId}`,
      scope: "resource",
      jobId: null,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
    {
      id: destinationFolderId,
      title: `ZZZ Batch Destination ${destinationFolderId}`,
      scope: "resource",
      jobId: null,
      parentFolderId: null,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
    {
      id: photoFolderId,
      title: `ZZZ Batch Photo Destination ${photoFolderId}`,
      scope: "resource",
      jobId: null,
      parentFolderId: null,
      mediaType: "photo",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
    },
  ]);
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { activityLog, files, folders, users } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    await db.delete(activityLog).where(eq(activityLog.userId, adminUserId));
    await db.delete(files).where(inArray(files.folderId, [sourceFolderId, destinationFolderId, photoFolderId]));
    await db.delete(folders).where(inArray(folders.id, [sourceFolderId, destinationFolderId, photoFolderId]));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    await pool.end();
  }
});

async function insertFile(overrides: {
  id?: string;
  folderId?: string;
  originalName?: string;
  fileUrl?: string | null;
  contentHash?: string | null;
  note?: string | null;
  durationSeconds?: number | null;
}) {
  const { db } = await import("@workspace/db");
  const { files } = await import("@workspace/db/schema");
  const id = overrides.id ?? crypto.randomUUID();
  const originalName = overrides.originalName ?? `${id}.pdf`;

  await db.insert(files).values({
    id,
    folderId: overrides.folderId ?? sourceFolderId,
    filename: originalName,
    originalName,
    fileUrl: overrides.fileUrl === undefined ? `/uploads/batch-file-actions/${id}.pdf` : overrides.fileUrl,
    fileSize: 123,
    contentHash: overrides.contentHash ?? null,
    mimeType: "application/pdf",
    note: overrides.note ?? null,
    uploadedBy: adminUserId,
    durationSeconds: overrides.durationSeconds ?? null,
  });

  return id;
}

test("moveFiles moves every selected file and rejects cross-media destinations without partial mutation", async () => {
  const { db } = await import("@workspace/db");
  const { files } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { moveFiles } = await import("../src/lib/file-manager.ts");

  const firstId = await insertFile({ originalName: "Move A.pdf" });
  const secondId = await insertFile({ originalName: "Move B.pdf" });

  const moved = await moveFiles({
    fileIds: [firstId, secondId],
    destinationFolderId,
    userId: adminUserId,
  });
  assert.equal(moved.length, 2);

  const movedRows = await db.select().from(files).where(inArray(files.id, [firstId, secondId]));
  assert.deepEqual(new Set(movedRows.map((file) => file.folderId)), new Set([destinationFolderId]));

  const invalidFirstId = await insertFile({ originalName: "Invalid Move A.pdf" });
  const invalidSecondId = await insertFile({ originalName: "Invalid Move B.pdf" });

  await assert.rejects(
    moveFiles({
      fileIds: [invalidFirstId, invalidSecondId],
      destinationFolderId: photoFolderId,
      userId: adminUserId,
    }),
    /same job and media type/,
  );

  const unchangedRows = await db
    .select()
    .from(files)
    .where(inArray(files.id, [invalidFirstId, invalidSecondId]));
  assert.deepEqual(new Set(unchangedRows.map((file) => file.folderId)), new Set([sourceFolderId]));

  await assert.rejects(
    moveFiles({
      fileIds: [invalidFirstId],
      destinationFolderId: sourceFolderId,
      userId: adminUserId,
    }),
    /different from the source folder/,
  );

  const stillUnchanged = await db.select().from(files).where(eq(files.id, invalidFirstId)).limit(1);
  assert.equal(stillUnchanged[0]?.folderId, sourceFolderId);
});

test("copyFiles preserves file metadata while leaving the source row in place", async () => {
  const { db } = await import("@workspace/db");
  const { files } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { copyFiles } = await import("../src/lib/file-manager.ts");
  const contentHash = "a".repeat(64);
  const sourceFileId = await insertFile({
    originalName: "Copy Metadata.pdf",
    fileUrl: "/uploads/batch-file-actions/copy-metadata.pdf",
    contentHash,
    note: "Preserve this note",
    durationSeconds: 42,
  });

  const copied = await copyFiles({
    fileIds: [sourceFileId],
    destinationFolderId,
    userId: adminUserId,
  });

  assert.equal(copied.length, 1);
  assert.notEqual(copied[0]?.id, sourceFileId);

  const [source] = await db.select().from(files).where(eq(files.id, sourceFileId)).limit(1);
  assert.equal(source?.folderId, sourceFolderId);

  const [copy] = await db.select().from(files).where(eq(files.id, copied[0]!.id)).limit(1);
  assert.equal(copy?.folderId, destinationFolderId);
  assert.equal(copy?.fileUrl, source?.fileUrl);
  assert.equal(copy?.originalName, source?.originalName);
  assert.equal(copy?.contentHash, contentHash);
  assert.equal(copy?.note, "Preserve this note");
  assert.equal(copy?.durationSeconds, 42);
});

test("softDeleteFiles rejects invalid batches before touching valid rows", async () => {
  const { db } = await import("@workspace/db");
  const { files } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { softDeleteFiles } = await import("../src/lib/file-manager.ts");
  const validId = await insertFile({ originalName: "Valid Delete.pdf" });
  const missingId = crypto.randomUUID();

  await assert.rejects(
    softDeleteFiles({
      fileIds: [validId, missingId],
      userId: adminUserId,
    }),
    /File not found/,
  );

  const [validAfterFailedBatch] = await db.select().from(files).where(eq(files.id, validId)).limit(1);
  assert.equal(validAfterFailedBatch?.deletedAt, null);

  const firstDeleteId = await insertFile({ originalName: "Delete A.pdf" });
  const secondDeleteId = await insertFile({ originalName: "Delete B.pdf" });
  const deleted = await softDeleteFiles({
    fileIds: [firstDeleteId, secondDeleteId],
    userId: adminUserId,
  });

  assert.equal(deleted.length, 2);
  const deletedRows = await db
    .select()
    .from(files)
    .where(inArray(files.id, [firstDeleteId, secondDeleteId]));
  assert.equal(deletedRows.length, 2);
  assert.equal(deletedRows.every((file) => file.deletedAt !== null), true);

});

test("collectSelectedFileZipEntries skips URL-less files and disambiguates duplicate archive names", async () => {
  const { collectSelectedFileZipEntries } = await import("../src/lib/file-manager.ts");
  const firstId = await insertFile({
    originalName: "Duplicate.pdf",
    fileUrl: "/uploads/batch-file-actions/duplicate-a.pdf",
  });
  const secondId = await insertFile({
    originalName: "Duplicate.pdf",
    fileUrl: "/uploads/batch-file-actions/duplicate-b.pdf",
  });
  const missingUrlId = await insertFile({
    originalName: "No URL.pdf",
    fileUrl: null,
  });

  const result = await collectSelectedFileZipEntries({
    fileIds: [firstId, secondId, missingUrlId],
  });

  assert.equal(result.rootTitle, "Selected Files");
  assert.deepEqual(
    result.entries.map((entry) => entry.zipName),
    ["Selected Files/Duplicate.pdf", "Selected Files/Duplicate (2).pdf"],
  );
});
