import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrateSource = readFileSync(
  path.resolve(here, "../../../lib/db/src/migrate.ts"),
  "utf8",
);

test("applyMigrations serializes boot-time migrations before reading ledger state", () => {
  const lockIndex = migrateSource.indexOf("select pg_advisory_lock");
  const baselineIndex = migrateSource.indexOf("recordBaselineIfNeeded(client, migrationsDir)");
  const ledgerReadIndex = migrateSource.indexOf(
    `select filename, checksum from \${migrationsTableName}`,
  );
  const unlockIndex = migrateSource.indexOf("select pg_advisory_unlock");

  assert.notEqual(lockIndex, -1);
  assert.notEqual(baselineIndex, -1);
  assert.notEqual(ledgerReadIndex, -1);
  assert.notEqual(unlockIndex, -1);
  assert.ok(lockIndex < baselineIndex);
  assert.ok(lockIndex < ledgerReadIndex);
  assert.ok(unlockIndex > ledgerReadIndex);
});
