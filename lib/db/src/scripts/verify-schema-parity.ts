/**
 * Reproducible schema-parity verification for Task #346.
 *
 * Two modes:
 *
 *   --mode=migrate-vs-push (default)
 *     Drops/creates two scratch databases on the server pointed to by
 *     DATABASE_URL/SUPABASE_DATABASE_URL:
 *       <base>_parity_migrate — populated by `pnpm --filter db migrate`
 *       <base>_parity_push    — populated by `drizzle-kit push --force`
 *     Then pg_dumps both, normalizes, and diffs.
 *
 *   --mode=dev-vs-prod
 *     pg_dumps the database in DATABASE_URL (dev) and PROD_DATABASE_URL
 *     (production), normalizes, and diffs. Read-only on both ends.
 *
 * Normalization removes well-known cosmetic differences enumerated in
 * `lib/db/README.md`: the `workspace_schema_migrations` ledger, *_fkey
 * vs *_<table>_id_fk constraint name styles, the
 * `daily_log_settings_singleton` constraint vs unique-index style, and
 * Postgres pretty-printing differences in numeric default literals.
 *
 * Evidence (the two normalized dumps and the diff) is written under
 * `.local/state/schema-parity/<timestamp>/` so reviewers can audit a
 * specific run without re-executing.
 *
 * Requires `pg_dump` and `psql` matching the server's major version
 * (Supabase = pg17). The script auto-discovers a postgresql-17 build in
 * `/nix/store`; override with `PG_DUMP=/path/to/pg_dump`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPackageDir = path.resolve(here, "../..");
const repoRoot = path.resolve(dbPackageDir, "../..");

type Mode = "migrate-vs-push" | "dev-vs-prod";

function parseMode(): Mode {
  const raw = process.argv.find((a) => a.startsWith("--mode="));
  const value = raw ? raw.split("=")[1] : "migrate-vs-push";
  if (value === "migrate-vs-push" || value === "dev-vs-prod") return value;
  throw new Error(`Unknown --mode: ${value}`);
}

function urlWithDb(base: URL, dbName: string): string {
  const next = new URL(base.toString());
  next.pathname = `/${dbName}`;
  return next.toString();
}

async function recreateDatabase(adminUrl: string, dbName: string) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.query(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }
}

function pgDumpBinary(): string {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  const found: string[] = [];
  try {
    for (const entry of readdirSync("/nix/store")) {
      if (/^[a-z0-9]+-postgresql-17/.test(entry)) {
        const candidate = `/nix/store/${entry}/bin/pg_dump`;
        if (existsSync(candidate)) found.push(candidate);
      }
    }
  } catch {
    // ignore
  }
  return found.sort().pop() ?? "pg_dump";
}

function pgDump(connectionString: string): string {
  return execFileSync(
    pgDumpBinary(),
    [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "-n",
      "public",
      "-d",
      connectionString,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

/**
 * Normalize a pg_dump so byte-equality reflects semantic equivalence.
 * Filters: comments, SET/SELECT pg_catalog noise, the workspace_schema_
 * migrations ledger block, *_fkey/*_fk constraint name style, the
 * daily_log_settings_singleton naming flavor, and Postgres' verbose
 * default-literal pretty-printing (`'0'::numeric` -> `0`).
 *
 * Statements are sorted as whole blocks so emit order does not register
 * as drift. CREATE TABLE column lines are sorted only inside their own
 * table block, which preserves table ownership for every column.
 */
export function normalize(dump: string): string {
  const statements: string[] = [];
  let current: string[] = [];

  for (const rawLine of dump.split("\n")) {
    const line = normalizeSchemaLine(rawLine);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    if (trimmed.startsWith("SET ")) continue;
    if (trimmed.startsWith("SELECT pg_catalog.set_config")) continue;

    current.push(line);
    if (trimmed.endsWith(";")) {
      const normalized = normalizeSchemaStatement(current);
      if (normalized) statements.push(normalized);
      current = [];
    }
  }

  if (current.length > 0) {
    const normalized = normalizeSchemaStatement(current);
    if (normalized) statements.push(normalized);
  }

  return statements.sort().join("\n\n");
}

function normalizeSchemaLine(line: string): string {
  return line
    // Postgres pretty-prints numeric defaults; collapse to bare literal.
    .replace(/DEFAULT '(-?\d+(?:\.\d+)?)'::(?:numeric|integer|bigint)/g, "DEFAULT $1")
    // Canonicalize FK constraint names so style differences (Postgres'
    // *_fkey vs Drizzle's *_<table>_id_fk) don't show as drift, while
    // preserving the FK SEMANTICS (referenced table, columns, action).
    .replace(
      /(\bADD CONSTRAINT )"?[A-Za-z0-9_]+?(?:_fkey|_fk)"?( FOREIGN KEY)/g,
      "$1<fkname>$2",
    )
    .trimEnd();
}

function cleanStatementLine(line: string): string {
  return line
    .replace(/,\s*$/, "")
    .replace(/;\s*$/, "")
    .trimEnd();
}

function normalizeDailyLogSettingsSingleton(statement: string): string | null {
  if (!statement.includes("public.daily_log_settings")) return null;
  if (!statement.includes("singleton")) return null;
  if (
    /CREATE UNIQUE INDEX .* ON public\.daily_log_settings\b[\s\S]*\(\s*singleton\s*\)/.test(statement) ||
    /ADD CONSTRAINT .* UNIQUE \(\s*singleton\s*\)/.test(statement)
  ) {
    return "UNIQUE public.daily_log_settings (singleton)";
  }
  return null;
}

