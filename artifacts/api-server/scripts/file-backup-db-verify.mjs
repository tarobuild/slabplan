#!/usr/bin/env node
/**
 * Restore a database dump taken from the independent backup into a new,
 * disposable PostgreSQL database, fail on any unexpected SQL error, check the
 * restored schema, optionally export live file rows for `check-db-files`, and
 * always drop the database afterwards.
 *
 *   node file-backup-db-verify.mjs --dump <path.sql.gz> [--files-csv <path>]
 *
 * Env: RESTORE_ADMIN_DATABASE_URL (a disposable server; default
 * postgres://postgres:postgres@127.0.0.1:5432/postgres) and PSQL_BIN.
 * Output reports status and problems only, never row counts or row data.
 * Documented in docs/private-file-backup-runbook.md.
 */
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  psqlQuery,
  redactRestoreError,
  restorePlainSqlDump,
  verifyRestoredDatabase,
} from "./lib/pg-restore.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = path.resolve(scriptDir, "../../../lib/db/migrations");
const FILE_ROWS_SQL =
  "select id, coalesce(organization_id::text, ''), file_url, coalesce(file_size::text, '') " +
  "from public.files where deleted_at is null and file_url is not null";

function databaseUrlFor(adminUrl, name) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function exportFileRows({ databaseUrl, psqlBin, outPath, spawnImpl = spawn }) {
  const child = spawnImpl(
    psqlBin,
    ["--dbname", databaseUrl, "-X", "-q", "-t", "-A", "-F", ",", "-v", "ON_ERROR_STOP=1", "-c", FILE_ROWS_SQL],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  const exit = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  await pipeline(child.stdout, createWriteStream(outPath, { flags: "wx", mode: 0o600 }));
  const code = await exit;
  if (code !== 0) throw new Error(`File row export failed: ${redactRestoreError(stderr.trim().split("\n").at(-1) ?? "")}`);
}

export async function verifyDatabaseDump({
  dumpPath,
  filesCsvPath = null,
  adminUrl = "postgres://postgres:postgres@127.0.0.1:5432/postgres",
  psqlBin = "psql",
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  requiredTables = undefined,
  log = console.log,
}) {
  const name = `slabplan_backup_verify_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const databaseUrl = databaseUrlFor(adminUrl, name);
  await psqlQuery({ databaseUrl: adminUrl, psqlBin, sql: `create database "${name}"` });
  try {
    const restored = await restorePlainSqlDump({ dumpPath, databaseUrl, psqlBin });
    log(`[db-verify] restore ok; tolerated Supabase compatibility errors=${restored.allowedErrorCount}`);
    const verified = await verifyRestoredDatabase({ databaseUrl, psqlBin, migrationsDir, requiredTables });
    if (!verified.ok) throw new Error(`Restored database failed verification: ${verified.problems.join("; ")}`);
    log(`[db-verify] schema ok; repository migrations newer than the dump=${verified.migrationsBehind ?? "unknown"}`);
    if (filesCsvPath) await exportFileRows({ databaseUrl, psqlBin, outPath: filesCsvPath });
    return { restored, verified };
  } finally {
    await psqlQuery({
      databaseUrl: adminUrl,
      psqlBin,
      sql: `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}'`,
    }).catch(() => {});
    await psqlQuery({ databaseUrl: adminUrl, psqlBin, sql: `drop database if exists "${name}"` }).catch((error) => {
      log(`[db-verify] warning: could not drop ${name}: ${error.message}`);
    });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--dump", "--files-csv"].includes(key) || !value || value.startsWith("--")) {
      throw new Error("Usage: file-backup-db-verify.mjs --dump <path.sql.gz> [--files-csv <path>]");
    }
    options[key.slice(2)] = value;
  }
  if (!options.dump) throw new Error("--dump is required.");
  return options;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  verifyDatabaseDump({
    dumpPath: options.dump,
    filesCsvPath: options["files-csv"] ?? null,
    adminUrl: process.env.RESTORE_ADMIN_DATABASE_URL?.trim() || undefined,
    psqlBin: process.env.PSQL_BIN?.trim() || "psql",
  }).catch((error) => {
    console.error(`DATABASE DUMP VERIFICATION FAILED: ${String(error?.message ?? error).slice(0, 800)}`);
    process.exit(1);
  });
}
