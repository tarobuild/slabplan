#!/usr/bin/env node
/**
 * Object-storage restore drill.
 *
 * Lists the first N objects under the cadstone private prefix, downloads
 * the smallest one, re-uploads it under .private/cadstone/restore-drill/
 * to prove the round-trip works, verifies bytes match, then deletes the
 * round-trip object so no test cruft is left in the live bucket.
 *
 * Mirrors the auth pattern in src/lib/storage.ts so this script always
 * uses the same credentials as the production API server.
 *
 * Run from this directory or anywhere the api-server's node_modules are
 * resolvable:
 *
 *   node artifacts/api-server/scripts/storage-restore-drill.mjs
 *
 * Required env (already set in the Repl):
 *   - DEFAULT_OBJECT_STORAGE_BUCKET_ID
 *   - PRIVATE_OBJECT_DIR
 *
 * Documented in: docs/runbook.md (§ Restore drill, § Recovery procedure §3)
 */
import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const privateDir = process.env.PRIVATE_OBJECT_DIR;

if (!bucketId || !privateDir) {
  console.error(
    "Missing DEFAULT_OBJECT_STORAGE_BUCKET_ID or PRIVATE_OBJECT_DIR in env.",
  );
  process.exit(2);
}

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

const bucket = storage.bucket(bucketId);
// PRIVATE_OBJECT_DIR is shaped like "/<bucketId>/.private"; strip the bucket
// prefix to get a GCS-relative key prefix.
const cadstonePrivatePrefix =
  privateDir.replace(`/${bucketId}/`, "") + "/cadstone/";
const drillPrefix =
  privateDir.replace(`/${bucketId}/`, "") + "/cadstone/restore-drill/";

async function listSome() {
  console.log(`[list] bucket=${bucketId} prefix=${cadstonePrivatePrefix}`);
  const [files] = await bucket.getFiles({
    prefix: cadstonePrivatePrefix,
    maxResults: 25,
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
  const [buf] = await file.download();
  console.log(
    `[download] ${file.name}  ${buf.length} bytes  in ${Date.now() - start}ms`,
  );
  return buf;
}

async function reuploadAndVerify(originalFile, buf) {
  const ts =
    new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const targetName = `${drillPrefix}roundtrip-${ts}.bin`;
  console.log(`[reupload] target=${targetName}`);
  const target = bucket.file(targetName);
  const start = Date.now();
  await target.save(buf, {
    resumable: false,
    contentType:
      originalFile.metadata?.contentType ?? "application/octet-stream",
    metadata: {
      metadata: {
        "cadstone-restore-drill": "true",
        "cadstone-source-object": originalFile.name,
        "cadstone-drill-timestamp": ts,
      },
    },
  });
  console.log(`[reupload] uploaded ${buf.length} bytes in ${Date.now() - start}ms`);

  const [exists] = await target.exists();
  console.log(`[verify] target exists: ${exists}`);
  if (!exists) throw new Error("re-uploaded object missing immediately after save()");

  const [downBuf] = await target.download();
  const equal = downBuf.equals(buf);
  console.log(`[verify] re-downloaded size=${downBuf.length}, equal=${equal}`);
  if (!equal) throw new Error("re-uploaded object bytes did not match original");

  return target;
}

async function cleanup(target) {
  await target.delete();
  console.log(`[cleanup] deleted ${target.name}`);
}

(async () => {
  const files = await listSome();
  if (files.length === 0) {
    console.log("[drill] no files in private bucket prefix; nothing to round-trip");
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
  const target = await reuploadAndVerify(pick, buf);
  await cleanup(target);
  console.log("---");
  console.log(
    JSON.stringify(
      {
        ok: true,
        listed: files.length,
        downloaded: { name: pick.name, bytes: buf.length },
        reuploaded: target.name,
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
