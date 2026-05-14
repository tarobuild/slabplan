#!/usr/bin/env node
/**
 * Supabase Storage restore drill.
 *
 * Lists the first N objects under the cadstone uploads prefix, downloads the
 * smallest one, re-uploads it under cadstone/restore-drill/ to prove the
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

const storage = createSupabaseStorage();
const cadstoneUploadsPrefix = uploadsObjectPrefix();
const drillPrefix = "cadstone/restore-drill";

async function listSome() {
  console.log(
    `[list] bucket=${storage.bucketName} prefix=${cadstoneUploadsPrefix}`,
  );
  const files = await storage.listAllObjects(cadstoneUploadsPrefix, {
    maxObjects: 25,
  });
  console.log(`[list] returned=${files.length}`);
  for (const f of files.slice(0, 5)) {
    console.log(
      `  - ${f.name}  (size=${f.metadata?.size ?? "?"} bytes)`,
    );
  }
  return files;
}

async function downloadOne(file) {
  const start = Date.now();
  const buf = await storage.downloadBuffer(file.name);
  console.log(
    `[download] ${file.name}  ${buf.length} bytes  in ${Date.now() - start}ms`,
  );
  return buf;
}

async function reuploadAndVerify(originalFile, buf) {
  const ts =
    new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const targetName = `${drillPrefix}/roundtrip-${ts}.bin`;
  console.log(`[reupload] target=${targetName}`);
  const start = Date.now();
  await storage.uploadBuffer(targetName, buf, {
    contentType:
      originalFile.metadata?.mimetype ??
      originalFile.metadata?.contentType ??
      "application/octet-stream",
  });
  console.log(`[reupload] uploaded ${buf.length} bytes in ${Date.now() - start}ms`);

  const exists = await storage.objectExists(targetName);
  console.log(`[verify] target exists: ${exists}`);
  if (!exists) throw new Error("re-uploaded object missing immediately after upload");

  const downBuf = await storage.downloadBuffer(targetName);
  const equal = downBuf.equals(buf);
  console.log(`[verify] re-downloaded size=${downBuf.length}, equal=${equal}`);
  if (!equal) throw new Error("re-uploaded object bytes did not match original");

  return targetName;
}

async function cleanup(targetName) {
  await storage.deleteObject(targetName);
  console.log(`[cleanup] deleted ${targetName}`);
}

(async () => {
  const files = await listSome();
  if (files.length === 0) {
    console.log("[drill] no files in uploads prefix; nothing to round-trip");
    return;
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
  const buf = await downloadOne(pick);
  const targetName = await reuploadAndVerify(pick, buf);
  await cleanup(targetName);
  console.log("---");
  console.log(
    JSON.stringify(
      {
        ok: true,
        listed: files.length,
        downloaded: { name: pick.name, bytes: buf.length },
        reuploaded: targetName,
        cleanedUp: true,
      },
      null,
      2,
    ),
  );
})().catch((err) => {
  console.error("DRILL FAILED:", err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
