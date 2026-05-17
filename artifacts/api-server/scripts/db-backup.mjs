#!/usr/bin/env node
/**
 * Daily Postgres backup → Supabase Storage.
 *
 * Runs `pg_dump` against the database referenced by SUPABASE_DATABASE_URL
 * (falling back to DATABASE_URL), gzip-compresses the output, and uploads
 * it to the configured Supabase Storage bucket under
 * `backups/db/YYYY-MM-DD.sql.gz`. Then it prunes old backups according to
 * a daily / weekly / monthly retention policy:
 *   - daily   : keep the last 14
 *   - weekly  : keep the last 12 (one per ISO week)
 *   - monthly : keep the last 12 (one per calendar month)
 *
 * Designed to run from a scheduler once per day. Uses the same Supabase
 * Storage env vars as the production API server.
 *
 * Required env:
 *   - SUPABASE_DATABASE_URL or DATABASE_URL — Postgres connection string
 *   - SUPABASE_URL
 *   - SUPABASE_STORAGE_BUCKET
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   - BACKUP_PREFIX  (default: "backups/db")
 *   - PG_DUMP_BIN    (default: "pg_dump")
 *   - LOG_LEVEL      (default: "info")
 *
 * Output is one structured JSON object per significant step on stdout, so
 * `pino-http`'s consumers and deployment logs can ingest it
 * without parsing a wall of pg_dump chatter.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import pino from "pino";
import { sendBackupAlert } from "./lib/backup-alerts.mjs";
import { createSupabaseStorage } from "./lib/supabase-storage.mjs";

// Use the same pino logger family as the api-server (`src/lib/logger.ts`).
// Same line shape (level, time, msg, plus our `event` / `component`
// fields), so deployment-log queries that grep on `component` or `event`
// work uniformly across the api-server process and this scheduled job.
const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { component: "db-backup" },
});

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

/**
 * Find the most recent successful backup object whose ISO date is
 * strictly before `excludeIsoDate`. Returns `null` if no prior backup
 * exists (e.g. very first run) or if listing fails. Used to enrich
 * failure alerts so on-call sees how stale the latest good backup is.
 */
async function findMostRecentSuccessfulBackup(excludeIsoDate) {
  try {
    const files = await storage.listAllObjects(`${backupPrefix}/`);
    let best = null;
    for (const f of files) {
      const m = /\/(\d{4}-\d{2}-\d{2})\.sql\.gz$/.exec(f.name);
      if (!m) continue;
      const dateStr = m[1];
      if (dateStr >= excludeIsoDate) continue;
      const sizeBytes = Number(f.metadata?.size ?? 0);
      if (!sizeBytes) continue;
      if (!best || dateStr > best.dateStr) {
        best = {
          dateStr,
          objectName: f.name,
          sizeBytes,
          updated: f.updated ?? null,
        };
      }
    }
    return best;
  } catch (err) {
    log("warn", "find_last_successful_failed", {
      err: err?.message ?? String(err),
    });
    return null;
  }
}

if (!dbUrl) {
  fail("missing_env", { var: "SUPABASE_DATABASE_URL or DATABASE_URL" });
}

const storage = createSupabaseStorage();

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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "slabplan-db-backup-"));
  const tempFile = path.join(tempDir, `${iso}.sql.gz`);

  log("info", "backup_start", { objectName, bucket: storage.bucketName });

  try {
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

    const t0 = Date.now();
    await Promise.all([
      dumpExit,
      pipeline(dump.stdout, createGzip({ level: 6 }), createWriteStream(tempFile)),
    ]);

    const { size } = await stat(tempFile);
    if (!size) {
      throw new Error(
        "Compressed backup is zero bytes; treating as failure even though pg_dump exited 0.",
      );
    }

    await storage.uploadStream(objectName, createReadStream(tempFile), {
      contentType: "application/gzip",
      cacheControl: "private, max-age=0",
      contentLengthBytes: size,
    });

    const meta = await storage.getObjectInfo(objectName);
    const sizeBytes = Number(meta?.sizeBytes ?? 0);
    if (!sizeBytes) {
      throw new Error("Uploaded backup is zero bytes.");
    }

    log("info", "backup_uploaded", {
      objectName,
      sizeBytes,
      elapsedMs: Date.now() - t0,
    });

    return { objectName, sizeBytes };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
  const files = await storage.listAllObjects(`${backupPrefix}/`);
  const { kept, toDelete, total } = classifyForRetention(files, today);

  log("info", "prune_summary", { total, keeping: kept, deleting: toDelete.length });

  for (const e of toDelete) {
    try {
      await storage.deleteObject(e.file.name);
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
  const { iso: todayIso } = todayUtc();
  try {
    const result = await runBackup();
    await pruneOldBackups();
    log("info", "backup_done", { objectName: result.objectName, sizeBytes: result.sizeBytes });
  } catch (err) {
    const errMsg = err?.message ?? String(err);
    log("error", "backup_failed", { err: errMsg, stack: err?.stack });

    // Best-effort: enrich the alert with the most recent successful
    // backup so on-call knows how far behind we are.
    const lastGood = await findMostRecentSuccessfulBackup(todayIso);

    await sendBackupAlert({
      subject: `[SlabPlan] Daily DB backup FAILED for ${todayIso}`,
      message: [
        `The scheduled Postgres backup for ${todayIso} did not complete.`,
        "",
        `Error: ${errMsg}`,
        "",
        lastGood
          ? `Most recent successful backup: ${lastGood.objectName} (${lastGood.sizeBytes} bytes, uploaded ${lastGood.updated ?? "unknown"}).`
          : "No prior successful backup found in the bucket — this may be the first run, or listing the bucket also failed.",
        "",
        "Investigate immediately: check deployment logs for `event: backup_failed`, then re-run `pnpm --filter @workspace/api-server run backup:db` once the underlying issue is fixed.",
      ].join("\n"),
      context: {
        date: todayIso,
        bucket: storage.bucketName,
        backupPrefix,
        error: errMsg,
        lastSuccessful: lastGood,
      },
      log,
    });

    process.exit(1);
  }
})();
