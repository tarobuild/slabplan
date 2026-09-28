/**
 * Fail-closed restore of a plain-SQL SlabPlan database dump into a disposable
 * PostgreSQL database, plus structural checks of the restored schema.
 *
 * psql runs with ON_ERROR_STOP=0 only so that the explicitly listed Supabase
 * compatibility differences can be tolerated. Every ERROR line is examined as
 * it streams (nothing is truncated), and any error outside the allow-list, a
 * non-zero psql exit, or a broken gzip stream fails the restore. Restore
 * output can echo row data, so stdout is discarded and error lines are
 * redacted before they are reported.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// Supabase projects carry the supabase_vault extension, which a vanilla
// PostgreSQL 17 restore target does not provide. These are the only restore
// errors tolerated; SlabPlan does not store application data in Vault.
export const SUPABASE_ALLOWED_RESTORE_ERRORS = [
  /extension "supabase_vault" is not available/i,
  /extension "supabase_vault" does not exist/i,
  /schema "vault" does not exist/i,
  /relation "vault\.secrets" does not exist/i,
];

// Tables whose absence means the restore is not a usable SlabPlan database.
export const REQUIRED_RESTORED_TABLES = [
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
  "billing_events",
  "security_events",
  "workspace_schema_migrations",
];

// A production dump with no organizations or users is not a plausible backup.
export const NON_EMPTY_RESTORED_TABLES = ["organizations", "users", "workspace_schema_migrations"];

const MAX_REPORTED_ERRORS = 20;

/** Remove quoted values and key details that could carry customer data. */
export function redactRestoreError(line) {
  return String(line)
    .replace(/^psql:[^:]*:\d+:\s*/, "")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\([^)]*\)=\([^)]*\)/g, "(…)=(…)")
    .slice(0, 200);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/**
 * Stream a (gzip) plain-SQL dump into psql and fail on any unexpected error.
 * Returns counts only.
 */
