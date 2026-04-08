import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { initRealtime } from "./lib/realtime";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);
const host = process.env["HOST"] || "0.0.0.0";

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function bootstrap() {
  const server = createServer(app);

  initRealtime(server);

  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });

  server.listen(port, host, () => {
    logger.info({ host, port }, "Server listening");
  });
}

void bootstrap().catch((err) => {
  logger.error({ err }, "Server startup failed");
  process.exit(1);
});
