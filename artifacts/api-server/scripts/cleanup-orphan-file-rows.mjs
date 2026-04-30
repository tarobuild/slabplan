/**
 * cleanup-orphan-file-rows.mjs — remove `files` rows whose underlying
 * object in the cadstone uploads bucket no longer exists.
 *
 * Context: on 2026-04-30 the GCS uploads prefix was emptied as part of
 * the account-cleanup task (see docs/runbook.md § 9, 2026-04-30 entry),
 * but the database was deliberately left intact. The result is that
 * `files` rows from before the wipe still point at storage keys that
 * 404, and any UI that tries to render them shows broken thumbnails /
 * "couldn't load file" tiles.
 *
 * What this script does:
 *   1. SELECT every `files` row created on/before --cutoff (default
 *      2026-05-01 UTC; pre-cutoff is the "before the wipe" cohort).
 *   2. Probe each row's storage object via the same App Storage sidecar
 *      that `src/lib/storage.ts` uses.
 *   3. Hard-delete the rows whose object is missing. Foreign keys on
 *      `file_annotations.file_id`, `lead_attachments.file_id`,
 *      `daily_log_attachments.file_id`, and
 *      `schedule_item_attachments.file_id` all `ON DELETE CASCADE`,
 *      so the dependent rows are removed automatically. We still count
 *      them up-front so the operator can see what is going away.
 *   4. Report counts and exit. The deletion runs in a single
 *      transaction so a failure mid-way rolls back to no-op.
 *
 * Why hard-delete and not soft-delete:
 *   - The list/serve paths already hide rows where `deleted_at IS NOT
 *     NULL`, but soft-deleted files re-surface inside the trash UI and
 *     can be "restored" — which would just put a broken tile back in
 *     front of Cesar / Anwar.
 *   - The runbook § 9 follow-up note explicitly recommends *deleting*
 *     these orphan rows.
 *   - There is no recovery path for the underlying object (runbook
 *     § 6.2 — no off-Replit copy exists), so keeping the metadata adds
 *     no value.
 *
 * Usage:
 *   node artifacts/api-server/scripts/cleanup-orphan-file-rows.mjs \
 *     --db=production --i-know-what-im-doing
 *
 *   node artifacts/api-server/scripts/cleanup-orphan-file-rows.mjs \
 *     --db=production --dry-run
 *
 *   node artifacts/api-server/scripts/cleanup-orphan-file-rows.mjs \
 *     --db=local --dry-run
 *
 * Required flags:
 *   --db=local        connect to the local database (DATABASE_URL).
 *   --db=production   connect to the live database
 *                     (SUPABASE_DATABASE_URL). Writes also require
 *                     --i-know-what-im-doing.
 *
 * Optional flags:
 *   --dry-run         classify rows but do not DELETE. Always allowed
 *                     against production.
 *   --cutoff=YYYY-MM-DDTHH:MM:SSZ
 *                     only consider files with `created_at <= cutoff`.
 *                     Default `2026-05-01T00:00:00Z` so post-wipe
 *                     uploads are out of scope (see task doc).
 *
 * Safety properties:
 *   - Reads first, prints a per-row plan, then writes. On --db=production
 *     pauses 3 s before the DELETE so an operator can Ctrl-C.
 *   - DELETE runs inside one transaction; either every orphan row goes
 *     or nothing does.
 *   - Storage probe uses GCS `file.exists()` with `ignoreNotFound`-style
 *     semantics (a missing object is a clean `false`, a transient API
 *     error is treated as "unknown" and the row is LEFT ALONE — we
 *     never delete a row on the basis of a network blip).
 *   - The bucket itself is never touched by this script.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Storage } from "@google-cloud/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(
  path.resolve(__dirname, "../../../lib/db/package.json"),
);
const { Client } = dbRequire("pg");

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const PRODUCTION_PAUSE_MS = 3000;
const DEFAULT_CUTOFF = "2026-05-01T00:00:00Z";

const TARGETS = {
  local: { label: "LOCAL", envVar: "DATABASE_URL" },
  production: { label: "PRODUCTION", envVar: "SUPABASE_DATABASE_URL" },
};

function parseArgs(argv) {
  let db = null;
  let confirmed = false;
  let dryRun = false;
  let cutoff = DEFAULT_CUTOFF;
  for (const arg of argv) {
    if (arg === "--db=local") db = "local";
    else if (arg === "--db=production") db = "production";
    else if (arg.startsWith("--db=")) {
      throw new Error(
        `Unknown --db value: ${arg}. Expected --db=local or --db=production.`,
      );
    } else if (arg === "--i-know-what-im-doing") confirmed = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--cutoff=")) cutoff = arg.slice("--cutoff=".length);
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!db) {
    throw new Error(
      "Missing required --db flag. Pass --db=local or --db=production.",
    );
  }
  if (db === "production" && !dryRun && !confirmed) {
    throw new Error(
      "Refusing to DELETE in PRODUCTION without --i-know-what-im-doing. " +
        "Re-run with both --db=production and --i-know-what-im-doing, or " +
        "add --dry-run to inspect without writing.",
    );
  }
  if (Number.isNaN(Date.parse(cutoff))) {
    throw new Error(`Invalid --cutoff value: ${cutoff}`);
  }
  return { db, dryRun, cutoff };
}

function makeStorageClient() {
  return new Storage({
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
}

function fileUrlToObject(fileUrl, bucketId, privateDir) {
  // Mirrors src/lib/storage.ts:fileUrlToObject so this script and the
  // serve path agree on which object backs which DB row.
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("Stored file URL is missing.");
  }
  const match = /^\/uploads\/(.+)$/.exec(fileUrl);
  if (!match) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  const relative = match[1];
  if (relative.includes("..") || relative.startsWith("/") || relative.includes("\0")) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  // privateDir is "/<bucketId>/<prefix>" — strip the leading bucket
  // segment so the result matches storage.ts.
  const normalized = privateDir.startsWith("/") ? privateDir : `/${privateDir}`;
  const parts = normalized.split("/").filter(Boolean);
  const prefix = parts.slice(1).join("/");
  const segments = [prefix, "cadstone", "uploads", relative].filter(Boolean);
  return { bucketName: bucketId, objectName: segments.join("/") };
}

async function classifyRows({ rows, bucket, bucketId, privateDir }) {
  const orphans = [];
  const present = [];
  const indeterminate = [];

  for (const row of rows) {
    if (!row.file_url) {
      // No storage key recorded at all — there is nothing for the serve
      // path to fetch. Treat as orphaned so the broken tile goes away.
      orphans.push({ row, reason: "no file_url recorded" });
      continue;
    }

    let objectName;
    try {
      ({ objectName } = fileUrlToObject(row.file_url, bucketId, privateDir));
    } catch (error) {
      // Malformed file_url — the serve path will already throw. Treat
      // as orphan since it can never load.
      orphans.push({
        row,
        reason: `invalid file_url (${error.message ?? error})`,
      });
      continue;
    }

    try {
      const [exists] = await bucket.file(objectName).exists();
      if (exists) {
        present.push({ row, objectName });
      } else {
        orphans.push({ row, reason: `object missing (${objectName})` });
      }
    } catch (error) {
      // Network/transient — DO NOT delete on uncertainty.
      indeterminate.push({
        row,
        objectName,
        error: error?.message ?? String(error),
      });
    }
  }

  return { orphans, present, indeterminate };
}

async function countDependents(client, orphanIds) {
  if (orphanIds.length === 0) {
    return {
      file_annotations: 0,
      lead_attachments: 0,
      daily_log_attachments: 0,
      schedule_item_attachments: 0,
    };
  }
  const counts = {};
  for (const tableName of [
    "file_annotations",
    "lead_attachments",
    "daily_log_attachments",
    "schedule_item_attachments",
  ]) {
    const r = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM "${tableName}" WHERE file_id = ANY($1::uuid[])`,
      [orphanIds],
    );
    counts[tableName] = Number(r.rows[0].n);
  }
  return counts;
}

async function main() {
  const { db, dryRun, cutoff } = parseArgs(process.argv.slice(2));
  const target = TARGETS[db];

  const connectionString = process.env[target.envVar];
  if (!connectionString) {
    throw new Error(
      `${target.envVar} must be set to inspect the ${target.label} database.`,
    );
  }
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!bucketId || !privateDir) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR must both be " +
        "set so the storage probe matches the runtime serve path.",
    );
  }
  // Runtime `src/lib/storage.ts` derives the bucket from the *first
  // segment* of PRIVATE_OBJECT_DIR — not from DEFAULT_OBJECT_STORAGE_BUCKET_ID
  // — so if the two ever drift this script could otherwise probe a
  // bucket the serve path never touches and falsely flag every row as
  // orphaned. Assert they agree before doing anything destructive.
  const privateDirNormalized = privateDir.startsWith("/")
    ? privateDir
    : `/${privateDir}`;
  const privateDirBucket = privateDirNormalized.split("/").filter(Boolean)[0];
  if (privateDirBucket !== bucketId) {
    throw new Error(
      `PRIVATE_OBJECT_DIR bucket segment (${privateDirBucket}) does not ` +
        `match DEFAULT_OBJECT_STORAGE_BUCKET_ID (${bucketId}). Refusing to ` +
        `probe — fix the env config first.`,
    );
  }

  console.log(`Target: ${target.label} (${target.envVar})`);
  console.log(`Bucket: ${bucketId}`);
  console.log(`Cutoff (created_at <=): ${cutoff}`);
  console.log(`Mode:   ${dryRun ? "DRY-RUN (no writes)" : "WRITE"}`);

  const storage = makeStorageClient();
  const bucket = storage.bucket(bucketId);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, folder_id, original_name, file_url, deleted_at, created_at
         FROM files
        WHERE created_at <= $1::timestamptz
        ORDER BY created_at ASC, id ASC`,
      [cutoff],
    );
    console.log(`\nInspecting ${rows.length} pre-cutoff files row(s)…`);

    const { orphans, present, indeterminate } = await classifyRows({
      rows,
      bucket,
      bucketId,
      privateDir,
    });

    console.log(
      `  present:        ${present.length}  (storage object exists)`,
    );
    console.log(
      `  orphan:         ${orphans.length}  (storage object missing or unrecoverable)`,
    );
    console.log(
      `  indeterminate:  ${indeterminate.length}  (probe failed — left alone)`,
    );

    if (indeterminate.length > 0) {
      console.log("\nIndeterminate rows (NOT deleted — re-run later):");
      for (const item of indeterminate) {
        console.log(
          `  ${item.row.id}  ${item.objectName}  → ${item.error}`,
        );
      }
    }

    if (orphans.length === 0) {
      console.log("\nNothing to delete. Done.");
      return;
    }

    const orphanIds = orphans.map((o) => o.row.id);
    const dependentCounts = await countDependents(client, orphanIds);

    console.log("\nOrphan files to remove:");
    for (const { row, reason } of orphans) {
      console.log(
        `  ${row.id}  ${row.original_name}  (${reason})` +
          (row.deleted_at ? "  [already soft-deleted]" : ""),
      );
    }
    console.log("\nDependent rows that will cascade-delete:");
    for (const [name, n] of Object.entries(dependentCounts)) {
      console.log(`  ${String(n).padStart(4)}  ${name}`);
    }

    if (dryRun) {
      console.log("\n--dry-run set — no DELETE issued.");
      return;
    }

    if (target.label === "PRODUCTION") {
      console.log(
        `\nPausing ${PRODUCTION_PAUSE_MS}ms before DELETE — Ctrl-C now to abort.`,
      );
      await sleep(PRODUCTION_PAUSE_MS);
    }

    await client.query("BEGIN");
    let committed = false;
    try {
      // Explicit DELETE on dependents first so the transaction returns
      // accurate counts even though the FKs would cascade. (We capture
      // these into the runbook entry.)
      const annDel = await client.query(
        `DELETE FROM file_annotations WHERE file_id = ANY($1::uuid[])`,
        [orphanIds],
      );
      const leadDel = await client.query(
        `DELETE FROM lead_attachments WHERE file_id = ANY($1::uuid[])`,
        [orphanIds],
      );
      const dailyDel = await client.query(
        `DELETE FROM daily_log_attachments WHERE file_id = ANY($1::uuid[])`,
        [orphanIds],
      );
      const schedDel = await client.query(
        `DELETE FROM schedule_item_attachments WHERE file_id = ANY($1::uuid[])`,
        [orphanIds],
      );
      const filesDel = await client.query(
        `DELETE FROM files WHERE id = ANY($1::uuid[])`,
        [orphanIds],
      );

      // Verify the rows are actually gone.
      const verify = await client.query(
        `SELECT COUNT(*)::bigint AS n FROM files WHERE id = ANY($1::uuid[])`,
        [orphanIds],
      );
      if (Number(verify.rows[0].n) !== 0) {
        throw new Error(
          `Verification failed: ${verify.rows[0].n} orphan files still present after DELETE.`,
        );
      }

      await client.query("COMMIT");
      committed = true;

      console.log("\nDELETE committed:");
      console.log(`  files:                       ${filesDel.rowCount}`);
      console.log(`  file_annotations:            ${annDel.rowCount}`);
      console.log(`  lead_attachments:            ${leadDel.rowCount}`);
      console.log(`  daily_log_attachments:       ${dailyDel.rowCount}`);
      console.log(`  schedule_item_attachments:   ${schedDel.rowCount}`);

      console.log("\n---");
      console.log(
        JSON.stringify(
          {
            target: target.label,
            cutoff,
            inspected: rows.length,
            present: present.length,
            indeterminate: indeterminate.length,
            deleted: {
              files: filesDel.rowCount,
              file_annotations: annDel.rowCount,
              lead_attachments: leadDel.rowCount,
              daily_log_attachments: dailyDel.rowCount,
              schedule_item_attachments: schedDel.rowCount,
            },
          },
          null,
          2,
        ),
      );
    } finally {
      if (!committed) {
        await client.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("cleanup-orphan-file-rows failed:", error.message ?? error);
  if (error?.stack) console.error(error.stack);
  process.exitCode = 1;
});
