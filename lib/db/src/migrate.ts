import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { pool as defaultPool } from "./index";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(currentDir, "../migrations");
const migrationsTableName = "workspace_schema_migrations";

export type ApplyMigrationsOptions = {
  /**
   * Override the directory the runner reads SQL files from. Used by the
   * api-server boot path because esbuild bundles the runner into
   * `artifacts/api-server/dist/index.mjs` — the default
   * `<src>/../migrations` resolution would point at the wrong directory.
   * The api-server build copies `lib/db/migrations` to
   * `dist/migrations` and passes that absolute path here.
   */
  migrationsDir?: string;
};

const baselineMigrationFile = "0000_far_doctor_strange.sql";
const baselineSentinelTable = "users";

export type MigrationResult = {
  applied: string[];
  skipped: string[];
  baselined: string[];
};

function buildChecksum(contents: string) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function sentinelTableExists(client: PoolClient) {
  // `to_regclass` resolves identifiers through the connection's
  // `search_path`, so this matches the same schema the migrations
  // themselves target (and is also schema-agnostic for testing).
  const { rows } = await client.query<{ exists: boolean }>(
    `select to_regclass($1) is not null as exists`,
    [baselineSentinelTable],
  );
  return rows[0]?.exists ?? false;
}

async function backfillBaseline(
  client: PoolClient,
  migrationsDir: string,
): Promise<string[]> {
  const baselinePath = path.join(migrationsDir, baselineMigrationFile);
  const sql = await fs.readFile(baselinePath, "utf8");
  const checksum = buildChecksum(sql);

  await client.query(
    `
      insert into ${migrationsTableName} (filename, checksum)
      values ($1, $2)
      on conflict (filename) do nothing
    `,
    [baselineMigrationFile, checksum],
  );

  return [baselineMigrationFile];
}

/**
 * Bootstrap path: when the database has been provisioned (the baseline
 * `users` table exists) but the non-idempotent baseline migration
 * `0000_far_doctor_strange.sql` has never been recorded as applied,
 * register it as already applied. This covers two real states:
 *   1. The migrations ledger doesn't exist yet (database was created via
 *      `drizzle-kit push` before the migration runner existed).
 *   2. The ledger exists but is empty / missing the baseline row (e.g.
 *      it was created out-of-band, or earlier rows were truncated).
 *      Without this guard the runner would try to execute 0000 against an
 *      already-populated schema and fail.
 *
 * Every later migration is written to be idempotent so it can run safely
 * on top of the baseline.
 *
 * Exported for unit testing.
 */
