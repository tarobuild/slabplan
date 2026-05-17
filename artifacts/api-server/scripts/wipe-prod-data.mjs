/**
 * wipe-prod-data.mjs — destructively clear ALL application data from a
 * target database AND empty the Stone Track uploads prefix in object
 * storage. Schema, migrations metadata, and the bucket itself are
 * all preserved — only rows and uploaded files are removed.
 *
 * This script is intended for a "blank slate" reseed (see
 * docs/runbook.md § "Production wipe"). It is NOT for routine ops.
 *
 * Usage:
 *   node artifacts/api-server/scripts/wipe-prod-data.mjs \
 *     --db=production --i-know-what-im-doing
 *
 *   node artifacts/api-server/scripts/wipe-prod-data.mjs --db=local
 *
 * Required flags:
 *   --db=local        wipe the local database (uses DATABASE_URL)
 *   --db=production   wipe the live database (uses SUPABASE_DATABASE_URL)
 *                     and ALSO requires --i-know-what-im-doing.
 *
 * Safety properties:
 *   - Production target requires the explicit --i-know-what-im-doing
 *     confirmation flag, mirroring seed-users.mjs.
 *   - Lists what is about to be wiped (table count + row totals, storage
 *     object count + bytes) BEFORE writing, then pauses 3 s on
 *     production so an operator can Ctrl-C.
 *   - Preserves `workspace_schema_migrations` and any other system
 *     tables — only `public` schema BASE TABLES are truncated.
 *   - Truncate runs inside a single transaction (BEGIN / TRUNCATE
 *     ALL ... CASCADE / verify all-zero / COMMIT). A failure rolls
 *     everything back so we never end up half-wiped.
 *   - Storage deletion is scoped to the Stone Track uploads prefix only
 *     (`stone-track/uploads/`). Anything outside that prefix is NOT touched.
 *   - Storage deletion runs ONLY when --db=production. The Supabase bucket
 *     is production data, so wiping it from a "local" run would silently
 *     destroy real uploads.
 *
 * After running this script you almost certainly want to re-seed:
 *   node artifacts/api-server/scripts/seed-users.mjs \
 *     --db=production --i-know-what-im-doing
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createSupabaseStorage,
  uploadsObjectPrefix,
} from "./lib/supabase-storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(
  path.resolve(__dirname, "../../../lib/db/package.json"),
);
const { Client } = dbRequire("pg");

const PROTECTED_TABLES = new Set(["workspace_schema_migrations"]);
const PRODUCTION_PAUSE_MS = 3000;

const TARGETS = {
  local: { label: "LOCAL", envVar: "DATABASE_URL" },
  production: { label: "PRODUCTION", envVar: "SUPABASE_DATABASE_URL" },
};

function parseArgs(argv) {
  let db = null;
  let confirmed = false;
  for (const arg of argv) {
    if (arg === "--db=local") db = "local";
    else if (arg === "--db=production") db = "production";
    else if (arg.startsWith("--db=")) {
      throw new Error(
        `Unknown --db value: ${arg}. Expected --db=local or --db=production.`,
      );
    } else if (arg === "--i-know-what-im-doing") confirmed = true;
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!db) {
    throw new Error(
      "Missing required --db flag. Pass --db=local or --db=production. " +
        "Production also requires --i-know-what-im-doing.",
    );
  }
  if (db === "production" && !confirmed) {
    throw new Error(
      "Refusing to wipe PRODUCTION without --i-know-what-im-doing. " +
        "Re-run with both --db=production and --i-know-what-im-doing if you " +
        "really mean it.",
    );
  }
  return { db };
}

async function planAndWipeDatabase(target) {
  const connectionString = process.env[target.envVar];
  if (!connectionString) {
    throw new Error(
      `${target.envVar} must be set to wipe the ${target.label} database.`,
    );
  }

  console.log(`\n[${target.label}/db] Connecting via ${target.envVar}…`);
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows: tableRows } = await client.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    const tables = tableRows
      .map((r) => r.table_name)
      .filter((name) => !PROTECTED_TABLES.has(name));

    if (tables.length === 0) {
      console.log(`[${target.label}/db] No application tables found.`);
      return { tables: [], totalRows: 0 };
    }

    // Pre-wipe row totals so we have a record of what was actually there.
    // Run sequentially on the single pg client (concurrent client.query()
    // calls on a single Client are deprecated in node-postgres).
    const counts = [];
    for (const name of tables) {
      const r = await client.query(
        `SELECT COUNT(*)::bigint AS n FROM "${name}"`,
      );
      counts.push({ name, n: Number(r.rows[0].n) });
    }
    const totalRows = counts.reduce((a, b) => a + b.n, 0);
    const nonEmpty = counts.filter((c) => c.n > 0);

    console.log(
      `[${target.label}/db] About to TRUNCATE ${tables.length} tables ` +
        `(${nonEmpty.length} non-empty, ${totalRows} total rows):`,
    );
    for (const c of counts) {
      console.log(
        `  ${c.n.toString().padStart(6)}  ${c.name}` +
          (PROTECTED_TABLES.has(c.name) ? "   [PROTECTED]" : ""),
      );
    }
    console.log(
      `[${target.label}/db] Preserving: ${[...PROTECTED_TABLES].join(", ")}`,
    );

    if (target.label === "PRODUCTION") {
      console.log(
        `[${target.label}/db] Pausing ${PRODUCTION_PAUSE_MS}ms before TRUNCATE — Ctrl-C now to abort.`,
      );
      await sleep(PRODUCTION_PAUSE_MS);
    }

    const identifiers = tables.map((n) => `"${n}"`).join(", ");
    await client.query("BEGIN");
    try {
      await client.query(
        `TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`,
      );
      const verify = [];
      for (const name of tables) {
        const r = await client.query(
          `SELECT COUNT(*)::bigint AS n FROM "${name}"`,
        );
        verify.push({ name, n: Number(r.rows[0].n) });
      }
      const stillNonEmpty = verify.filter((row) => row.n !== 0);
      if (stillNonEmpty.length > 0) {
        throw new Error(
          `Tables still non-empty after TRUNCATE: ${stillNonEmpty
            .map((r) => `${r.name}(${r.n})`)
            .join(", ")}`,
        );
      }
      // Sanity: if migration metadata exists, it must still have rows.
      // (Local DBs created via `drizzle-kit push` may not have this table
      // at all, so the absence of the table is fine.)
      const migExists = await client.query(
        `SELECT 1
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'workspace_schema_migrations'
          LIMIT 1`,
      );
      if (migExists.rowCount > 0) {
        const mig = await client.query(
          `SELECT COUNT(*)::bigint AS n FROM "workspace_schema_migrations"`,
        );
        if (Number(mig.rows[0].n) === 0) {
          throw new Error(
            "Migration metadata was unexpectedly cleared — rolling back.",
          );
        }
      }
      await client.query("COMMIT");
      console.log(
        `[${target.label}/db] TRUNCATE committed. ${tables.length} tables now empty.`,
      );
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }

    return { tables, totalRows };
  } finally {
    await client.end();
  }
}

async function planAndWipeBucket(targetLabel) {
  const storage = createSupabaseStorage();
  const stoneTrackUploadsPrefix = uploadsObjectPrefix();

  console.log(
    `\n[${targetLabel}/storage] Bucket=${storage.bucketName} Prefix=${stoneTrackUploadsPrefix}`,
  );

  const files = await storage.listAllObjects(stoneTrackUploadsPrefix);
  if (files.length === 0) {
    console.log(`[${targetLabel}/storage] Prefix already empty.`);
    return { deleted: 0, bytes: 0 };
  }

  const totalBytes = files.reduce(
    (sum, f) => sum + Number(f.metadata?.size ?? 0),
    0,
  );
  console.log(
    `[${targetLabel}/storage] About to delete ${files.length} objects (${totalBytes} bytes total).`,
  );
  console.log(`[${targetLabel}/storage] Sample (first 5):`);
  for (const f of files.slice(0, 5)) {
    console.log(`  - ${f.name} (size=${f.metadata?.size ?? "?"})`);
  }

  if (targetLabel === "PRODUCTION") {
    console.log(
      `[${targetLabel}/storage] Pausing ${PRODUCTION_PAUSE_MS}ms before deleting — Ctrl-C now to abort.`,
    );
    await sleep(PRODUCTION_PAUSE_MS);
  }

  await storage.deleteObjects(files.map((file) => file.name));

  // Verify.
  const after = await storage.listAllObjects(stoneTrackUploadsPrefix);
  if (after.length > 0) {
    throw new Error(
      `Bucket still has ${after.length} objects under ${stoneTrackUploadsPrefix} after delete.`,
    );
  }
  console.log(
    `[${targetLabel}/storage] Deleted ${files.length} objects (${totalBytes} bytes). Prefix now empty.`,
  );
  return { deleted: files.length, bytes: totalBytes };
}

async function main() {
  const { db } = parseArgs(process.argv.slice(2));
  const target = TARGETS[db];

  console.log(`Wipe target: ${target.label} (${target.envVar})`);

  const dbResult = await planAndWipeDatabase(target);
  // Only wipe Supabase Storage when explicitly targeting production. A local
  // target run should never clear real uploads.
  const storageResult =
    target.label === "PRODUCTION"
      ? await planAndWipeBucket(target.label)
      : (console.log(
          `\n[${target.label}/storage] Skipping bucket wipe — bucket is production data. ` +
            `Use --db=production to clear uploads.`,
        ),
        { deleted: 0, bytes: 0 });

  console.log("\n---");
  console.log(
    JSON.stringify(
      {
        target: target.label,
        db: { tablesWiped: dbResult.tables.length, rowsRemoved: dbResult.totalRows },
        storage: {
          objectsDeleted: storageResult.deleted,
          bytesDeleted: storageResult.bytes,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    "\nNext step: re-seed admins with " +
      "`node artifacts/api-server/scripts/seed-users.mjs --db=" +
      db +
      (db === "production" ? " --i-know-what-im-doing`" : "`"),
  );
}

main().catch((error) => {
  console.error("wipe-prod-data failed:", error.message ?? error);
  if (error?.stack) console.error(error.stack);
  process.exitCode = 1;
});
