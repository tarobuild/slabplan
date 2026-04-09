import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `pg` is only declared as a dependency of @workspace/db, so resolve it
// through lib/db's own node_modules instead of the api-server's.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbRequire = createRequire(
  path.resolve(__dirname, "../../../lib/db/package.json"),
);
const { Client } = dbRequire("pg");

// Tables we never want to touch. Migration metadata must survive a reset.
const PROTECTED_TABLES = new Set(["workspace_schema_migrations"]);

const TARGETS = {
  local: {
    label: "LOCAL",
    envVar: "DATABASE_URL",
  },
  production: {
    label: "PRODUCTION",
    envVar: "SUPABASE_DATABASE_URL",
  },
};

function parseDbFlag(argv) {
  for (const arg of argv) {
    if (arg === "--db=local") return "local";
    if (arg === "--db=production") return "production";
    if (arg.startsWith("--db=")) {
      throw new Error(
        `Unknown --db value: ${arg}. Expected --db=local or --db=production.`,
      );
    }
  }
  return null;
}

async function resetTarget(target) {
  const connectionString = process.env[target.envVar];

  if (!connectionString) {
    throw new Error(
      `${target.envVar} must be set to reset the ${target.label} database.`,
    );
  }

  console.log(`\n[${target.label}] Resetting database (${target.envVar})…`);
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Discover application tables dynamically so the reset always matches the
    // current schema — no hardcoded list to drift out of sync.
    const { rows } = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    const tables = rows
      .map((row) => row.table_name)
      .filter((name) => !PROTECTED_TABLES.has(name));

    if (tables.length === 0) {
      console.log(`[${target.label}] No application tables found.`);
      return;
    }

    console.log(
      `[${target.label}] Truncating ${tables.length} tables: ${tables.join(", ")}`,
    );

    // Quote identifiers to handle any future table names that collide with
    // reserved words. Using CASCADE walks any FK chains (including across
    // tables that may not yet be in the dynamic list on older DBs).
    const identifiers = tables.map((name) => `"${name}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);

    // Sanity check: every truncated table should now have 0 rows.
    const counts = await Promise.all(
      tables.map(async (name) => {
        const result = await client.query(
          `SELECT COUNT(*)::int AS n FROM "${name}"`,
        );
        return { name, n: result.rows[0].n };
      }),
    );
    const nonEmpty = counts.filter((row) => row.n !== 0);
    if (nonEmpty.length > 0) {
      throw new Error(
        `[${target.label}] Reset failed — tables still non-empty: ${nonEmpty
          .map((row) => `${row.name}(${row.n})`)
          .join(", ")}`,
      );
    }

    console.log(`[${target.label}] Reset complete (${tables.length} tables cleared).`);
  } finally {
    await client.end();
  }
}

async function main() {
  const selected = parseDbFlag(process.argv.slice(2));

  if (!selected) {
    throw new Error(
      "A --db flag is required. Use --db=local or --db=production. " +
        "Production resets must be targeted explicitly for safety.",
    );
  }

  await resetTarget(TARGETS[selected]);
}

main().catch((error) => {
  console.error("Failed to reset database:", error);
  process.exitCode = 1;
});
