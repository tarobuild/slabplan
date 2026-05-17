#!/usr/bin/env node
/**
 * Restore the newest SlabPlan daily DB backup into a throwaway Postgres DB.
 *
 * This is read-only against production: it downloads the latest
 * `backups/db/YYYY-MM-DD.sql.gz` object from Supabase Storage, restores it
 * into a disposable database supplied by RESTORE_ADMIN_DATABASE_URL, runs a
 * small row-count sanity checklist, and drops the database by default.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import pino from "pino";
import { createSupabaseStorage } from "./lib/supabase-storage.mjs";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { component: "db-restore-drill" },
});

const backupPrefix = (process.env.BACKUP_PREFIX ?? "backups/db").replace(
  /\/+$/,
  "",
);
const psqlBin = process.env.PSQL_BIN ?? "psql";
const adminDatabaseUrl =
  process.env.RESTORE_ADMIN_DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const keepDatabase = process.env.RESTORE_KEEP_DATABASE === "1";
const explicitObjectName = process.env.RESTORE_BACKUP_OBJECT?.trim();

const sanityTables = [
  "organizations",
  "organization_memberships",
  "users",
  "clients",
  "jobs",
  "leads",
  "schedule_items",
  "daily_logs",
  "folders",
  "files",
  "agent_messages",
  "agent_usage_monthly",
];

const allowedRestoreErrorPatterns = [
  /extension "supabase_vault" is not available/i,
  /extension "supabase_vault" does not exist/i,
  /schema "vault" does not exist/i,
  /relation "vault\.secrets" does not exist/i,
];

function log(level, event, extra = {}) {
  const fn = logger[level] ?? logger.info;
  fn.call(logger, { event, ...extra }, event);
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function databaseUrlFor(dbName) {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function tail(value, max = 12_000) {
  return value.length > max ? value.slice(-max) : value;
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout = tail(stdout + chunk.toString());
  });
  child.stderr?.on("data", (chunk) => {
    stderr = tail(stderr + chunk.toString());
  });

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (code !== 0) {
    const message = stderr.trim() || stdout.trim() || `${command} exited ${code}`;
    throw new Error(message);
  }

  return { stdout, stderr };
}

async function runPsql(dbUrl, sql, options = {}) {
  return await run(psqlBin, [
    "--dbname",
    dbUrl,
    "-X",
    "-q",
    "-v",
    options.onErrorStop === false ? "ON_ERROR_STOP=0" : "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

function restoreErrorLines(stderr) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\bERROR:/.test(line));
}

function assertOnlyAllowedRestoreErrors(stderr) {
  const errorLines = restoreErrorLines(stderr);
  const unexpected = errorLines.filter(
    (line) => !allowedRestoreErrorPatterns.some((pattern) => pattern.test(line)),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Restore produced unexpected SQL errors:\n${unexpected.join("\n")}`,
    );
  }
  return errorLines;
}

async function findBackupObject(storage) {
  if (explicitObjectName) {
    const meta = await storage.getObjectInfo(explicitObjectName);
    if (!meta?.sizeBytes) {
      throw new Error(`Configured backup object does not exist: ${explicitObjectName}`);
    }
    return {
      objectName: explicitObjectName,
      sizeBytes: meta.sizeBytes,
      updated: meta.updated,
    };
  }

  const files = await storage.listAllObjects(`${backupPrefix}/`);
  const backups = files
    .map((file) => {
      const match = /\/(\d{4}-\d{2}-\d{2})\.sql\.gz$/.exec(file.name);
      if (!match) return null;
      const sizeBytes = Number(file.metadata?.size ?? 0);
      if (!sizeBytes) return null;
      return {
        objectName: file.name,
        dateStr: match[1],
        sizeBytes,
        updated: file.updated ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.dateStr.localeCompare(a.dateStr));

  const newest = backups[0];
  if (!newest) {
    throw new Error(`No non-empty backups found under ${backupPrefix}/.`);
  }
  return newest;
}

async function restoreBackup({ backupPath, restoreDatabaseUrl }) {
  const psql = spawn(psqlBin, [
    "--dbname",
    restoreDatabaseUrl,
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=0",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  psql.stdout.on("data", (chunk) => {
    stdout = tail(stdout + chunk.toString());
  });
  psql.stderr.on("data", (chunk) => {
    stderr = tail(stderr + chunk.toString());
  });

  const exitPromise = new Promise((resolve, reject) => {
    psql.on("error", reject);
    psql.on("close", resolve);
  });

  await pipeline(createReadStream(backupPath), createGunzip(), psql.stdin);
  const code = await exitPromise;
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `psql exited ${code}`);
  }
  return { stdout, stderr };
}

async function loadSanityCounts(restoreDatabaseUrl) {
  const selects = sanityTables.map(
    (name) => `SELECT '${name}' AS table_name, COUNT(*)::bigint AS row_count FROM ${quoteIdentifier(name)}`,
  );
  const { stdout } = await run(psqlBin, [
    "--dbname",
    restoreDatabaseUrl,
    "-X",
    "-q",
    "-t",
    "-A",
    "-F",
    ",",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `${selects.join(" UNION ALL ")} ORDER BY table_name;`,
  ]);

  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [tableName, rowCount] = line.split(",");
      return { tableName, rowCount: Number(rowCount) };
    });
}

async function main() {
  const storage = createSupabaseStorage();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "slabplan-restore-drill-"));
  const drillDb = `slabplan_restore_drill_${Date.now()}`;
  const restoreDatabaseUrl = databaseUrlFor(drillDb);
  const backupPath = path.join(tempDir, "backup.sql.gz");

  log("info", "drill_start", {
    bucket: storage.bucketName,
    backupPrefix,
    keepDatabase,
  });

  try {
    const backup = await findBackupObject(storage);
    log("info", "backup_selected", backup);

    const buffer = await storage.downloadBuffer(backup.objectName);
    if (buffer.length === 0) {
      throw new Error(`Downloaded backup is empty: ${backup.objectName}`);
    }
    await writeFile(backupPath, buffer);
    log("info", "backup_downloaded", {
      objectName: backup.objectName,
      bytes: buffer.length,
    });

    await runPsql(adminDatabaseUrl, `DROP DATABASE IF EXISTS ${quoteIdentifier(drillDb)};`);
    await runPsql(adminDatabaseUrl, `CREATE DATABASE ${quoteIdentifier(drillDb)};`);
    log("info", "database_created", { database: drillDb });

    const restored = await restoreBackup({ backupPath, restoreDatabaseUrl });
    const allowedErrors = assertOnlyAllowedRestoreErrors(restored.stderr);
    log("info", "restore_completed", {
      database: drillDb,
      allowedErrorCount: allowedErrors.length,
      allowedErrors,
    });

    const counts = await loadSanityCounts(restoreDatabaseUrl);
    const missingCounts = counts.filter(
      (row) => !Number.isFinite(row.rowCount) || row.rowCount < 0,
    );
    if (missingCounts.length > 0) {
      throw new Error(`Invalid sanity counts: ${JSON.stringify(missingCounts)}`);
    }

    log("info", "sanity_counts", { counts });
    log("info", "drill_done", {
      status: "ok",
      restoredObject: backup.objectName,
      database: keepDatabase ? drillDb : null,
    });
  } finally {
    if (!keepDatabase) {
      await runPsql(
        adminDatabaseUrl,
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${drillDb.replaceAll("'", "''")}';`,
      ).catch((err) => {
        log("warn", "database_terminate_failed", {
          database: drillDb,
          err: err?.message ?? String(err),
        });
      });
      await runPsql(adminDatabaseUrl, `DROP DATABASE IF EXISTS ${quoteIdentifier(drillDb)};`).catch((err) => {
        log("warn", "database_cleanup_failed", {
          database: drillDb,
          err: err?.message ?? String(err),
        });
      });
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  log("error", "drill_failed", {
    err: err?.message ?? String(err),
    stack: err?.stack,
  });
  process.exit(1);
});
