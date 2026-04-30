import { createServer, type Server } from "node:http";
import { pool } from "@workspace/db";
import app, { prepareApp } from "./app";
import { logger } from "./lib/logger";
import { initRealtime } from "./lib/realtime";
import {
  startScheduleAutoCompleteSweeper,
  type ScheduleAutoCompleteSweeperHandle,
} from "./routes/schedule";
import {
  startTempUploadSweeper,
  type TempUploadSweeperHandle,
} from "./lib/uploads";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);
const host = process.env["HOST"] || "0.0.0.0";

if (Number.isNaN(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const SHUTDOWN_DRAIN_MS = 10_000;

async function bootstrap() {
  await prepareApp();

  const server = createServer(app);

  initRealtime(server);

  // Periodically prune orphaned temp upload files left behind by crashed
  // requests. Started after prepareApp() so the temp dir definitely exists.
  const tempUploadSweeper = startTempUploadSweeper();

  // Periodically apply auto-complete-overdue to schedule items now that
  // the schedule GET endpoint is read-only.
  const scheduleAutoCompleteSweeper = startScheduleAutoCompleteSweeper();

  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });

  server.listen(port, host, () => {
    logger.info({ host, port }, "Server listening");
  });

  registerShutdownHandlers(server, tempUploadSweeper, scheduleAutoCompleteSweeper);
}

function registerShutdownHandlers(
  server: Server,
  tempUploadSweeper: TempUploadSweeperHandle,
  scheduleAutoCompleteSweeper: ScheduleAutoCompleteSweeperHandle,
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
  logger.error({ err }, "Server startup failed");
  process.exit(1);
});
