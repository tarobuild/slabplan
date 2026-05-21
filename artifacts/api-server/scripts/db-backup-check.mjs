#!/usr/bin/env node
/**
 * Nightly verification that today's database backup actually landed and
 * looks plausible. Companion to `db-backup.mjs`.
 *
 * Two checks, both alert on failure:
 *   1. **Existence:** an object named `backups/db/YYYY-MM-DD.sql.gz`
 *      exists for today (UTC) in the configured Supabase Storage bucket. Catches the
 *      "the cron silently never ran" failure mode.
 *   2. **Size sanity:** today's compressed size is within ±50 % of the
 *      median compressed size of the trailing 7 days (excluding today).
 *      Catches the "pg_dump partially crashed and produced a truncated
 *      file" or "the DB shrank unexpectedly" failure modes.
 *
 * Skipped gracefully when there are fewer than 3 prior backups in the
 * trailing window (not enough history to compute a meaningful median —
 * very early in the deployment's life). The existence check still runs.
 *
 * Designed to run from a scheduler after the backup
 * cron — e.g. backup at 09:00 UTC, check at 12:00 UTC. Exit code:
 *   0 — checks passed (or skipped with sufficient logging).
 *   1 — at least one check failed; an alert was attempted.
 *
 * Required env: same as `db-backup.mjs`.
 *   - `SUPABASE_URL`
 *   - `SUPABASE_STORAGE_BUCKET`
 *   - `SUPABASE_SERVICE_ROLE_KEY`
 * Optional env:
 *   - `BACKUP_PREFIX`                 (default: "backups/db")
 *   - `BACKUP_SIZE_TOLERANCE_PCT`     (default: 50)
 *   - `BACKUP_HISTORY_WINDOW_DAYS`    (default: 7)
 *   - `LOG_LEVEL`                     (default: "info")
 *   - Alert env: see `lib/backup-alerts.mjs`.
 */
import pino from "pino";
import { sendBackupAlert } from "./lib/backup-alerts.mjs";
import { createSupabaseStorage } from "./lib/supabase-storage.mjs";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { component: "db-backup-check" },
});

function log(level, event, extra = {}) {
  const fn = pinoLogger[level] ?? pinoLogger.info;
  fn.call(pinoLogger, { event, ...extra }, event);
}

const backupPrefix = (process.env.BACKUP_PREFIX ?? "backups/db").replace(
  /\/+$/,
  "",
);
const tolerancePct = Number(process.env.BACKUP_SIZE_TOLERANCE_PCT ?? "50");
const historyWindowDays = Number(
  process.env.BACKUP_HISTORY_WINDOW_DAYS ?? "7",
);

if (!Number.isFinite(tolerancePct) || tolerancePct <= 0 || tolerancePct >= 100) {
  log("error", "bad_env", {
    var: "BACKUP_SIZE_TOLERANCE_PCT",
    msg: "must be a number in (0, 100)",
  });
  process.exit(1);
}

let storage;

function getStorage() {
  if (!storage) {
    storage = createSupabaseStorage();
  }
  return storage;
}

function todayUtc() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysAgoUtc(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

/**
 * Build a date → sizeBytes map of all backup objects under the prefix.
 */
async function loadBackupIndex() {
  const files = await getStorage().listAllObjects(`${backupPrefix}/`);
  const byDate = new Map();
  for (const f of files) {
    const m = /\/(\d{4}-\d{2}-\d{2})\.sql\.gz$/.exec(f.name);
    if (!m) continue;
    const sizeBytes = Number(f.metadata?.size ?? 0);
    if (!sizeBytes) continue;
    byDate.set(m[1], { objectName: f.name, sizeBytes });
  }
  return byDate;
}

async function main() {
  const today = todayUtc();
  const storageClient = getStorage();
  log("info", "check_start", { today, bucket: storageClient.bucketName, backupPrefix });

  const index = await loadBackupIndex();
  const failures = [];

  // 1. Existence check.
  const todayEntry = index.get(today);
  if (!todayEntry) {
    failures.push({
      code: "missing_today",
      message: `Expected ${backupPrefix}/${today}.sql.gz to exist in bucket ${storageClient.bucketName}, but it was not found. The daily backup may not have run.`,
    });
    log("error", "missing_today", { today, expected: `${backupPrefix}/${today}.sql.gz` });
  } else {
    log("info", "today_present", {
      objectName: todayEntry.objectName,
      sizeBytes: todayEntry.sizeBytes,
    });
  }

  // 2. Size sanity check (only if today exists — otherwise the missing
  // alert already covers it).
  let sizeReport = null;
  if (todayEntry) {
    const trailing = [];
    for (let i = 1; i <= historyWindowDays; i++) {
      const ds = daysAgoUtc(i);
      const entry = index.get(ds);
      if (entry) trailing.push({ dateStr: ds, sizeBytes: entry.sizeBytes });
    }
    if (trailing.length < 3) {
      log("info", "size_check_skipped", {
        reason: "insufficient_history",
        haveDays: trailing.length,
        needDays: 3,
      });
    } else {
      const med = median(trailing.map((t) => t.sizeBytes));
      const lower = med * (1 - tolerancePct / 100);
      const upper = med * (1 + tolerancePct / 100);
      const ok =
        todayEntry.sizeBytes >= lower && todayEntry.sizeBytes <= upper;
      sizeReport = {
        todaySize: todayEntry.sizeBytes,
        median: med,
        lowerBound: Math.round(lower),
        upperBound: Math.round(upper),
        tolerancePct,
        trailingSamples: trailing,
      };
      if (!ok) {
        const direction =
          todayEntry.sizeBytes < lower ? "smaller" : "larger";
        failures.push({
          code: "size_anomaly",
          message: `Today's backup is ${direction} than expected: ${todayEntry.sizeBytes} bytes vs trailing ${trailing.length}-day median ${med} bytes (allowed ±${tolerancePct}% → [${Math.round(lower)}, ${Math.round(upper)}]).`,
        });
        log("error", "size_anomaly", sizeReport);
      } else {
        log("info", "size_within_tolerance", sizeReport);
      }
    }
  }

  if (failures.length === 0) {
    log("info", "check_done", { today, status: "ok" });
    return 0;
  }

  // Alert with combined failure summary.
  const summary = failures.map((f) => `- [${f.code}] ${f.message}`).join("\n");
  await sendBackupAlert({
    subject: `[SlabPlan] Daily DB backup VERIFICATION failed for ${today}`,
    message: [
      `The nightly verification of the ${today} Postgres backup found problems:`,
      "",
      summary,
      "",
      "Investigate immediately. See deployment logs for `component: db-backup-check` events, and check `component: db-backup` for the corresponding upload run.",
    ].join("\n"),
    context: {
      date: today,
      bucket: storageClient.bucketName,
      backupPrefix,
      failures,
      sizeReport,
    },
    log,
  });

  log("error", "check_done", { today, status: "failed", failures: failures.length });
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log("error", "check_crashed", {
      err: err?.message ?? String(err),
      stack: err?.stack,
    });
    // Try to alert on the crash too — something is very broken.
    sendBackupAlert({
      subject: `[SlabPlan] Daily DB backup CHECK crashed for ${todayUtc()}`,
      message: `The backup verification script itself threw an exception: ${err?.message ?? String(err)}`,
      context: { error: err?.message ?? String(err), stack: err?.stack },
      log,
    }).finally(() => process.exit(1));
  });
