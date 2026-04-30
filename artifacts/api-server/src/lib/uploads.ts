import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer, { type Field } from "multer";
import { logger } from "./logger";

const TMP_UPLOAD_DIR = path.resolve(process.cwd(), "tmp", "uploads");

export const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 100;
export const MAX_UPLOAD_FILE_COUNT = 20;

// Default: delete temp upload files older than 6 hours, sweep every hour.
// Both knobs are overridable via env so operators can tune retention without
// a code change. Values are parsed as positive integers (ms); invalid values
// fall back to defaults.
export const DEFAULT_TEMP_UPLOAD_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_TEMP_UPLOAD_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export function getTempUploadDir(): string {
  return TMP_UPLOAD_DIR;
}

export async function ensureTempUploadDir(): Promise<void> {
  await fs.mkdir(TMP_UPLOAD_DIR, { recursive: true });
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    logger.warn(
      { envVar: name, value: raw, fallback },
      "Ignoring invalid temp-upload sweeper env var; using default",
    );
    return fallback;
  }
  return parsed;
}

export interface SweepTempUploadsOptions {
  /** Files older than this many ms are eligible for deletion. */
  maxAgeMs: number;
  /** Override the directory to sweep (defaults to the shared temp dir). */
  directory?: string;
  /** Override "now" — useful for tests. */
  now?: number;
}

export interface SweepTempUploadsResult {
  scanned: number;
  deleted: number;
  failed: number;
  skipped: number;
}

/**
 * Delete files in the temp upload directory whose mtime is older than
 * `maxAgeMs`. Files newer than the threshold are left alone, so any uploads
 * currently in flight are never removed out from under multer. Returns a
 * small summary that callers can use for logging or assertions in tests.
 */
export async function sweepTempUploads(
  options: SweepTempUploadsOptions,
): Promise<SweepTempUploadsResult> {
  const directory = options.directory ?? TMP_UPLOAD_DIR;
  const now = options.now ?? Date.now();
  const result: SweepTempUploadsResult = {
    scanned: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
  };

  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return result;
    throw err;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    result.scanned += 1;
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") continue;
      result.failed += 1;
      logger.warn({ err, path: fullPath }, "Temp upload sweeper: stat failed");
      continue;
    }

    // Only sweep regular files; never recurse into subdirectories.
    if (!stat.isFile()) {
      result.skipped += 1;
      continue;
    }

    const ageMs = now - stat.mtimeMs;
    if (ageMs < options.maxAgeMs) {
      result.skipped += 1;
      continue;
    }

    try {
      await fs.unlink(fullPath);
      result.deleted += 1;
      logger.debug(
        { path: fullPath, ageMs },
        "Temp upload sweeper: deleted orphaned file",
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") continue;
      result.failed += 1;
      logger.warn(
        { err, path: fullPath },
        "Temp upload sweeper: unlink failed",
      );
    }
  }

  return result;
}

export interface StartTempUploadSweeperOptions {
  /** Files older than this many ms are deleted. */
  maxAgeMs?: number;
  /** Run the sweep every this many ms. */
  intervalMs?: number;
}

export interface TempUploadSweeperHandle {
  /** Stop the sweeper. Safe to call multiple times. */
  stop: () => void;
  /** Run a sweep immediately (used internally and in tests). */
  runNow: () => Promise<SweepTempUploadsResult>;
}

/**
 * Start a periodic sweeper that prunes orphaned temp upload files. Crashes
 * mid-upload can leave files in the temp directory; without a sweeper they
 * accumulate forever. We run the sweep once at startup and then on a fixed
 * interval. The returned handle lets callers stop the timer (e.g. on
 * shutdown).
 */
