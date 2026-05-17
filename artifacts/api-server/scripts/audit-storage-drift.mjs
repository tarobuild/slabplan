/**
 * audit-storage-drift.mjs — read-only check that the `files` table and
 * the Supabase Storage uploads bucket agree on what exists.
 *
 * Why this script exists:
 *   The 26 orphan rows cleaned up on 2026-04-30 (see docs/runbook.md
 *   § 9 "Cleared orphan file rows…") only came to light because a
 *   previous task explicitly noted them as a follow-up risk in the
 *   runbook. Without an automated check, the next round of drift —
 *   a partial bucket delete, a botched migration, a half-finished
 *   restore drill, a manual fix-up that forgets one side — would
 *   again surface as a broken thumbnail in front of Cesar / Anwar
 *   before anyone noticed.
 *
 *   This script is the unattended early-warning system. It is run on
 *   a Replit Scheduled Deployment (weekly) against production. It
 *   never writes — to either the database or the bucket — so it is
 *   safe to run at any cadence. See runbook § 9 "Weekly storage drift
 *   audit" for the schedule and alert wiring.
 *
 * What it does:
 *   1. SELECT every row in `files` (both live and soft-deleted; soft-
 *      deleted rows are restorable from the trash UI, and a restore
 *      against a missing object is exactly the broken-tile scenario
 *      we want to prevent).
 *   2. List every object in the bucket under `stone-track/uploads/`.
 *   3. Compare the two sides and report:
 *        - db_only   : `files` rows whose object is missing from the
 *                      bucket (the same condition cleanup-orphan-file-
 *                      rows.mjs deletes when run with --i-know-what-
 *                      im-doing).
 *        - bucket_only: bucket objects with no `files` row pointing at
 *                      them (a leak — the upload happened but the row
 *                      that lets the UI find it is gone or was never
 *                      written).
 *   4. Always print a JSON summary to stdout.
 *   5. If either side is non-zero, exit 1 AND emit a pino-style
 *      `"level":50` log line. The api-server's existing Replit
 *      Deployments alert in runbook § 2a ("Unhandled error") matches
 *      `"level":50`, so when this script runs as a scheduled deploy
 *      configured against the same alert channel, an email lands in
 *      Cesar + Anwar's inbox automatically.
 *
 * What it does NOT do:
 *   - It never DELETEs. Fixing drift is a deliberate operator action
 *     (run cleanup-orphan-file-rows.mjs with --i-know-what-im-doing
 *     for the db→bucket direction; investigate the bucket→db direction
 *     by hand because the right fix depends on whether the file was
 *     deleted on purpose or the row was lost).
 *   - It never touches the bucket at all beyond listing keys.
 *   - It does not consider any prefix outside `stone-track/uploads/`.
 *
 * Usage:
 *   node artifacts/api-server/scripts/audit-storage-drift.mjs --db=production
 *   node artifacts/api-server/scripts/audit-storage-drift.mjs --db=local
 *   node artifacts/api-server/scripts/audit-storage-drift.mjs --db=production --json
 *
 * Required flags:
 *   --db=local        connect to the local database (DATABASE_URL).
 *   --db=production   connect to the live database
 *                     (SUPABASE_DATABASE_URL).
 *
 *   No --i-know-what-im-doing flag is required because the script
 *   never writes. --dry-run is intentionally not accepted either, for
 *   the same reason: there is no non-dry mode.
 *
 * Optional flags:
 *   --json            emit only the JSON summary on stdout (no human
 *                     prelude). Useful for piping into other tools.
 *   --max-bucket-objects=N
 *                     fail fast if the bucket has more than N objects
 *                     under the Stone Track uploads prefix. Defaults to
 *                     500_000 — well above any plausible Stone Track
 *                     fleet size, but low enough that a runaway
 *                     listing doesn't burn the scheduled job's
 *                     wall-clock budget.
 *
 * Exit codes:
 *   0 — sides agree, no drift.
 *   1 — drift detected (db_only > 0 or bucket_only > 0). Also emits
 *       the `"level":50` line so the existing alert fires.
 *   2 — could not complete the audit (DB unreachable, bucket listing
 *       failed, env misconfigured, etc.). Treated as "unknown — try
 *       again next run". Also emits `"level":50` so an operator
 *       notices.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSupabaseStorage,
  fileUrlToObjectName,
  objectNameToFileUrl,
  uploadsObjectPrefix,
} from "./lib/supabase-storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(
  path.resolve(__dirname, "../../../lib/db/package.json"),
);
const { Client } = dbRequire("pg");

const DEFAULT_MAX_BUCKET_OBJECTS = 500_000;

const TARGETS = {
  local: { label: "LOCAL", envVar: "DATABASE_URL" },
  production: { label: "PRODUCTION", envVar: "SUPABASE_DATABASE_URL" },
};

export function parseArgs(argv) {
  let db = null;
  let format = "human";
  let maxBucketObjects = DEFAULT_MAX_BUCKET_OBJECTS;
  for (const arg of argv) {
    if (arg === "--db=local") db = "local";
    else if (arg === "--db=production") db = "production";
    else if (arg.startsWith("--db=")) {
      throw new Error(
        `Unknown --db value: ${arg}. Expected --db=local or --db=production.`,
      );
    } else if (arg === "--json") {
      format = "json";
    } else if (arg.startsWith("--max-bucket-objects=")) {
      const raw = arg.slice("--max-bucket-objects=".length);
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new Error(
          `Invalid --max-bucket-objects value: ${raw}. Must be a positive integer.`,
        );
      }
      maxBucketObjects = n;
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  if (!db) {
    throw new Error(
      "Missing required --db flag. Pass --db=local or --db=production.",
    );
  }
  return { db, format, maxBucketObjects };
}

export { fileUrlToObjectName, objectNameToFileUrl, uploadsObjectPrefix };

export function diffSides({ dbFileUrls, bucketFileUrls }) {
  // Returns { dbOnly, bucketOnly } as sorted arrays of fileUrl
  // strings. Sorting is stable so the JSON summary is reproducible
  // across runs (helps downstream diffing of report-to-report
  // changes).
  const dbSet = new Set(dbFileUrls);
  const bucketSet = new Set(bucketFileUrls);
  const dbOnly = [];
  const bucketOnly = [];
  for (const url of dbSet) {
    if (!bucketSet.has(url)) dbOnly.push(url);
  }
  for (const url of bucketSet) {
    if (!dbSet.has(url)) bucketOnly.push(url);
  }
  dbOnly.sort();
  bucketOnly.sort();
  return { dbOnly, bucketOnly };
}

async function loadDbFileUrls(client) {
  // We deliberately include soft-deleted rows. They are restorable
  // from the trash UI and would render as broken tiles if the
  // underlying object is gone — which is the exact scenario this
  // audit is meant to catch ahead of time.
  const { rows } = await client.query(
    `SELECT id, file_url, deleted_at
       FROM files
      WHERE file_url IS NOT NULL`,
  );
  return rows.map((r) => ({
    id: r.id,
    fileUrl: r.file_url,
    deletedAt: r.deleted_at,
  }));
}

function emitAlertLine({ msg, payload }) {
  // Pino "error" level == 50. The api-server's existing Replit
  // Deployments alert (runbook § 2a "Unhandled error") matches the
  // literal substring `"level":50`, so this single line is what
  // triggers the email to Cesar + Anwar when drift is found. The
  // exact JSON shape is incidental — only `"level":50` and a
  // human-readable `msg` are load-bearing for the alert.
  const line = JSON.stringify({
    level: 50,
    time: Date.now(),
    msg,
    ...payload,
  });
  // eslint-disable-next-line no-console
  console.error(line);
}

async function runAudit({ db, format, maxBucketObjects }) {
  const target = TARGETS[db];
  const connectionString = process.env[target.envVar];
  if (!connectionString) {
    throw new Error(
      `${target.envVar} must be set to inspect the ${target.label} database.`,
    );
  }
  const storage = createSupabaseStorage();

  if (format === "human") {
    // eslint-disable-next-line no-console
    console.log(`Target:  ${target.label} (${target.envVar})`);
    // eslint-disable-next-line no-console
    console.log(`Bucket:  ${storage.bucketName}`);
    // eslint-disable-next-line no-console
    console.log(`Prefix:  ${uploadsObjectPrefix()}`);
    // eslint-disable-next-line no-console
    console.log(`Mode:    AUDIT (read-only)`);
  }

  const client = new Client({ connectionString });
  await client.connect();
  let dbRows;
  let listResult;
  try {
    dbRows = await loadDbFileUrls(client);
    const objects = await storage.listAllObjects(uploadsObjectPrefix(), {
      maxObjects: maxBucketObjects,
    });
    listResult = {
      objectNames: objects.map((object) => object.name),
      prefix: uploadsObjectPrefix(),
    };
  } finally {
    await client.end();
  }

  // Build the comparable string sets. For db_only we count file_url
  // values that the serve path would try to fetch. We translate
  // bucket object names back to the same `/uploads/...` shape so the
  // comparison is symmetric.
  const dbFileUrls = [];
  const dbInvalid = [];
  for (const row of dbRows) {
    try {
      // Re-validate the URL by round-tripping it through
      // fileUrlToObjectName. A throw here means the row's file_url
      // is malformed — the serve path would 500 on it. We surface
      // these in the JSON summary so an operator can clean them up
      // (they are a separate failure mode from "object is missing").
      fileUrlToObjectName({ fileUrl: row.fileUrl });
      dbFileUrls.push(row.fileUrl);
    } catch (error) {
      dbInvalid.push({
        id: row.id,
        fileUrl: row.fileUrl,
        reason: error?.message ?? String(error),
      });
    }
  }

  const bucketFileUrls = [];
  const bucketUnclassified = [];
  for (const objectName of listResult.objectNames) {
    const url = objectNameToFileUrl({
      objectName,
    });
    if (url) {
      bucketFileUrls.push(url);
    } else {
      bucketUnclassified.push(objectName);
    }
  }

  const { dbOnly, bucketOnly } = diffSides({
    dbFileUrls,
    bucketFileUrls,
  });

  const summary = {
    target: target.label,
    bucket: storage.bucketName,
    prefix: listResult.prefix,
    inspected: {
      db_rows: dbRows.length,
      bucket_objects: listResult.objectNames.length,
    },
    drift: {
      db_only: dbOnly.length,
      bucket_only: bucketOnly.length,
      db_invalid: dbInvalid.length,
    },
    samples: {
      // Cap the sample arrays so the alert email and the scheduled
      // deploy log don't get flooded if we're suddenly looking at
      // thousands of orphans.
      db_only: dbOnly.slice(0, 50),
      bucket_only: bucketOnly.slice(0, 50),
      db_invalid: dbInvalid.slice(0, 50),
    },
  };

  const driftCount =
    summary.drift.db_only +
    summary.drift.bucket_only +
    summary.drift.db_invalid;

  if (format === "human") {
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log(
      `Inspected: ${summary.inspected.db_rows} files row(s), ` +
        `${summary.inspected.bucket_objects} bucket object(s).`,
    );
    // eslint-disable-next-line no-console
    console.log(`db_only:      ${summary.drift.db_only}  (row exists, object missing)`);
    // eslint-disable-next-line no-console
    console.log(`bucket_only:  ${summary.drift.bucket_only}  (object exists, no row)`);
    // eslint-disable-next-line no-console
    console.log(`db_invalid:   ${summary.drift.db_invalid}  (row's file_url is malformed)`);
    // eslint-disable-next-line no-console
    console.log("");
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  if (driftCount > 0) {
    emitAlertLine({
      msg: "storage drift detected (db ↔ bucket)",
      payload: {
        target: summary.target,
        bucket: summary.bucket,
        db_only: summary.drift.db_only,
        bucket_only: summary.drift.bucket_only,
        db_invalid: summary.drift.db_invalid,
      },
    });
    return 1;
  }
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const code = await runAudit(args);
  process.exitCode = code;
}

// Only auto-run when invoked as a CLI; importing for tests must not
// trigger the audit.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("audit-storage-drift failed:", error?.message ?? error);
    if (error?.stack) {
      // eslint-disable-next-line no-console
      console.error(error.stack);
    }
    emitAlertLine({
      msg: "storage drift audit failed to complete",
      payload: { error: error?.message ?? String(error) },
    });
    process.exitCode = 2;
  });
}