export async function recordBaselineIfNeeded(
  client: PoolClient,
  migrationsDir: string = defaultMigrationsDir,
): Promise<string[]> {
  await client.query(`
    create table if not exists ${migrationsTableName} (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await client.query<{ filename: string }>(
    `select filename from ${migrationsTableName} where filename = $1`,
    [baselineMigrationFile],
  );

  if (rows.length > 0) {
    return [];
  }

  if (!(await sentinelTableExists(client))) {
    return [];
  }

  return backfillBaseline(client, migrationsDir);
}

type JournalEntry = { idx: number; tag: string; checksum?: string };
type Journal = { entries: JournalEntry[] };

/**
 * In-process equivalent of `pnpm --filter db check-migrations-journal`.
 * Fails loudly BEFORE applyMigrations runs so the boot path won't try
 * to apply a tampered or out-of-sync SQL file against production. The
 * post-merge script runs the standalone CLI version on every merge;
 * this function exists so the deploy-time apply path has the same
 * guard without shelling out (the runner is bundled into the
 * api-server's dist with no `pnpm` available at runtime). See
 * `lib/db/src/scripts/check-migrations-journal.ts` for the CLI.
 */
export async function verifyMigrationsJournal(
  migrationsDir: string = defaultMigrationsDir,
): Promise<void> {
  const sqlFiles = (await fs.readdir(migrationsDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const sqlChecksums = new Map<string, string>();
  await Promise.all(
    sqlFiles.map(async (file) => {
      const tag = file.replace(/\.sql$/, "");
      const contents = await fs.readFile(path.join(migrationsDir, file), "utf8");
      sqlChecksums.set(tag, buildChecksum(contents));
    }),
  );

  const journalRaw = await fs.readFile(
    path.join(migrationsDir, "meta", "_journal.json"),
    "utf8",
  );
  const journal = JSON.parse(journalRaw) as Journal;

  const errors: string[] = [];

  // Duplicate tag/idx detection — set-based comparison would mask these.
  // Mirrors `lib/db/src/scripts/check-migrations-journal.ts` so the
  // boot-time guard has parity with the post-merge CLI guard.
  const tagCounts = new Map<string, number>();
  const idxCounts = new Map<number, number>();
  for (const entry of journal.entries) {
    tagCounts.set(entry.tag, (tagCounts.get(entry.tag) ?? 0) + 1);
    idxCounts.set(entry.idx, (idxCounts.get(entry.idx) ?? 0) + 1);
  }
  for (const [tag, count] of tagCounts) {
    if (count > 1) errors.push(`Duplicate journal tag: ${tag} (x${count})`);
  }
  for (const [idx, count] of idxCounts) {
    if (count > 1) errors.push(`Duplicate journal idx: ${idx} (x${count})`);
  }

  const journalTags = new Set(journal.entries.map((e) => e.tag));

  for (const tag of sqlChecksums.keys()) {
    if (!journalTags.has(tag)) {
      errors.push(`SQL file with no journal entry: ${tag}.sql`);
    }
  }
  for (const tag of journalTags) {
    if (!sqlChecksums.has(tag)) {
      errors.push(`Journal entry with no SQL file: ${tag}`);
    }
  }
  for (const entry of journal.entries) {
    const expected = sqlChecksums.get(entry.tag);
    if (expected === undefined) continue;
    if (!entry.checksum) {
      errors.push(
        `Journal entry ${entry.tag} is missing a checksum. Run rebuild-migrations-journal.`,
      );
      continue;
    }
    if (entry.checksum !== expected) {
      errors.push(
        `Checksum mismatch for ${entry.tag}: journal=${entry.checksum.slice(0, 12)}… file=${expected.slice(0, 12)}…. ` +
          "If the SQL was edited intentionally, write a NEW migration; do not edit an applied one.",
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Migration journal is out of sync with SQL files:\n  - ${errors.join("\n  - ")}`,
    );
  }
}

export async function applyMigrations(
  pool: Pool = defaultPool,
  options: ApplyMigrationsOptions = {},
): Promise<MigrationResult> {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir;
  await verifyMigrationsJournal(migrationsDir);
  const client = await pool.connect();

  try {
    const baselined = await recordBaselineIfNeeded(client, migrationsDir);

    const existingRows = await client.query<{
      filename: string;
      checksum: string;
    }>(`select filename, checksum from ${migrationsTableName}`);

    const appliedChecksums = new Map(
      existingRows.rows.map((row) => [row.filename, row.checksum]),
    );

    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((entry) => entry.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(migrationsDir, migrationFile);
      const sql = await fs.readFile(migrationPath, "utf8");
      const checksum = buildChecksum(sql);
      const existingChecksum = appliedChecksums.get(migrationFile);

      if (existingChecksum) {
        if (existingChecksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${migrationFile}. ` +
              "Create a new migration instead of editing an applied one.",
          );
        }

        skipped.push(migrationFile);
        continue;
      }

      await client.query("begin");

      try {
        await client.query(sql);
        await client.query(
          `
            insert into ${migrationsTableName} (filename, checksum)
            values ($1, $2)
          `,
          [migrationFile, checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }

      applied.push(migrationFile);
    }

    return { applied, skipped, baselined };
  } finally {
    client.release();
  }
}
