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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { restorePlainSqlDump, verifyRestoredDatabase } from "./lib/pg-restore.mjs";
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

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../lib/db/migrations",
);

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

    // Fails on any SQL error outside the explicit Supabase allow-list; every
    // error line is examined, not only the tail of psql's output.
    const restored = await restorePlainSqlDump({
      dumpPath: backupPath,
      databaseUrl: restoreDatabaseUrl,
      psqlBin,
    });
    log("info", "restore_completed", {
      database: drillDb,
      allowedErrorCount: restored.allowedErrorCount,
    });

    // The repository is public: report problems only, never row counts.
    const verified = await verifyRestoredDatabase({
      databaseUrl: restoreDatabaseUrl,
      psqlBin,
      migrationsDir,
      requiredTables: [...sanityTables, "workspace_schema_migrations"],
    });
    if (!verified.ok) {
      throw new Error(`Restored database failed verification: ${verified.problems.join("; ")}`);
    }
    log("info", "sanity_checks", {
      tablesChecked: sanityTables.length,
      migrationsNewerThanBackup: verified.migrationsBehind,
    });
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
