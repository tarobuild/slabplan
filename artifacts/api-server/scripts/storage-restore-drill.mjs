#!/usr/bin/env node
/**
 * Supabase Storage restore drill.
 *
 * Lists the first N objects under the Stone Track uploads prefix, downloads the
 * smallest one, re-uploads it under stone-track/restore-drill/ to prove the
 * round-trip works, verifies bytes match, then deletes the round-trip object
 * so no test cruft is left in the live bucket.
 *
 * Required env:
 *   - SUPABASE_URL
 *   - SUPABASE_STORAGE_BUCKET
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Documented in: docs/runbook.md (§ Restore drill, § Recovery procedure §3)
 */
import {
  createSupabaseStorage,
  uploadsObjectPrefix,
} from "./lib/supabase-storage.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const drillPrefix = "stone-track/restore-drill";

export function makeRestoreDrillTargetName(now = new Date()) {
  const ts = now.toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  return `${drillPrefix}/roundtrip-${ts}.bin`;
}

export async function listSome(storage, stoneTrackUploadsPrefix, log = console.log) {
  log(
    `[list] bucket=${storage.bucketName} prefix=${stoneTrackUploadsPrefix}`,
  );
  const files = await storage.listAllObjects(stoneTrackUploadsPrefix, {
    maxObjects: 25,
  });
  log(`[list] returned=${files.length}`);
  for (const f of files.slice(0, 5)) {
    log(
      `  - ${f.name}  (size=${f.metadata?.size ?? "?"} bytes)`,
    );
  }
  return files;
}

export async function downloadOne(storage, file, log = console.log) {
  const start = Date.now();
  const buf = await storage.downloadBuffer(file.name);
  log(
    `[download] ${file.name}  ${buf.length} bytes  in ${Date.now() - start}ms`,
  );
  return buf;
}

export async function reuploadAndVerify(
  storage,
  originalFile,
  buf,
  {
    now = new Date(),
    log = console.log,
    onTargetName = () => {},
    onUploadComplete = () => {},
  } = {},
) {
  const targetName = makeRestoreDrillTargetName(now);
  onTargetName(targetName);
  log(`[reupload] target=${targetName}`);
  const start = Date.now();
  await storage.uploadBuffer(targetName, buf, {
    contentType:
      originalFile.metadata?.mimetype ??
      originalFile.metadata?.contentType ??
      "application/octet-stream",
  });
  onUploadComplete(targetName);
  log(`[reupload] uploaded ${buf.length} bytes in ${Date.now() - start}ms`);

  const exists = await storage.objectExists(targetName);
  log(`[verify] target exists: ${exists}`);
  if (!exists) throw new Error("re-uploaded object missing immediately after upload");

  const downBuf = await storage.downloadBuffer(targetName);
  const equal = downBuf.equals(buf);
  log(`[verify] re-downloaded size=${downBuf.length}, equal=${equal}`);
  if (!equal) throw new Error("re-uploaded object bytes did not match original");

  return targetName;
}

export async function cleanup(storage, targetName, log = console.log) {
  await storage.deleteObject(targetName);
  log(`[cleanup] deleted ${targetName}`);
}

export async function runRestoreDrill({
  storage = createSupabaseStorage(),
  log = console.log,
  error = console.error,
  now = new Date(),
} = {}) {
  const stoneTrackUploadsPrefix = uploadsObjectPrefix();
  let targetName = null;
  let uploadSucceeded = false;
  let cleanedUp = false;
  let result = null;
  let primaryError = null;
  let cleanupError = null;

  try {
    const files = await listSome(storage, stoneTrackUploadsPrefix, log);
    if (files.length === 0) {
      log("[drill] no files in uploads prefix; nothing to round-trip");
      return null;
    }
    // Smallest non-empty file <= 5 MB, so the drill stays fast and cheap.
    const candidates = files
      .filter((f) => {
        const n = Number(f.metadata?.size ?? 0);
        return n > 0 && n < 5_000_000;
      })
      .sort(
        (a, b) => Number(a.metadata?.size ?? 0) - Number(b.metadata?.size ?? 0),
      );
    const pick = candidates[0] ?? files[0];
    const buf = await downloadOne(storage, pick, log);
    targetName = await reuploadAndVerify(storage, pick, buf, {
      now,
      log,
      onTargetName: (name) => {
        targetName = name;
      },
      onUploadComplete: () => {
        uploadSucceeded = true;
      },
    });
    await cleanup(storage, targetName, log);
    cleanedUp = true;
    log("---");
    result = {
      ok: true,
      listed: files.length,
      downloaded: { name: pick.name, bytes: buf.length },
      reuploaded: targetName,
      cleanedUp: true,
    };
    log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );
  } catch (err) {
    primaryError = err;
  } finally {
    if (targetName && uploadSucceeded && !cleanedUp) {
      try {
        await cleanup(storage, targetName, log);
        cleanedUp = true;
      } catch (err) {
        cleanupError = err;
        error(
          `[cleanup] failed to delete restore drill object ${targetName}: ${
            err?.message ?? err
          }`,
        );
      }
    }
  }

  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `restore drill failed and cleanup also failed for ${targetName}`,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result;
}

async function main() {
  await runRestoreDrill();
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error("DRILL FAILED:", err?.message ?? err);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  });
}
