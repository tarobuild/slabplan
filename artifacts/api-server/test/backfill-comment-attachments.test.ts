import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";

const testDatabaseUrl =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

// 1x1 transparent PNG. Same fixture used by daily-log-comment-attachments.test.ts
// — gives us a valid base64 image payload to feed the backfill.
const tinyPngHex =
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478da6300010000000500010d0a2db40000000049454e44ae426082";
const tinyPngBytes = Buffer.from(tinyPngHex, "hex");
const tinyPngDataUrl = `data:image/png;base64,${tinyPngBytes.toString("base64")}`;

const adminUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const dailyLogId = crypto.randomUUID();

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;

  const { db } = await import("@workspace/db");
  const { users, jobs, dailyLogs } = await import("@workspace/db/schema");

  await db.insert(users).values({
    id: adminUserId,
    email: `admin-${adminUserId}@backfill-test.local`,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Backfill Admin",
    role: "admin",
  });

  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Backfill Job",
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });

  await db.insert(dailyLogs).values({
    id: dailyLogId,
    jobId,
    logDate: "2025-05-02",
    title: "ZZZ Backfill Log",
    notes: "backfill seed",
    createdBy: adminUserId,
    shareInternalUsers: true,
  });
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { users, jobs, dailyLogs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  try {
    // Daily log cascades to comments/folders/files, so deleting it cleans
    // up everything the backfill produced during the test.
    await db.delete(dailyLogs).where(eq(dailyLogs.id, dailyLogId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    await pool.end();
  }
});

interface CapturedWrite {
  fileUrl: string;
  size: number;
  contentType: string | null | undefined;
}

function makeFakeStorage() {
  const writes: CapturedWrite[] = [];
  const deletes: string[] = [];
  return {
    writes,
    deletes,
    storage: {
      async write(
        fileUrl: string,
        buffer: Buffer,
        options: { contentType?: string | null },
      ) {
        writes.push({
          fileUrl,
          size: buffer.length,
          contentType: options.contentType,
        });
      },
      async delete(fileUrl: string) {
        deletes.push(fileUrl);
      },
    },
  };
}

test("backfill rewrites legacy base64 attachments to fileId/fileUrl entries", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogComments, files, folders } = await import(
    "@workspace/db/schema"
  );
  const { eq } = await import("drizzle-orm");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const commentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "legacy attachment",
    attachments: [
      {
        name: "legacy.png",
        url: tinyPngDataUrl,
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  const fake = makeFakeStorage();
  const stats = await backfillCommentAttachments(fake.storage, {
    commentIds: [commentId],
  });

  assert.equal(stats.attachmentsConverted >= 1, true, JSON.stringify(stats));
  assert.equal(stats.rowFailures, 0);
  assert.equal(fake.deletes.length, 0, "no rollback on a happy-path conversion");

  const [updated] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, commentId));

  const attachments = updated.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  const [first] = attachments;
  assert.equal(typeof first.fileId, "string");
  assert.equal(typeof first.fileUrl, "string");
  assert.equal(first.name, "legacy.png");
  assert.equal(first.mimeType, "image/png");
  assert.equal(
    typeof (first as Record<string, unknown>).url === "string" &&
      ((first as Record<string, unknown>).url as string).startsWith("data:"),
    false,
    "the rewritten record must not still carry a base64 data URL",
  );

  // Verify a files row was actually inserted into a comment-attachments
  // folder for this daily log.
  const [folder] = await db
    .select({ id: folders.id, title: folders.title })
    .from(folders)
    .where(eq(folders.dailyLogId, dailyLogId));
  assert.ok(folder, "comment attachment folder should exist");
  assert.match(folder.title, /Comment Attachments$/);

  const fileRows = await db
    .select({
      id: files.id,
      fileSize: files.fileSize,
      mimeType: files.mimeType,
    })
    .from(files)
    .where(eq(files.folderId, folder.id));
  assert.equal(fileRows.length, 1);
  assert.equal(fileRows[0].fileSize, tinyPngBytes.length);
  assert.equal(fileRows[0].mimeType, "image/png");
  assert.equal(fileRows[0].id, first.fileId);

  // Storage was called exactly once with the right payload size.
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.writes[0].size, tinyPngBytes.length);
  assert.equal(fake.writes[0].contentType, "image/png");
});

test("backfill is idempotent — re-running on already-converted comments writes nothing", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogComments } = await import("@workspace/db/schema");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const commentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "already converted attachment",
    attachments: [
      {
        fileId: crypto.randomUUID(),
        fileUrl: "/api/files/comment-attachments/already.png",
        name: "already.png",
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  const fake = makeFakeStorage();
  const stats = await backfillCommentAttachments(fake.storage, {
    commentIds: [commentId],
  });

  // This row is already on the fileId/fileUrl shape, so the scoped run
  // must be a pure no-op: nothing converted, nothing dropped, no storage writes.
  assert.equal(
    stats.attachmentsConverted,
    0,
    `expected zero conversions on re-run, got ${JSON.stringify(stats)}`,
  );
  assert.equal(stats.rowFailures, 0);
  assert.equal(fake.writes.length, 0, "re-run must not write to storage");
  assert.equal(fake.deletes.length, 0);
});