export function startTempUploadSweeper(
  options: StartTempUploadSweeperOptions = {},
): TempUploadSweeperHandle {
  const maxAgeMs =
    options.maxAgeMs ??
    parsePositiveIntEnv(
      "TEMP_UPLOAD_MAX_AGE_MS",
      DEFAULT_TEMP_UPLOAD_MAX_AGE_MS,
    );
  const intervalMs =
    options.intervalMs ??
    parsePositiveIntEnv(
      "TEMP_UPLOAD_SWEEP_INTERVAL_MS",
      DEFAULT_TEMP_UPLOAD_SWEEP_INTERVAL_MS,
    );

  let running = false;

  const runNow = async (): Promise<SweepTempUploadsResult> => {
    if (running) {
      return { scanned: 0, deleted: 0, failed: 0, skipped: 0 };
    }
    running = true;
    try {
      const summary = await sweepTempUploads({ maxAgeMs });
      if (summary.scanned > 0 || summary.deleted > 0 || summary.failed > 0) {
        logger.info(
          {
            ...summary,
            maxAgeMs,
            directory: TMP_UPLOAD_DIR,
          },
          "Temp upload sweep complete",
        );
      }
      return summary;
    } catch (err) {
      logger.error({ err }, "Temp upload sweep failed");
      return { scanned: 0, deleted: 0, failed: 0, skipped: 0 };
    } finally {
      running = false;
    }
  };

  // Kick off an initial sweep, but don't await it — bootstrap should not
  // block on disk I/O.
  void runNow();

  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  // Don't keep the event loop alive purely for this timer.
  timer.unref();

  logger.info(
    { maxAgeMs, intervalMs, directory: TMP_UPLOAD_DIR },
    "Temp upload sweeper started",
  );

  return {
    stop: () => clearInterval(timer),
    runNow,
  };
}

const diskStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, TMP_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "");
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

export interface UploadMiddlewareOptions {
  fileSize?: number;
  files?: number;
}

export function createUploadMiddleware(options?: UploadMiddlewareOptions) {
  return multer({
    storage: diskStorage,
    limits: {
      fileSize: options?.fileSize ?? MAX_UPLOAD_FILE_BYTES,
      files: options?.files ?? MAX_UPLOAD_FILE_COUNT,
    },
  });
}

const sharedUpload = createUploadMiddleware();

export async function cleanupTempUpload(
  file: Express.Multer.File | undefined | null,
): Promise<void> {
  if (!file?.path) return;
  try {
    await fs.unlink(file.path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    logger.warn({ err, path: file.path }, "Failed to clean up temp upload");
  }
}

export async function cleanupTempUploads(
  files: ReadonlyArray<Express.Multer.File> | undefined | null,
): Promise<void> {
  if (!files || files.length === 0) return;
  await Promise.all(files.map((file) => cleanupTempUpload(file)));
}

function collectRequestUploads(req: Request): Express.Multer.File[] {
  const collected: Express.Multer.File[] = [];

  if (Array.isArray(req.files)) {
    collected.push(...req.files);
  } else if (req.files && typeof req.files === "object") {
    for (const group of Object.values(req.files)) {
      if (Array.isArray(group)) {
        collected.push(...group);
      }
    }
  }

  if (req.file) {
    collected.push(req.file);
  }

  return collected;
}

function attachResponseCleanup(req: Request, res: Response): void {
  let triggered = false;
  const cleanup = () => {
    if (triggered) return;
    triggered = true;
    res.removeListener("finish", cleanup);
    res.removeListener("close", cleanup);
    cleanupTempUploads(collectRequestUploads(req)).catch((err) =>
      logger.warn({ err }, "Failed to clean up temp uploads after response"),
    );
  };
  res.once("finish", cleanup);
  res.once("close", cleanup);
}

function wrapMulter(handler: RequestHandler): RequestHandler {
  return function uploadAndCleanup(req, res, next) {
    handler(req, res, async (err: unknown) => {
      if (err) {
        await cleanupTempUploads(collectRequestUploads(req)).catch(() => {});
        next(err);
        return;
      }
      attachResponseCleanup(req, res);
      next();
    });
  };
}

export function uploadArray(
  fieldName: string,
  maxCount: number = MAX_UPLOAD_FILE_COUNT,
  options?: UploadMiddlewareOptions,
): RequestHandler {
  const middleware = options
    ? createUploadMiddleware(options).array(fieldName, maxCount)
    : sharedUpload.array(fieldName, maxCount);
  return wrapMulter(middleware);
}

export function uploadFields(
  fields: Field[],
  options?: UploadMiddlewareOptions,
): RequestHandler {
  const middleware = options
    ? createUploadMiddleware(options).fields(fields)
    : sharedUpload.fields(fields);
  return wrapMulter(middleware);
}

export function uploadSingle(
  fieldName: string,
  options?: UploadMiddlewareOptions,
): RequestHandler {
  const middleware = options
    ? createUploadMiddleware(options).single(fieldName)
    : sharedUpload.single(fieldName);
  return wrapMulter(middleware);
}
