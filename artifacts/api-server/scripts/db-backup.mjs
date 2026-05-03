#!/usr/bin/env node
/**
 * Daily Postgres backup → object storage.
 *
 * Runs `pg_dump` against the database referenced by SUPABASE_DATABASE_URL
 * (falling back to DATABASE_URL), gzip-compresses the output, and uploads
 * it to the configured object-storage bucket under
 * `backups/db/YYYY-MM-DD.sql.gz`. Then it prunes old backups according to
 * a daily / weekly / monthly retention policy:
 *   - daily   : keep the last 14
 *   - weekly  : keep the last 12 (one per ISO week)
 *   - monthly : keep the last 12 (one per calendar month)
 *
 * Designed to run from a Replit Scheduled Deployment ("cron") once per
 * day. Mirrors the auth pattern in src/lib/storage.ts so it always uses
 * the same credentials as the production API server.
 *
 * Required env:
 *   - SUPABASE_DATABASE_URL or DATABASE_URL — Postgres connection string
 *   - DEFAULT_OBJECT_STORAGE_BUCKET_ID    — bucket id from Replit App Storage
 *
 * Optional env:
 *   - BACKUP_PREFIX  (default: "backups/db")
 *   - PG_DUMP_BIN    (default: "pg_dump")
 *   - LOG_LEVEL      (default: "info")
 *
 * Output is one structured JSON object per significant step on stdout, so
 * `pino-http`'s consumers and Replit's deployment logs can ingest it
 * without parsing a wall of pg_dump chatter.
 */
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";
import pino from "pino";

// Use the same pino logger family as the api-server (`src/lib/logger.ts`).
// Same line shape (level, time, msg, plus our `event` / `component`
// fields), so deployment-log queries that grep on `component` or `event`
// work uniformly across the api-server process and this scheduled job.
const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { component: "db-backup" },
});

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const dbUrl = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
const backupPrefix = (process.env.BACKUP_PREFIX ?? "backups/db").replace(
  /\/+$/,
  "",
);
const pgDumpBin = process.env.PG_DUMP_BIN ?? "pg_dump";

function log(level, event, extra = {}) {
  const fn = pinoLogger[level] ?? pinoLogger.info;
  fn.call(pinoLogger, { event, ...extra }, event);
}

function fail(event, extra) {
  log("error", event, extra);
  process.exit(1);
}

if (!bucketId) {
  fail("missing_env", { var: "DEFAULT_OBJECT_STORAGE_BUCKET_ID" });
}
if (!dbUrl) {
  fail("missing_env", { var: "SUPABASE_DATABASE_URL or DATABASE_URL" });
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

function todayUtc() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return { yyyy, mm, dd, iso: `${yyyy}-${mm}-${dd}` };
}

function isoWeekKey(d) {
  // Returns "YYYY-Www" for the ISO week containing `d` (UTC).
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function runBackup() {
  const { iso } = todayUtc();
  const objectName = `${backupPrefix}/${iso}.sql.gz`;
  const target = bucket.file(objectName);

  log("info", "backup_start", { objectName, bucketId });

  const dump = spawn(
    pgDumpBin,
    ["--no-owner", "--no-privileges", "--format=plain", dbUrl],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderrTail = "";
  dump.stderr.on("data", (chunk) => {
    stderrTail += chunk.toString();
    if (stderrTail.length > 8000) {
      stderrTail = stderrTail.slice(-8000);
    }
  });

  const dumpExit = new Promise((resolve, reject) => {
    dump.on("error", reject);
    dump.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}: ${stderrTail.trim()}`));
    });
  });

  const gzip = createGzip({ level: 6 });
  const upload = target.createWriteStream({
    resumable: false,
    contentType: "application/gzip",
    metadata: {
      cacheControl: "private, max-age=0",
      metadata: {
        "cadstone-backup-date": iso,
        "cadstone-backup-source": "pg_dump",
      },
    },
  });

  const t0 = Date.now();
  await Promise.all([
    dumpExit,
    pipeline(dump.stdout, gzip, upload),
  ]);

  const [meta] = await target.getMetadata();
  const sizeBytes = Number(meta.size ?? 0);
  if (!sizeBytes) {
    throw new Error(
      "Uploaded backup is zero bytes; treating as failure even though pg_dump exited 0.",
    );
  }

  log("info", "backup_uploaded", {
    objectName,
    sizeBytes,
    elapsedMs: Date.now() - t0,
  });

  return { objectName, sizeBytes };
}

function classifyForRetention(files, today) {
  // Bucket every backup object by ISO date. Newest-wins on collisions
  // (we should only have one per day anyway).
  const byDate = new Map();
  for (const f of files) {
    const m = /\/(\d{4}-\d{2}-\d{2})\.sql\.gz$/.exec(f.name);
    if (!m) continue;
    const date = new Date(`${m[1]}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    byDate.set(m[1], { file: f, date, dateStr: m[1] });
  }
  const entries = Array.from(byDate.values()).sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );

  const keep = new Set();

  // Daily: 14 most recent.
  for (const e of entries.slice(0, 14)) keep.add(e.dateStr);

  // Weekly: newest-per-ISO-week, last 12 distinct weeks.
  const seenWeeks = new Set();
  for (const e of entries) {
    const wk = isoWeekKey(e.date);
    if (seenWeeks.has(wk)) continue;
    seenWeeks.add(wk);
    keep.add(e.dateStr);
    if (seenWeeks.size >= 12) break;
  }

  // Monthly: newest-per-calendar-month, last 12 distinct months.
  const seenMonths = new Set();
  for (const e of entries) {
    const mk = monthKey(e.date);
    if (seenMonths.has(mk)) continue;
    seenMonths.add(mk);
    keep.add(e.dateStr);
    if (seenMonths.size >= 12) break;
  }

  // Always keep today's freshly-uploaded backup if present.
  keep.add(today.iso);

  const toDelete = entries.filter((e) => !keep.has(e.dateStr));
  return { kept: entries.length - toDelete.length, toDelete, total: entries.length };
}

async function pruneOldBackups() {
  const today = todayUtc();
  const [files] = await bucket.getFiles({ prefix: `${backupPrefix}/` });
  const { kept, toDelete, total } = classifyForRetention(files, today);

  log("info", "prune_summary", { total, keeping: kept, deleting: toDelete.length });

  for (const e of toDelete) {
    try {
      await e.file.delete();
      log("info", "prune_deleted", { objectName: e.file.name, dateStr: e.dateStr });
    } catch (err) {
      // Don't abort the whole job for one delete failure; the next run
      // will reattempt.
      log("warn", "prune_delete_failed", {
        objectName: e.file.name,
        err: err?.message ?? String(err),
      });
    }
  }
}

(async () => {
  try {
    const result = await runBackup();
    await pruneOldBackups();
    log("info", "backup_done", { objectName: result.objectName, sizeBytes: result.sizeBytes });
  } catch (err) {
    fail("backup_failed", { err: err?.message ?? String(err), stack: err?.stack });
  }
})();