test("concurrent backfills do not write duplicate storage objects for one stale row", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogComments } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const commentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "concurrent legacy attachment",
    attachments: [
      {
        name: "concurrent.png",
        url: tinyPngDataUrl,
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  const writes: CapturedWrite[] = [];
  let firstWriteStartedResolve!: () => void;
  let releaseFirstWrite!: () => void;
  const firstWriteStarted = new Promise<void>((resolve) => {
    firstWriteStartedResolve = resolve;
  });
  const firstWriteRelease = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const storage = {
    async write(
      fileUrl: string,
      buffer: Buffer,
      options: { contentType?: string | null },
    ) {
      writes.push({
        fileUrl,
        size: buffer.length,
        contentType: options.contentType,
      });
      if (writes.length === 1) {
        firstWriteStartedResolve();
        await firstWriteRelease;
      }
    },
    async delete() {},
  };

  const first = backfillCommentAttachments(storage, { commentIds: [commentId] });
  await firstWriteStarted;
  const second = backfillCommentAttachments(storage, { commentIds: [commentId] });
  releaseFirstWrite();
  const [firstStats, secondStats] = await Promise.all([first, second]);

  assert.equal(firstStats.rowFailures, 0);
  assert.equal(secondStats.rowFailures, 0);
  assert.equal(
    writes.length,
    1,
    "the second backfill must re-read the locked row and skip storage writes",
  );

  const [updated] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, commentId));
  const attachments = updated.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  assert.equal(typeof attachments[0].fileId, "string");
});

test("backfill drops malformed base64 data URLs without writing storage or files rows", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogComments, files } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const commentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "malformed data url",
    attachments: [
      {
        name: "malformed.png",
        url: "data:image/png;base64,not-base64%%%",
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  const fake = makeFakeStorage();
  const stats = await backfillCommentAttachments(fake.storage, {
    commentIds: [commentId],
  });

  assert.ok(stats.attachmentsDropped >= 1, JSON.stringify(stats));
  assert.equal(stats.rowFailures, 0);
  assert.equal(fake.writes.length, 0, "malformed base64 must not be written to storage");
  assert.equal(fake.deletes.length, 0);

  const [updated] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, commentId));
  assert.deepEqual(updated.attachments, []);

  const malformedRows = await db
    .select({ id: files.id })
    .from(files)
    .where(eq(files.originalName, "malformed.png"));
  assert.equal(malformedRows.length, 0, "malformed base64 must not create a files row");

  await db.delete(dailyLogComments).where(eq(dailyLogComments.id, commentId));
});

test("backfill leaves non-data URLs alone but converts mixed rows", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogComments } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const unrelatedCommentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: unrelatedCommentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "unrelated legacy attachment",
    attachments: [
      {
        name: "unrelated.png",
        url: tinyPngDataUrl,
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  const commentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "mixed attachments",
    attachments: [
      {
        name: "external.png",
        url: "https://cdn.example.com/external.png",
        mimeType: "image/png",
      },
      {
        name: "to-convert.png",
        url: tinyPngDataUrl,
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  const fake = makeFakeStorage();
  const stats = await backfillCommentAttachments(fake.storage, {
    commentIds: [commentId],
  });

  assert.equal(stats.attachmentsConverted, 1, JSON.stringify(stats));
  assert.equal(stats.rowFailures, 0);
  assert.equal(fake.writes.length, 1);

  const [updated] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, commentId));

  const attachments = updated.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 2);
  // External URL preserved as-is.
  const external = attachments.find((a) => a.name === "external.png");
  assert.ok(external);
  assert.equal(external.url, "https://cdn.example.com/external.png");
  assert.equal(external.fileId ?? null, null);
  // Data URL converted.
  const converted = attachments.find((a) => a.name === "to-convert.png");
  assert.ok(converted);
  assert.equal(typeof converted.fileId, "string");
  assert.equal(typeof converted.fileUrl, "string");

  const [unrelated] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, unrelatedCommentId));
  const unrelatedAttachments =
    unrelated.attachments as Array<Record<string, unknown>>;
  assert.equal(unrelatedAttachments.length, 1);
  assert.equal(unrelatedAttachments[0].url, tinyPngDataUrl);
});

