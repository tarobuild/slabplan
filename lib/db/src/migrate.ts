import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { pool as defaultPool } from "./index";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../migrations");
const migrationsTableName = "workspace_schema_migrations";

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

async function backfillBaseline(client: PoolClient): Promise<string[]> {
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

  return backfillBaseline(client);
}

export async function applyMigrations(
  pool: Pool = defaultPool,
): Promise<MigrationResult> {
  const client = await pool.connect();

  try {
    const baselined = await recordBaselineIfNeeded(client);

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
