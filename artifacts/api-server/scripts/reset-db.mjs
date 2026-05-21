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
const CONFIRM_ENV = "STONE_TRACK_CONFIRM_DB_RESET";
const ALLOW_REMOTE_ENV = "STONE_TRACK_ALLOW_REMOTE_DB_RESET";

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

function parseArgs(argv) {
  let selected = null;
  let confirmed = false;
  for (const arg of argv) {
    if (arg === "--db=local") selected = "local";
    else if (arg === "--db=production") selected = "production";
    else if (arg === "--i-know-what-im-doing") confirmed = true;
    else if (arg.startsWith("--db=")) {
      throw new Error(
        `Unknown --db value: ${arg}. Expected --db=local or --db=production.`,
      );
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  return { selected, confirmed };
}

function databaseName(connectionString) {
  const parsed = new URL(connectionString);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function assertResetAllowed(target, connectionString, confirmed) {
  const parsed = new URL(connectionString);
  const dbName = databaseName(connectionString);
  if (!dbName) {
    throw new Error(`${target.envVar} must include a database name.`);
  }

  if (target.label === "PRODUCTION" && !confirmed) {
    throw new Error(
      "Refusing to reset PRODUCTION without --i-know-what-im-doing.",
    );
  }

  const expectedConfirmation = `reset:${target.label.toLowerCase()}:${dbName}`;
  if (process.env[CONFIRM_ENV] !== expectedConfirmation) {
    throw new Error(
      `Refusing to reset ${target.label} database "${dbName}" without ${CONFIRM_ENV}=${expectedConfirmation}.`,
    );
  }

  if (!isLocalHost(parsed.hostname) && process.env[ALLOW_REMOTE_ENV] !== "true") {
    throw new Error(
      `Refusing to reset remote database host "${parsed.hostname}" without ${ALLOW_REMOTE_ENV}=true.`,
    );
  }
}

async function resetTarget(target, confirmed) {
  const connectionString = process.env[target.envVar];

  if (!connectionString) {
    throw new Error(
      `${target.envVar} must be set to reset the ${target.label} database.`,
    );
  }

  assertResetAllowed(target, connectionString, confirmed);
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
    await client.query("BEGIN");
    try {
      await client.query(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);

      // Sanity check: every truncated table should now have 0 rows.
      const counts = [];
      for (const name of tables) {
        const result = await client.query(
          `SELECT COUNT(*)::int AS n FROM "${name}"`,
        );
        counts.push({ name, n: result.rows[0].n });
      }
      const nonEmpty = counts.filter((row) => row.n !== 0);
      if (nonEmpty.length > 0) {
        throw new Error(
          `[${target.label}] Reset failed — tables still non-empty: ${nonEmpty
            .map((row) => `${row.name}(${row.n})`)
            .join(", ")}`,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        /* ignore rollback errors */
      });
      throw error;
    }

    console.log(`[${target.label}] Reset complete (${tables.length} tables cleared).`);
  } finally {
    await client.end();
  }
}

async function main() {
  const { selected, confirmed } = parseArgs(process.argv.slice(2));

  if (!selected) {
    throw new Error(
      "A --db flag is required. Use --db=local or --db=production. " +
        "Production resets must be targeted explicitly for safety.",
    );
  }

  await resetTarget(TARGETS[selected], confirmed);
}

main().catch((error) => {
  console.error("Failed to reset database:", error);
  process.exitCode = 1;
});