test("backfill reports failure and leaves the row untouched when storage.write throws", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogComments } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const commentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "storage write will fail",
    attachments: [
      {
        name: "storage-fail.png",
        url: tinyPngDataUrl,
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  const writes: string[] = [];
  const deletes: string[] = [];
  const failingStorage = {
    async write(fileUrl: string) {
      writes.push(fileUrl);
      throw new Error("simulated storage write failure");
    },
    async delete(fileUrl: string) {
      deletes.push(fileUrl);
    },
  };

  const stats = await backfillCommentAttachments(failingStorage, {
    commentIds: [commentId],
  });

  // Tests share a database; assert on what THIS row's failure produced
  // rather than on global rowFailures.
  assert.ok(stats.rowFailures >= 1, JSON.stringify(stats));

  const [unchanged] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, commentId));
  const attachments = unchanged.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  assert.equal(
    typeof attachments[0].url === "string" &&
      (attachments[0].url as string).startsWith("data:"),
    true,
    "the row must still hold the original base64 attachment after a failed run",
  );

  // The writer threw before the URL was captured into the rollback queue,
  // so no compensating delete is expected — for any row.
  assert.ok(writes.length >= 1);
  assert.equal(deletes.length, 0);

  // Drop the row so subsequent tests aren't fighting a known-failing
  // legacy attachment on every backfill scan.
  await db.delete(dailyLogComments).where(eq(dailyLogComments.id, commentId));
});

test("backfill compensates by deleting written objects when the DB transaction fails after a successful storage write", async () => {
  const dbModule = await import("@workspace/db");
  const { db } = dbModule;
  const { dailyLogComments } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const commentId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "db write will fail after storage succeeds",
    attachments: [
      {
        name: "db-fail.png",
        url: tinyPngDataUrl,
        mimeType: "image/png",
      },
    ],
    reactions: {},
  });

  // Patch db.transaction so the user callback runs to completion (storage
  // writes succeed, files row inserted, comment updated) but the
  // transaction itself throws on the way out — the same effect as a
  // commit-time DB failure. The script's catch block must then call
  // storage.delete to compensate the orphaned blob.
  const originalTransaction = db.transaction.bind(db);
  const dbAny = db as unknown as { transaction: typeof db.transaction };
  dbAny.transaction = (async (fn: Parameters<typeof db.transaction>[0]) => {
    return originalTransaction(async (tx) => {
      await fn(tx);
      throw new Error("simulated DB failure after storage write");
    });
  }) as typeof db.transaction;

  const writes: string[] = [];
  const deletes: string[] = [];
  const trackingStorage = {
    async write(fileUrl: string) {
      writes.push(fileUrl);
    },
    async delete(fileUrl: string) {
      deletes.push(fileUrl);
    },
  };

  let stats;
  try {
    stats = await backfillCommentAttachments(trackingStorage, {
      commentIds: [commentId],
    });
  } finally {
    dbAny.transaction = originalTransaction;
  }

  // Tests share a database; assert this row failed (others may too).
  assert.ok(stats.rowFailures >= 1, JSON.stringify(stats));

  const [unchanged] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, commentId));
  const attachments = unchanged.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  assert.equal(
    typeof attachments[0].url === "string" &&
      (attachments[0].url as string).startsWith("data:"),
    true,
    "DB row must be rolled back to its legacy shape",
  );

  // Every storage write must have a matching compensation delete — that's
  // the rollback contract this test exists to verify.
  assert.ok(writes.length >= 1);
  assert.equal(
    deletes.length,
    writes.length,
    "every written object must be compensated with a delete",
  );
  for (const url of writes) {
    assert.ok(
      deletes.includes(url),
      `write ${url} was never compensated by a matching delete`,
    );
  }

  await db.delete(dailyLogComments).where(eq(dailyLogComments.id, commentId));
});

test("backfill strips leftover base64 url from records that already carry a fileId", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogComments } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { backfillCommentAttachments } = await import(
    "../src/scripts/backfill-comment-attachments.ts"
  );

  const commentId = crypto.randomUUID();
  const fakeFileId = crypto.randomUUID();
  await db.insert(dailyLogComments).values({
    id: commentId,
    dailyLogId,
    createdBy: adminUserId,
    body: "partially converted",
    attachments: [
      {
        // Hybrid record: already has fileId/fileUrl but a previous partial
        // run also left the legacy base64 `url` behind. The backfill must
        // strip that leftover so no raw base64 remains in storage.
        fileId: fakeFileId,
        fileUrl: "/api/files/comment-attachments/legacy.png",
        name: "hybrid.png",
        mimeType: "image/png",
        url: tinyPngDataUrl,
      },
    ],
    reactions: {},
  });

  const stats = await backfillCommentAttachments(makeFakeStorage().storage, {
    commentIds: [commentId],
  });

  // Other tests may have left rows behind; this row's outcome is asserted
  // via the resulting attachments JSON below.
  assert.ok(stats.attachmentsAlreadyConverted >= 1, JSON.stringify(stats));

  const [updated] = await db
    .select({ attachments: dailyLogComments.attachments })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.id, commentId));
  const attachments = updated.attachments as Array<Record<string, unknown>>;
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].fileId, fakeFileId);
  assert.equal(
    attachments[0].fileUrl,
    "/api/files/comment-attachments/legacy.png",
  );
  assert.equal(
    "url" in attachments[0],
    false,
    "leftover base64 `url` must be stripped",
  );
});
