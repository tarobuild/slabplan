import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../migrations");
const migrationsTableName = "workspace_schema_migrations";

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

function buildChecksum(contents: string) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

export async function applyMigrations(): Promise<MigrationResult> {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${migrationsTableName} (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

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

    return { applied, skipped };
  } finally {
    client.release();
  }
}
