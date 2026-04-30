import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DEFAULT_TEST_DATABASE_URL =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

// A handful of tables the test suites rely on. If any are missing we treat
// the DB as un-provisioned and trigger setup-test-db. We deliberately keep
// this list short — it just needs to detect "empty database / missing schema".
const SENTINEL_TABLES = ["users", "jobs", "files", "personal_access_tokens"];

function resolveTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.CADSTONE_TEST_DATABASE_URL ??
    DEFAULT_TEST_DATABASE_URL
  );
}

function isConnectionRefused(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH";
}

async function isSchemaProvisioned(testDatabaseUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: testDatabaseUrl });

  try {
    await client.connect();
  } catch (error) {
    // Database doesn't exist yet -> not provisioned. Postgres signals this
    // with code 3D000 ("invalid_catalog_name").
    if ((error as { code?: string }).code === "3D000") {
      return false;
    }
    throw error;
  }

  try {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count
         from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])`,
      [SENTINEL_TABLES],
    );
    const found = Number(result.rows[0]?.count ?? "0");
    return found === SENTINEL_TABLES.length;
  } finally {
    await client.end().catch(() => {
      /* swallow */
    });
  }
}

function runSetupTestDb(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const setupScript = path.resolve(here, "setup-test-db.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx/esm", setupScript],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `setup-test-db exited with code=${code} signal=${signal ?? "none"}`,
          ),
        );
      }
    });
  });
}

async function main(): Promise<void> {
  const testDatabaseUrl = resolveTestDatabaseUrl();

  let provisioned = false;
  try {
    provisioned = await isSchemaProvisioned(testDatabaseUrl);
  } catch (error) {
    if (isConnectionRefused(error)) {
      const url = new URL(testDatabaseUrl);
      const host = url.hostname || "localhost";
      const port = url.port || "5432";
      console.error(
        `\n[ensure-test-db] Could not connect to Postgres at ${host}:${port}.\n` +
          `[ensure-test-db] Start a local Postgres before running tests, or set\n` +
          `[ensure-test-db] TEST_DATABASE_URL to point at a reachable cluster.\n`,
      );
      process.exit(1);
    }
    throw error;
  }

  if (provisioned) {
    console.log("[ensure-test-db] Schema already present, skipping setup.");
    return;
  }

  console.log(
    "[ensure-test-db] Test schema missing or incomplete. Running setup-test-db...",
  );
  await runSetupTestDb();
}

main().catch((error) => {
  console.error(`[ensure-test-db] FAILED: ${(error as Error).message}`);
  if ((error as Error).stack) {
    console.error((error as Error).stack);
  }
  process.exit(1);
});
