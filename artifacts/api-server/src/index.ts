// Sentry MUST initialize before any module that registers route handlers
// is imported, otherwise async errors raised during module evaluation
// (and Sentry's auto-instrumentation hooks) miss the window. Static
// `import` statements are hoisted and evaluated eagerly, so route
// modules are pulled in via dynamic `await import()` below — after
// initSentry() has run. See the architectural note in
// .local/tasks/task-348.md.
import { initSentry } from "./lib/sentry";
initSentry();

const { createServer } = await import("node:http");
type Server = import("node:http").Server;
type RequestListener = import("node:http").RequestListener;
type ScheduleAutoCompleteSweeperHandle = ReturnType<
  (typeof import("./routes/schedule"))["startScheduleAutoCompleteSweeper"]
>;
type TempUploadSweeperHandle = ReturnType<
  (typeof import("./lib/uploads"))["startTempUploadSweeper"]
>;

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);
const host = process.env["HOST"] || "0.0.0.0";

if (
  Number.isNaN(port) ||
  !Number.isInteger(port) ||
  port <= 0 ||
  port > 65535
) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const SHUTDOWN_DRAIN_MS = 10_000;

// Replit Autoscale requires the declared port to open within its readiness
// window. The production bundle is intentionally large, so bind a minimal
// startup listener before loading route modules and applying migrations. The
// real Express handler replaces it atomically once bootstrap completes.
let requestHandler: RequestListener = (req, res) => {
  const pathname = req.url?.split("?", 1)[0] ?? "/";
  const isStartupProbe = pathname === "/" || pathname === "/api/livez";

  res.statusCode = isStartupProbe ? 200 : 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (!isStartupProbe) res.setHeader("Retry-After", "5");
  res.end(JSON.stringify({ status: "starting" }));
};

const server = createServer((req, res) => requestHandler(req, res));

let logStartupFailure = (error: unknown) => {
  console.error("Server startup failed", error);
};

server.on("error", (error) => {
  logStartupFailure(error);
  process.exit(1);
});

await new Promise<void>((resolve) => {
  server.listen(port, host, resolve);
});
console.log(`[boot] Startup listener active on ${host}:${port}`);

async function bootstrap() {
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { pool } = await import("@workspace/db");
  const { applyMigrations } = await import("@workspace/db/migrate");
  const { default: app, prepareApp } = await import("./app");
  const { logger } = await import("./lib/logger");
  const { assertProductionEmailConfiguration } = await import("./lib/email");
  const { resolveSupabaseUrl } = await import("./lib/supabase-url");
  const { initRealtime } = await import("./lib/realtime");
  const { startScheduleAutoCompleteSweeper } =
    await import("./routes/schedule");
  const { startTempUploadSweeper } = await import("./lib/uploads");

  logStartupFailure = (error) => {
    logger.error({ err: error }, "Server startup failed");
  };

  assertProductionEmailConfiguration();
  // Boot diagnostic: env presence (no values, just booleans) so a missing
  // secret in production shows up before anything else evaluates. Replaces
  // the older boot-diagnostic.ts shim that wrote raw stderr lines.
  logger.info(
    {
      pid: process.pid,
      port,
      host,
      nodeEnv: process.env["NODE_ENV"] ?? null,
      hasSupabaseDb: Boolean(process.env["SUPABASE_DATABASE_URL"]),
      hasJwtUpload: Boolean(process.env["JWT_UPLOAD_SECRET"]),
      hasSupabaseUrl: Boolean(resolveSupabaseUrl()),
      hasSupabaseStorageBucket: Boolean(process.env["SUPABASE_STORAGE_BUCKET"]),
      hasSupabaseServiceRoleKey: Boolean(
        process.env["SUPABASE_SERVICE_ROLE_KEY"],
      ),
    },
    "boot",
  );

  // Apply pending schema migrations before the full application accepts
  // traffic. Only the minimal startup probe is available while this runs.
  // This is the only thing that runs migrations against production —
  // Replit's build step does not. The runner is idempotent and uses
  // the same connection pool (same DATABASE_URL / SUPABASE_DATABASE_URL)
  // as the rest of the server, so it always targets the right database.
  // See "schema migrations run on deploy" in `replit.md` and Task #385.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, "migrations");
  logger.info({ migrationsDir }, "Applying pending migrations");
  const migrationResult = await applyMigrations(pool, { migrationsDir });
  logger.info(
    {
      applied: migrationResult.applied,
      baselined: migrationResult.baselined,
      skippedCount: migrationResult.skipped.length,
    },
    migrationResult.applied.length > 0
      ? "Migrations applied"
      : "No pending migrations",
  );

  await prepareApp();

  requestHandler = app;
  initRealtime(server);

  // Periodically prune orphaned temp upload files left behind by crashed
  // requests. Started after prepareApp() so the temp dir definitely exists.
  const tempUploadSweeper = startTempUploadSweeper();

  // Periodically apply auto-complete-overdue to schedule items now that
  // the schedule GET endpoint is read-only.
  const scheduleAutoCompleteSweeper = startScheduleAutoCompleteSweeper();

  logger.info({ host, port }, "Application ready");

  registerShutdownHandlers(
    server,
    tempUploadSweeper,
    scheduleAutoCompleteSweeper,
    logger,
    pool,
  );
}

function registerShutdownHandlers(
  server: Server,
  tempUploadSweeper: TempUploadSweeperHandle,
  scheduleAutoCompleteSweeper: ScheduleAutoCompleteSweeperHandle,
  logger: (typeof import("./lib/logger"))["logger"],
  pool: import("pg").Pool,
) {
  let shuttingDown = false;

  const handleShutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress; forcing exit");
      process.exit(1);
    }

    shuttingDown = true;
    logger.info({ signal }, "Shutdown signal received — draining connections");

    tempUploadSweeper.stop();
    scheduleAutoCompleteSweeper.stop();

    const drainTimer = setTimeout(() => {
      logger.warn(
        { timeoutMs: SHUTDOWN_DRAIN_MS },
        "Drain timeout reached — forcing server close",
      );
      server.closeAllConnections?.();
    }, SHUTDOWN_DRAIN_MS);
    drainTimer.unref();

    server.close((closeErr) => {
      clearTimeout(drainTimer);

      if (closeErr) {
        logger.error({ err: closeErr }, "HTTP server close error");
      } else {
        logger.info("HTTP server closed");
      }

      pool
        .end()
        .then(() => {
          logger.info("Database pool closed");
          process.exit(closeErr ? 1 : 0);
        })
        .catch((poolErr: unknown) => {
          logger.error({ err: poolErr }, "Database pool close error");
          process.exit(1);
        });
    });
  };

  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);
}

void bootstrap().catch((err) => {
  logStartupFailure(err);
  server.close();
  process.exit(1);
});
