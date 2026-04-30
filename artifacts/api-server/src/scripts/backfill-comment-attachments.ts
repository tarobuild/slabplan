/**
 * One-time backfill: rewrite legacy base64 attachments stored on
 * `daily_log_comments.attachments` so they live in object storage and are
 * referenced via the new `{fileId, fileUrl, name, mimeType}` shape — the
 * same pattern the /comments POST handler writes for new uploads.
 *
 * Why: pre-task-174 comments embedded their attachments as `data:` URLs
 * inside the JSON column. The read path tolerates both shapes today, but
 * those legacy rows skip the size/count caps and bloat the database.
 *
 * Idempotency: a comment row whose attachments contain no `data:` URLs is
 * left untouched. Already-converted entries (those carrying a `fileId`)
 * are passed through verbatim, so re-running the script is a no-op.
 *
 * Failure isolation: each comment row is processed in its own DB
 * transaction. If anything fails mid-row (storage write, files insert,
 * comment update), the transaction is rolled back AND any storage objects
 * we wrote during that row are deleted, so we never end up with orphaned
 * objects pointing at non-existent rows. The next run will re-attempt
 * the row from scratch.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { dailyLogComments, files, folders } from "@workspace/db/schema";
import {
  buildStoredFileName,
  buildUploadPath,
  deletePhysicalFile,
  writeUploadedBuffer,
} from "../lib/storage";

const DATA_URL_RE = /^data:([\w./+-]+);base64,(.*)$/i;

type RawAttachment = Record<string, unknown>;

// Mirrors the dailyLogComments.attachments json column type from
// lib/db/src/schema/index.ts. Used as the contract for everything we
// write back into the column — keeps the rewrite type-sound without
// asserting that the array contains only freshly-converted entries.
type StoredAttachment = {
  name: string;
  url?: string | null;
  mimeType: string | null;
  fileId?: string | null;
  fileUrl?: string | null;
};

type ConvertedAttachment = {
  name: string;
  mimeType: string | null;
  fileId: string;
  fileUrl: string;
};

interface BackfillStats {
  commentsScanned: number;
  commentsConverted: number;
  commentsSkipped: number;
  attachmentsConverted: number;
  attachmentsAlreadyConverted: number;
  attachmentsDropped: number;
  rowFailures: number;
}

function isPlainObject(value: unknown): value is RawAttachment {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

function parseDataUrl(
  value: unknown,
): { mime: string; data: string } | null {
  if (typeof value !== "string") return null;
  const match = DATA_URL_RE.exec(value);
  if (!match) return null;
  // The capture group can be empty for malformed inputs like "data:;base64,";
  // skip those — they would decode to a zero-byte file we cannot serve.
  if (!match[2]) return null;
  return { mime: match[1], data: match[2] };
}

function safeName(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 255);
  }
  return "attachment";
}

function safeMime(explicit: unknown, fallback: string | null): string | null {
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim().slice(0, 100);
  }
  if (fallback && fallback.trim().length > 0) {
    return fallback.trim().slice(0, 100);
  }
  return null;
}

// Mirror of `ensureDailyLogCommentAttachmentFolder` from
// artifacts/api-server/src/routes/daily-logs.ts. We duplicate it rather than
// import it to keep this script free of the express/request graph that the
// route module pulls in transitively. The client param is typed loosely
// (`db` and a transaction handle have compatible select/insert surfaces but
// drizzle's exported transaction type does not extend NodePgDatabase).
type TxClient = Pick<typeof db, "select" | "insert">;

async function ensureCommentFolder(
  client: TxClient,
  dailyLogId: string,
): Promise<{ id: string }> {
  const title = `Daily Log ${dailyLogId} Comment Attachments`;

  const [existing] = await client
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        isNull(folders.jobId),
        eq(folders.scope, "daily_log"),
        eq(folders.dailyLogId, dailyLogId),
        eq(folders.title, title),
        eq(folders.mediaType, "photo"),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await client
    .insert(folders)
    .values({
      jobId: sql<string>`null`,
      scope: "daily_log",
      dailyLogId,
      title,
      mediaType: "photo",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    })
    .returning({ id: folders.id });

  return created;
}

interface ProcessRowResult {
  converted: number;
  alreadyConverted: number;
  dropped: number;
  changed: boolean;
}

export interface StorageWriter {
  write: (
    fileUrl: string,
    buffer: Buffer,
    options: { contentType?: string | null },
  ) => Promise<void>;
  delete: (fileUrl: string) => Promise<void>;
}

const realStorage: StorageWriter = {
  write: writeUploadedBuffer,
  delete: deletePhysicalFile,
};

async function processCommentRow(
  row: {
    id: string;
    dailyLogId: string;
    createdBy: string | null;
    attachments: unknown;
  },
  storage: StorageWriter,
): Promise<ProcessRowResult> {
  const attachments = row.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { converted: 0, alreadyConverted: 0, dropped: 0, changed: false };
  }

  // Quick scan — bail without opening a transaction if there is nothing to
  // do. We also flag partially-converted records (those that already carry
  // a fileId but still hold a base64 `data:` url) so the cleanup path
  // strips the leftover blob.
  const hasLegacy = attachments.some((entry) => {
    if (!isPlainObject(entry)) return false;
    return parseDataUrl(entry.url) !== null;
  });
  if (!hasLegacy) {
    let alreadyConverted = 0;
    for (const entry of attachments) {
      if (
        isPlainObject(entry) &&
        typeof entry.fileId === "string" &&
        entry.fileId.length > 0
      ) {
        alreadyConverted += 1;
      }
    }
    return {
      converted: 0,
      alreadyConverted,
      dropped: 0,
      changed: false,
    };
  }

  // Track the storage objects we write inside the transaction so we can
  // delete them if the transaction rolls back. Storage and Postgres can't
  // share a transaction, so this manual compensation is how we keep the
  // two stores in sync (mirrors the pattern in persistWithStorageRollback).
  const writtenUrls: string[] = [];
  let result: ProcessRowResult = {
    converted: 0,
    alreadyConverted: 0,
    dropped: 0,
    changed: false,
  };

  try {
    await db.transaction(async (tx) => {
      const folder = await ensureCommentFolder(tx, row.dailyLogId);

      const newAttachments: StoredAttachment[] = [];

      for (const entry of attachments) {
        if (!isPlainObject(entry)) {
          // Unrecognized shape — drop so the row stops carrying junk.
          result.dropped += 1;
          continue;
        }

        const hasFileId =
          typeof entry.fileId === "string" && entry.fileId.length > 0;
        if (hasFileId) {
          // Already on the new shape. If a partial migration ever left a
          // base64 `data:` URL on a record that also has a fileId, strip
          // that legacy `url` here so we honor the "no raw base64 remains"
          // guarantee — the fileId/fileUrl pair is the source of truth.
          const cleaned: RawAttachment = { ...entry };
          if (parseDataUrl(cleaned.url) !== null) {
            delete cleaned.url;
            result.changed = true;
          }
          result.alreadyConverted += 1;
          newAttachments.push(cleaned as unknown as StoredAttachment);
          continue;
        }

        const dataUrl = parseDataUrl(entry.url);
        if (!dataUrl) {
          // Legacy shape but URL is not a base64 data URL (e.g. external
          // http(s) link). Out of scope for this backfill; leave it alone.
          newAttachments.push(entry as unknown as StoredAttachment);
          continue;
        }

        let buffer: Buffer;
        try {
          buffer = Buffer.from(dataUrl.data, "base64");
        } catch {
          // Malformed base64 — drop so we don't carry an unreadable entry.
          result.dropped += 1;
          continue;
        }

        if (buffer.length === 0) {
          result.dropped += 1;
          continue;
        }

        const originalName = safeName(entry.name);
        const mimeType = safeMime(entry.mimeType, dataUrl.mime);
        const storedFileName = buildStoredFileName(originalName);
        const uploadPath = buildUploadPath({
          jobId: `daily-log-${row.dailyLogId}-comments`,
          mediaType: "photo",
          storedFileName,
        });

        await storage.write(uploadPath.fileUrl, buffer, {
          contentType: mimeType,
        });
        writtenUrls.push(uploadPath.fileUrl);

        const [createdFile] = await tx
          .insert(files)
          .values({
            folderId: folder.id,
            filename: storedFileName,
            originalName,
            fileUrl: uploadPath.fileUrl,
            fileSize: buffer.length,
            mimeType,
            // Comments can outlive their author (createdBy is set null on
            // user delete); persist whatever we have so the audit trail
            // matches the comment row.
            uploadedBy: row.createdBy,
          })
          .returning({ id: files.id });

        newAttachments.push({
          fileId: createdFile.id,
          fileUrl: uploadPath.fileUrl,
          name: originalName,
          mimeType,
        });

        result.converted += 1;
      }

      await tx
        .update(dailyLogComments)
        .set({
          attachments: newAttachments,
          // Don't touch updatedAt — this is a backfill, not an edit; the
          // user-visible "edited at" should not change.
        })
        .where(eq(dailyLogComments.id, row.id));

      result.changed = true;
    });
  } catch (error) {
    // Storage rollback: anything we wrote inside the failed transaction
    // is now orphaned. Best-effort delete; the next run will re-process
    // the row from a clean slate.
    for (const fileUrl of writtenUrls) {
      try {
        await storage.delete(fileUrl);
      } catch {
        // deletePhysicalFile already swallows + logs failures, but guard
        // here too in case a custom StorageWriter is stricter.
      }
    }
    throw error;
  }

  return result;
}

export async function backfillCommentAttachments(
  storage: StorageWriter = realStorage,
): Promise<BackfillStats> {
  const stats: BackfillStats = {
    commentsScanned: 0,
    commentsConverted: 0,
    commentsSkipped: 0,
    attachmentsConverted: 0,
    attachmentsAlreadyConverted: 0,
    attachmentsDropped: 0,
    rowFailures: 0,
  };

  // Pull the candidate rows in one shot. The comments table is small enough
  // (per-daily-log) that materializing all rows with a non-empty attachments
  // array fits comfortably in memory; if that ever changes, switch to a
  // cursor-based scan.
  const rows = await db
    .select({
      id: dailyLogComments.id,
      dailyLogId: dailyLogComments.dailyLogId,
      createdBy: dailyLogComments.createdBy,
      attachments: dailyLogComments.attachments,
    })
    .from(dailyLogComments)
    .where(isNull(dailyLogComments.deletedAt));

  for (const row of rows) {
    stats.commentsScanned += 1;
    try {
      const result = await processCommentRow(row, storage);
      stats.attachmentsConverted += result.converted;
      stats.attachmentsAlreadyConverted += result.alreadyConverted;
      stats.attachmentsDropped += result.dropped;
      if (result.changed) {
        stats.commentsConverted += 1;
      } else {
        stats.commentsSkipped += 1;
      }
    } catch (error) {
      stats.rowFailures += 1;
      console.error(
        `[backfill-comment-attachments] failed to process comment ${row.id}:`,
        error,
      );
    }
  }

  return stats;
}

async function main() {
  console.log("[backfill-comment-attachments] starting");
  const stats = await backfillCommentAttachments();
  console.log("[backfill-comment-attachments] done", stats);
  if (stats.rowFailures > 0) {
    process.exitCode = 1;
  }
}

const isDirectInvocation = (() => {
  // tsx/node both expose the executed entrypoint via process.argv[1]. When
  // this file is imported (e.g. from a test) we want to skip main().
  const entry = process.argv[1] ?? "";
  return entry.endsWith("backfill-comment-attachments.ts") ||
    entry.endsWith("backfill-comment-attachments.js") ||
    entry.endsWith("backfill-comment-attachments.mjs");
})();

if (isDirectInvocation) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
