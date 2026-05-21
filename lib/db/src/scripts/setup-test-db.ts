import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DEFAULT_TEST_DATABASE_URL =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
const ALLOW_REMOTE_TEST_RESET_ENV = "STONE_TRACK_ALLOW_REMOTE_TEST_DATABASE_RESET";

function resolveTestDatabaseUrl(): URL {
  const raw =
    process.env.TEST_DATABASE_URL ??
    process.env.CADSTONE_TEST_DATABASE_URL ??
    DEFAULT_TEST_DATABASE_URL;
  try {
    return new URL(raw);
  } catch (error) {
    throw new Error(
      `TEST_DATABASE_URL is not a valid URL: ${raw}. Original error: ${
        (error as Error).message
      }`,
    );
  }
}

function buildMaintenanceUrl(testUrl: URL): URL {
  const maintenance = new URL(testUrl.toString());
  // Connect to the cluster's "postgres" database so we can DROP / CREATE the
  // target database itself.
  maintenance.pathname = "/postgres";
  return maintenance;
}

function describeTarget(testUrl: URL): string {
  const dbName = decodeURIComponent(testUrl.pathname.replace(/^\//, ""));
  const host = testUrl.hostname || "localhost";
  const port = testUrl.port || "5432";
  return `${dbName} @ ${host}:${port}`;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizedUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).toString();
  } catch {
    return raw;
  }
}

function validateDestructiveTestTarget(testUrl: URL): void {
  const dbName = decodeURIComponent(testUrl.pathname.replace(/^\//, ""));
  if (!dbName) {
    throw new Error(
      `TEST_DATABASE_URL must include a database name (got "${testUrl}")`,
    );
  }

  if (!/(^|[_-])test($|[_-])|_test$|test_/i.test(dbName)) {
    throw new Error(
      `Refusing to recreate database "${dbName}" because its name does not look like a test database.`,
    );
  }

  if (!isLocalHost(testUrl.hostname) && process.env[ALLOW_REMOTE_TEST_RESET_ENV] !== "true") {
    throw new Error(
      `Refusing to recreate remote test database at "${testUrl.hostname}" without ${ALLOW_REMOTE_TEST_RESET_ENV}=true.`,
    );
  }

  const target = testUrl.toString();
  for (const envVar of ["SUPABASE_DATABASE_URL"]) {
    if (normalizedUrl(process.env[envVar]) === target) {
      throw new Error(
        `Refusing to recreate TEST_DATABASE_URL because it matches ${envVar}.`,
      );
    }
  }
}

function isConnectionRefused(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH";
}

async function recreateDatabase(testUrl: URL): Promise<void> {
  const dbName = decodeURIComponent(testUrl.pathname.replace(/^\//, ""));
  if (!dbName) {
    throw new Error(
      `TEST_DATABASE_URL must include a database name (got "${testUrl}")`,
    );
  }

  const maintenanceUrl = buildMaintenanceUrl(testUrl);
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });

  try {
    await client.connect();
  } catch (error) {
    if (isConnectionRefused(error)) {
      const host = testUrl.hostname || "localhost";
      const port = testUrl.port || "5432";
      console.error(
        `\n[setup-test-db] Could not connect to Postgres at ${host}:${port}.\n` +
          `[setup-test-db] Start a local Postgres (e.g. \`pg_ctl -D /tmp/pgdata start\`)\n` +
          `[setup-test-db] or override the connection URL via TEST_DATABASE_URL.\n`,
      );
    }
    throw error;
  }

  try {
    // Terminate any other sessions on the target DB so DROP DATABASE can succeed.
    await client.query(
      `select pg_terminate_backend(pid)
         from pg_stat_activity
        where datname = $1
          and pid <> pg_backend_pid()`,
      [dbName],
    );

    // Use IDENT-quoted identifiers via format() to avoid SQL injection.
    await client.query(`drop database if exists "${dbName.replace(/"/g, '""')}"`);
    await client.query(`create database "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await client.end().catch(() => {
      /* swallow disconnect errors */
    });
  }
}

function runDrizzlePush(testUrl: URL): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/scripts -> src -> lib/db
  const dbPackageDir = path.resolve(here, "..", "..");

  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "drizzle-kit", "push", "--force", "--config", "./drizzle.config.js"],
      {
        cwd: dbPackageDir,
        stdio: "inherit",
        env: {
          ...process.env,
          // Ensure drizzle-kit and the shared db client both target the test DB,
          // even when SUPABASE_DATABASE_URL or DATABASE_URL are otherwise set.
          DATABASE_URL: testUrl.toString(),
          SUPABASE_DATABASE_URL: "",
        },
      },
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `drizzle-kit push exited with code=${code} signal=${signal ?? "none"}`,
          ),
        );
      }
    });
  });
}

async function main(): Promise<void> {
  const testUrl = resolveTestDatabaseUrl();
  validateDestructiveTestTarget(testUrl);

  console.log(`[setup-test-db] Recreating database ${describeTarget(testUrl)}`);
  await recreateDatabase(testUrl);
  console.log(`[setup-test-db] Database recreated.`);

  console.log(`[setup-test-db] Pushing Drizzle schema (drizzle-kit push --force)...`);
  await runDrizzlePush(testUrl);
  console.log(`[setup-test-db] Schema is up to date.`);
}

main().catch((error) => {
  console.error(`[setup-test-db] FAILED: ${(error as Error).message}`);
  if ((error as Error).stack) {
    console.error((error as Error).stack);
  }
  process.exitCode = 1;
});