export async function restorePlainSqlDump({
  dumpPath,
  databaseUrl,
  psqlBin = "psql",
  allowedErrorPatterns = SUPABASE_ALLOWED_RESTORE_ERRORS,
  gzip = true,
  spawnImpl = spawn,
}) {
  const child = spawnImpl(
    psqlBin,
    ["--dbname", databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=0", "-v", "VERBOSITY=terse"],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  const result = { exitCode: null, errorCount: 0, allowedErrorCount: 0, unexpectedErrorCount: 0, unexpectedErrors: [] };
  const exit = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const scanned = (async () => {
    for await (const line of createInterface({ input: child.stderr, crlfDelay: Infinity })) {
      if (!/\bERROR:/.test(line)) continue;
      result.errorCount += 1;
      if (allowedErrorPatterns.some((pattern) => pattern.test(line))) {
        result.allowedErrorCount += 1;
        continue;
      }
      result.unexpectedErrorCount += 1;
      if (result.unexpectedErrors.length < MAX_REPORTED_ERRORS) result.unexpectedErrors.push(redactRestoreError(line));
    }
  })();

  let inputError = null;
  try {
    const stages = [createReadStream(dumpPath), ...(gzip ? [createGunzip()] : []), child.stdin];
    await pipeline(...stages);
  } catch (error) {
    inputError = error;
    child.stdin.destroy();
  }
  result.exitCode = await exit;
  await scanned;

  const fail = (message) => Object.assign(new Error(message), { result });
  if (inputError) throw fail(`Database dump could not be streamed into psql: ${inputError.code ?? inputError.message}`);
  if (result.exitCode !== 0) throw fail(`psql exited with code ${result.exitCode}.`);
  if (result.unexpectedErrorCount > 0) {
    throw fail(`Restore produced ${result.unexpectedErrorCount} unexpected SQL error(s): ${result.unexpectedErrors.join(" | ")}`);
  }
  return result;
}

/** Run one query with ON_ERROR_STOP=1 and return unaligned rows. */
export async function psqlQuery({ databaseUrl, psqlBin = "psql", sql, spawnImpl = spawn }) {
  const child = spawnImpl(
    psqlBin,
    ["--dbname", databaseUrl, "-X", "-q", "-t", "-A", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse", "-c", sql],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`psql query failed (${code}): ${redactRestoreError(stderr.trim().split("\n").at(-1) ?? "")}`);
  return stdout.split("\n").filter((line) => line.length > 0).map((line) => line.split("\t"));
}

/**
 * Structural checks of a restored database. Returns problems (never row
 * counts) so the result is safe for public CI logs.
 */
export async function verifyRestoredDatabase({
  databaseUrl,
  psqlBin = "psql",
  migrationsDir,
  requiredTables = REQUIRED_RESTORED_TABLES,
  nonEmptyTables = NON_EMPTY_RESTORED_TABLES,
  spawnImpl = spawn,
}) {
  const query = (sql) => psqlQuery({ databaseUrl, psqlBin, sql, spawnImpl });
  const problems = [];

  const present = new Set((await query("select table_name from information_schema.tables where table_schema = 'public'")).map(([name]) => name));
  const missingTables = requiredTables.filter((name) => !present.has(name));
  if (missingTables.length) problems.push(`missing tables: ${missingTables.join(", ")}`);

  for (const table of nonEmptyTables.filter((name) => present.has(name))) {
    const [[nonEmpty] = []] = await query(`select exists (select 1 from public.${quoteIdentifier(table)})`);
    if (nonEmpty !== "t") problems.push(`table ${table} is empty`);
  }

  // NOT VALID constraints are intentional (migration 0033 adds tenant
  // composite foreign keys that way) and pg_dump preserves them; a restore
  // that violates a validated constraint already fails as an SQL error.
  const [[invalidIndexes] = []] = await query(
    "select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not i.indisvalid",
  );
  if (invalidIndexes !== "0") problems.push(`${invalidIndexes} invalid index(es)`);

  let migrationsBehind = null;
  if (migrationsDir && present.has("workspace_schema_migrations")) {
    const known = new Set((await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")));
    const applied = (await query("select filename from public.workspace_schema_migrations")).map(([name]) => name);
    const unknown = applied.filter((name) => !known.has(name));
    if (unknown.length) problems.push(`${unknown.length} applied migration(s) are not in this repository`);
    // A backup older than the code legitimately lacks newer migrations, so
    // the expected schema is the one its own applied migrations create.
    migrationsBehind = [...known].filter((name) => !applied.includes(name)).length;
    const expected = await expectedTablesFromMigrations(migrationsDir, applied.filter((name) => known.has(name)));
    const missingMigrationTables = [...expected].filter((name) => !present.has(name));
    if (missingMigrationTables.length) problems.push(`tables created by applied migrations are missing: ${missingMigrationTables.join(", ")}`);
  }
  return { ok: problems.length === 0, problems, migrationsBehind };
}

function normalizeTableName(raw) {
  return raw.replaceAll('"', "").replace(/^public\./i, "").toLowerCase();
}

/**
 * Tables that the given migrations create and do not later drop or rename,
 * applied in filename order (the runner's order).
 */
export async function expectedTablesFromMigrations(migrationsDir, appliedFilenames) {
  const tables = new Set();
  const table = String.raw`((?:"?public"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)`;
  const statement = new RegExp(
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${table}|drop\s+table\s+(?:if\s+exists\s+)?${table}|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${table}\s+rename\s+to\s+${table}`,
    "gi",
  );
  for (const filename of [...appliedFilenames].sort()) {
    const sql = (await readFile(`${migrationsDir}/${filename}`, "utf8")).replace(/--[^\n]*/g, "");
    for (const match of sql.matchAll(statement)) {
      if (match[1]) tables.add(normalizeTableName(match[1]));
      else if (match[2]) tables.delete(normalizeTableName(match[2]));
      else if (match[3] && match[4]) {
        tables.delete(normalizeTableName(match[3]));
        tables.add(normalizeTableName(match[4]));
      }
    }
  }
  return tables;
}