function normalizeCreateTableStatement(lines: string[]): string {
  const header = cleanStatementLine(lines[0]);
  const body = lines
    .slice(1)
    .map(cleanStatementLine)
    .map((line) => line.trim())
    .filter((line) => line && line !== "(" && line !== ")" && line !== ");")
    .sort();
  return [header, ...body.map((line) => `  ${line}`), ");"].join("\n");
}

function normalizeSchemaStatement(lines: string[]): string | null {
  const cleaned = lines.map(cleanStatementLine).filter((line) => line.trim());
  const statement = cleaned.join("\n");
  if (!statement) return null;
  if (statement.includes("public.workspace_schema_migrations")) return null;

  const dailyLogSingleton = normalizeDailyLogSettingsSingleton(statement);
  if (dailyLogSingleton) return dailyLogSingleton;

  if (/^CREATE TABLE public\.[A-Za-z0-9_]+ \($/.test(cleaned[0].trim())) {
    return normalizeCreateTableStatement(cleaned);
  }

  return cleaned.join("\n");
}

async function writeEvidenceAndDiff(
  label: string,
  dumps: { left: string; right: string; leftLabel: string; rightLabel: string },
): Promise<{ dir: string; diff: string; equal: boolean }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(repoRoot, ".local/state/schema-parity", `${stamp}-${label}`);
  await fs.mkdir(dir, { recursive: true });
  const leftFile = path.join(dir, `${dumps.leftLabel}.sql`);
  const rightFile = path.join(dir, `${dumps.rightLabel}.sql`);
  await fs.writeFile(leftFile, dumps.left);
  await fs.writeFile(rightFile, dumps.right);
  const equal = dumps.left === dumps.right;
  let diff = "";
  if (!equal) {
    const res = spawnSync("diff", ["-u", leftFile, rightFile], { encoding: "utf8" });
    diff = res.stdout ?? "";
  }
  await fs.writeFile(path.join(dir, "diff.txt"), diff);
  return { dir, diff, equal };
}

async function migrateVsPush(): Promise<number> {
  const raw = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL/SUPABASE_DATABASE_URL must be set");
  const url = new URL(raw);
  const baseDb = url.pathname.replace(/^\//, "") || "postgres";
  const adminUrl = urlWithDb(url, "postgres");
  const migrateDb = `${baseDb}_parity_migrate`;
  const pushDb = `${baseDb}_parity_push`;

  console.log(`Recreating ${migrateDb} and ${pushDb} on ${url.host}…`);
  await recreateDatabase(adminUrl, migrateDb);
  await recreateDatabase(adminUrl, pushDb);

  const migrateUrl = urlWithDb(url, migrateDb);
  const pushUrl = urlWithDb(url, pushDb);

  console.log("Running migrate against scratch DB…");
  const migrateRes = spawnSync(
    path.join(dbPackageDir, "node_modules/.bin/tsx"),
    [path.join(dbPackageDir, "src/migrate-cli.ts")],
    {
      stdio: "inherit",
      cwd: dbPackageDir,
      env: { ...process.env, DATABASE_URL: migrateUrl, SUPABASE_DATABASE_URL: "" },
    },
  );
  if (migrateRes.status !== 0) throw new Error("migrate failed");

  console.log("Running drizzle-kit push --force against scratch DB…");
  const pushRes = spawnSync(
    path.join(dbPackageDir, "node_modules/.bin/drizzle-kit"),
    ["push", "--force", "--config", path.join(dbPackageDir, "drizzle.config.js")],
    {
      stdio: "inherit",
      cwd: dbPackageDir,
      env: { ...process.env, DATABASE_URL: pushUrl, SUPABASE_DATABASE_URL: "" },
    },
  );
  if (pushRes.status !== 0) throw new Error("drizzle-kit push failed");

  console.log("Dumping schemas…");
  const migrateDump = normalize(pgDump(migrateUrl));
  const pushDump = normalize(pgDump(pushUrl));

  const { dir, equal } = await writeEvidenceAndDiff("migrate-vs-push", {
    left: migrateDump,
    right: pushDump,
    leftLabel: "migrate",
    rightLabel: "push",
  });
  console.log(`Evidence written to ${dir}`);

  if (equal) {
    console.log("OK: migrate-built and push-built schemas are byte-equal after normalization.");
    return 0;
  }

  console.error("Schemas differ after normalization. See diff.txt in evidence directory.");
  return 1;
}

async function devVsProd(): Promise<number> {
  const dev = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  const prod = process.env.PROD_DATABASE_URL;
  if (!dev) throw new Error("DATABASE_URL/SUPABASE_DATABASE_URL must be set (dev)");
  if (!prod) {
    console.error("PROD_DATABASE_URL is not set; skipping dev-vs-prod comparison.");
    return 2;
  }
  console.log("Dumping dev and prod schemas…");
  const devDump = normalize(pgDump(dev));
  const prodDump = normalize(pgDump(prod));

  const { dir, equal } = await writeEvidenceAndDiff("dev-vs-prod", {
    left: devDump,
    right: prodDump,
    leftLabel: "dev",
    rightLabel: "prod",
  });
  console.log(`Evidence written to ${dir}`);

  if (equal) {
    console.log("OK: dev and prod schemas are byte-equal after normalization.");
    return 0;
  }
  console.error("Schemas differ after normalization. See diff.txt in evidence directory.");
  return 1;
}

async function main() {
  const mode = parseMode();
  const code = mode === "migrate-vs-push" ? await migrateVsPush() : await devVsProd();
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
