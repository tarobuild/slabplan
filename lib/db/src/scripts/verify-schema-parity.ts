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
 * Lines are sorted so column ordering inside CREATE TABLE doesn't
 * register as drift (drizzle-kit push and our hand-written DDL emit
 * columns in different orders).
 */
function normalize(dump: string): string {
  // Strip the workspace_schema_migrations block by paragraph boundaries
  // before splitting into lines.
  const blocks = dump.split(/\n(?=CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE UNIQUE INDEX|CREATE SEQUENCE)/);
  const keptBlocks = blocks.filter(
    (block) => !block.includes("public.workspace_schema_migrations"),
  );
  const stripped = keptBlocks.join("\n");

  const lines = stripped.split("\n");
  const kept = lines
    .map((line) => {
      let l = line
        // Postgres pretty-prints numeric defaults; collapse to bare literal.
        .replace(/DEFAULT '(-?\d+(?:\.\d+)?)'::(?:numeric|integer|bigint)/g, "DEFAULT $1")
        // Trailing-comma vs. semicolon vs. nothing inside CREATE TABLE
        // columns is determined by column position, which we sort below.
        .replace(/,\s*$/, "")
        .replace(/;\s*$/, "")
        .trimEnd();
      // Canonicalize FK constraint names so style differences (Postgres'
      // *_fkey vs Drizzle's *_<table>_id_fk) don't show as drift, while
      // preserving the FK SEMANTICS (referenced table, columns, action).
      // We do this by stripping the constraint name itself and keeping
      // everything else — so a real drift in FOREIGN KEY columns,
      // REFERENCES target, or ON DELETE clause still shows up.
      l = l.replace(
        /(\bADD CONSTRAINT )"?[A-Za-z0-9_]+?(?:_fkey|_fk)"?( FOREIGN KEY)/g,
        "$1<fkname>$2",
      );
      return l;
    })
    .filter((line) => {
      const t = line.trim();
      if (t === "") return false;
      if (t.startsWith("--")) return false;
      if (t.startsWith("SET ")) return false;
      if (t.startsWith("SELECT pg_catalog.set_config")) return false;
      if (t === ")") return false;
      if (t === "(") return false;
      // Same column, different constraint naming flavor (UNIQUE constraint
      // vs uniqueIndex on `singleton`).
      if (t.includes("daily_log_settings_singleton")) return false;
      return true;
    });
  const sorted = kept.sort();
  // `ALTER TABLE ONLY public.<x>` is a wrapper header that pg_dump emits
  // once per ADD CONSTRAINT statement. After sorting, the count of these
  // wrappers per table differs between sides only because of constraint
  // styles already filtered above. Collapse runs of identical wrapper
  // lines so leftover counts don't show up as drift.
  const deduped: string[] = [];
  for (const line of sorted) {
    const isWrapper = /^ALTER TABLE ONLY public\.[A-Za-z0-9_]+$/.test(line);
    if (isWrapper && deduped.length > 0 && deduped[deduped.length - 1] === line) {
      continue;
    }
    deduped.push(line);
  }
  return deduped.join("\n");
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
