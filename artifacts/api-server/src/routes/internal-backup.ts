import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { logger } from "../lib/logger";
import { HttpError, asyncHandler } from "../lib/http";

/**
 * Internal webhook that lets an external scheduler (e.g. a GitHub Actions
 * cron job) trigger the daily database backup without needing direct
 * Postgres or object-storage credentials. The actual upload is performed
 * by the api-server process itself, which already has the Replit sidecar
 * credentials baked into its environment — solving the "GitHub runner
 * cannot reach the sidecar" problem from the previous review.
 *
 * Auth: a single shared `BACKUP_TRIGGER_SECRET` env var. Compared with
 * `crypto.timingSafeEqual` to avoid timing leaks, even though only the
 * scheduler ever calls this. Returns 503 if the secret is unset (so the
 * endpoint is dormant until an operator opts in).
 */

const router: IRouter = Router();

/**
 * Locate `scripts/db-backup.mjs` regardless of how the api-server was
 * launched. The script lives next to the api-server `package.json`
 * (`artifacts/api-server/scripts/db-backup.mjs`); we try, in order:
 *   1. `<cwd>/scripts/db-backup.mjs` — process started from the package
 *      directory, which is the production launch convention and what
 *      `pnpm --filter @workspace/api-server run dev` does.
 *   2. `<this-file>/../../../scripts/db-backup.mjs` (dev: `src/routes/`)
 *      and `<this-file>/../scripts/db-backup.mjs` (prod bundled
 *      `dist/index.mjs`). Resolved via `import.meta.url`.
 *   3. `<cwd>/artifacts/api-server/scripts/db-backup.mjs` — process
 *      started from the monorepo root.
 * First existing path wins. Throws a descriptive error if none of
 * these match so a misconfigured deployment fails loudly instead of
 * silently never backing up.
 */
function resolveBackupScriptPath(): string {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    path.resolve(process.cwd(), "scripts/db-backup.mjs"),
    path.resolve(here, "../../../scripts/db-backup.mjs"),
    path.resolve(here, "../scripts/db-backup.mjs"),
    path.resolve(process.cwd(), "artifacts/api-server/scripts/db-backup.mjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not locate db-backup.mjs. Tried: ${candidates.join(", ")}`,
  );
}


function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.post(
  "/internal/run-db-backup",
  asyncHandler(async (req, res) => {
    const expected = process.env.BACKUP_TRIGGER_SECRET;
    if (!expected || expected.length < 32) {
      throw new HttpError(
        503,
        "Backup webhook is disabled: BACKUP_TRIGGER_SECRET is unset or too short.",
      );
    }
    const presented =
      typeof req.headers["x-backup-secret"] === "string"
        ? (req.headers["x-backup-secret"] as string)
        : "";
    if (!presented || !constantTimeEqual(presented, expected)) {
      throw new HttpError(401, "Invalid backup webhook credentials.");
    }

    const scriptPath = resolveBackupScriptPath();

    logger.info(
      { scriptPath, requesterIp: req.ip },
      "[internal-backup] dispatching scheduled db backup",
    );

    // Fire-and-forget: the backup can take longer than the scheduler's
    // request timeout, so we acknowledge immediately and let the script
    // log its progress to stdout (which goes to deployment logs). We
    // still wait for `spawn` itself to succeed so a misconfiguration
    // (e.g. wrong path) is reported synchronously.
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
      detached: false,
    });

    let spawnErr: Error | null = null;
    await new Promise<void>((resolve) => {
      const onErr = (err: Error) => {
        spawnErr = err;
        resolve();
      };
      const onSpawn = () => {
        child.removeListener("error", onErr);
        resolve();
      };
      child.once("error", onErr);
      child.once("spawn", onSpawn);
    });

    if (spawnErr) {
      logger.error(
        { err: (spawnErr as Error).message },
        "[internal-backup] failed to spawn db-backup script",
      );
      throw new HttpError(500, `Failed to spawn db-backup script: ${(spawnErr as Error).message}`);
    }

    child.on("exit", (code, signal) => {
      if (code === 0) {
        logger.info({ pid: child.pid }, "[internal-backup] db-backup completed");
      } else {
        logger.error(
          { pid: child.pid, code, signal },
          "[internal-backup] db-backup exited non-zero",
        );
      }
    });

    res.status(202).json({
      status: "accepted",
      pid: child.pid,
      message:
        "Backup started in the background. Watch deployment logs for backup_done / backup_failed events.",
    });
  }),
);

export default router;
