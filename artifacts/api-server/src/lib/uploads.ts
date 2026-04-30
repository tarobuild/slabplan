import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer, {
  type Field,
  MulterError,
  type StorageEngine,
} from "multer";
import {
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILE_COUNT,
  formatUploadSize,
} from "@workspace/api-zod";
import { HttpError } from "./http";
import { logger } from "./logger";
import { deletePhysicalFile } from "./storage";
import { validateMagicBytesForFiles } from "./upload-magic-bytes";
import { multipartIdempotencyMiddleware } from "../middleware/idempotency";

const TMP_UPLOAD_DIR = path.resolve(process.cwd(), "tmp", "uploads");

// Re-export the shared constants so existing call sites that import them
// from this module continue to work. The single source of truth lives in
// @workspace/api-zod so the frontend picker and the backend multer config
// cannot drift apart.
export { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILE_COUNT };

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

// Multer storage engine that streams the uploaded part to disk while
// computing a SHA-256 of the bytes in the same pass. The hash is exposed
// as `contentHash` on the resulting Multer file so downstream code (the
// idempotency middleware) can fingerprint the request body without a
// second read of (potentially very large) files.
const hashingDiskStorage: StorageEngine = {
  _handleFile(_req, file, cb) {
    const ext = path.extname(file.originalname || "");
    const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const finalPath = path.join(TMP_UPLOAD_DIR, filename);

    const hash = crypto.createHash("sha256");
    let size = 0;
    const hashing = new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk as Buffer);
        size += (chunk as Buffer).length;
        done(null, chunk);
      },
    });

    const out = createWriteStream(finalPath);

    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      // Best-effort cleanup of the partial file; multer will also call
      // _removeFile on error, so swallow ENOENT here.
      out.destroy();
      hashing.destroy();
      void fs.unlink(finalPath).catch(() => {});
      cb(err as Error);
    };

    file.stream.on("error", fail);
    hashing.on("error", fail);
    out.on("error", fail);

    out.on("finish", () => {
      if (settled) return;
      settled = true;
      cb(null, {
        destination: TMP_UPLOAD_DIR,
        filename,
        path: finalPath,
        size,
        contentHash: hash.digest("hex"),
      } as Express.Multer.File);
    });

    file.stream.pipe(hashing).pipe(out);
  },
  _removeFile(_req, file, cb) {
    fs.unlink(file.path).then(
      () => cb(null),
      (err: NodeJS.ErrnoException) => {
        if (err?.code === "ENOENT") {
          cb(null);
          return;
        }
        cb(err);
      },
    );
  },
};

export interface UploadMiddlewareOptions {
  fileSize?: number;
  files?: number;
}

export function createUploadMiddleware(options?: UploadMiddlewareOptions) {
  return multer({
    storage: hashingDiskStorage,
    limits: {
      fileSize: options?.fileSize ?? MAX_UPLOAD_FILE_BYTES,
      files: options?.files ?? MAX_UPLOAD_FILE_COUNT,
    },
  });
}

const sharedUpload = createUploadMiddleware();

/**
 * Best-effort delete of a stored object after a route's downstream step
 * (DB insert, activity log write, etc.) fails. Never throws — the caller
 * is already on the failure path and just wants to make sure they aren't
 * leaving an orphaned object behind. Failures are logged with `context`
 * so operators can correlate them with the originating route.
 */
export async function deletePhysicalFileBestEffort(
  fileUrl: string | null | undefined,
  context: string,
): Promise<void> {
  if (!fileUrl) return;
  try {
    await deletePhysicalFile(fileUrl);
  } catch (error) {
    logger.error(
      { err: error, fileUrl, context },
      "Failed to delete physical file during rollback",
    );
  }
}

export interface PersistWithStorageRollbackParams<TResult> {
  /** Object-storage URL that was just written and must be cleaned up if anything below fails. */
  fileUrl: string;
  /** Tag used in rollback log lines so operators can trace the originating route. */
  context: string;
  /** Required DB writes. May be a single statement or a transaction; whatever it
   *  returns is passed to `postCommit` and `rollback`. */
  persist: () => Promise<TResult>;
  /** Optional follow-up step that runs only after `persist` resolves
   *  successfully (e.g. activity log write). If it throws, `rollback` is
   *  invoked with the `persist` result and the storage object is deleted. */
  postCommit?: (result: TResult) => Promise<void>;
  /** Optional cleanup for rows committed by `persist` when `postCommit`
   *  fails. Not invoked when `persist` itself throws (the caller is
   *  expected to wrap `persist` in a transaction so it self-rolls back). */
  rollback?: (result: TResult) => Promise<void>;
}

/**
 * Run a DB persist step plus an optional follow-up step within a single
 * upload-rollback boundary. If anything fails, the freshly uploaded
 * object at `fileUrl` is deleted best-effort, and any rows committed by
 * `persist` are removed via `rollback`. Use this for the
 * upload-then-write-rows-then-write-activity pattern: it makes failure
 * cleanup symmetrical instead of leaving orphans in either storage or
 * the database.
 */
export async function persistWithStorageRollback<TResult>(
  params: PersistWithStorageRollbackParams<TResult>,
): Promise<TResult> {
  let result: TResult | undefined;
  let persistCommitted = false;

  try {
    result = await params.persist();
    persistCommitted = true;

    if (params.postCommit) {
      await params.postCommit(result);
    }

    return result;
  } catch (error) {
    if (persistCommitted && result !== undefined && params.rollback) {
      try {
        await params.rollback(result);
      } catch (rollbackError) {
        logger.error(
          { err: rollbackError, context: params.context },
          "Failed to roll back DB rows after upload failure",
        );
      }
    }

    await deletePhysicalFileBestEffort(params.fileUrl, params.context);
    throw error;
  }
}

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

/**
 * Map a multer error to an HttpError so the global error handler renders
 * it as a clean problem+json response with the right status code. Without
 * this, multer's `LIMIT_FILE_SIZE` would surface as a generic 500.
 *
 * The detail message names the actual limit so clients can tell the user
 * exactly how big a file they're allowed to upload, even if the limit
 * changes server-side without a client redeploy.
 */
function multerErrorToHttpError(
  err: MulterError,
  limits: { fileSize: number; files: number },
): HttpError {
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return new HttpError(
        413,
        `File exceeds the ${formatUploadSize(limits.fileSize)} upload size limit.`,
        { limit: limits.fileSize, code: err.code, field: err.field },
        "payload-too-large",
      );
    case "LIMIT_FILE_COUNT":
      return new HttpError(
        413,
        `Too many files in one request (limit is ${limits.files}).`,
        { limit: limits.files, code: err.code },
        "payload-too-large",
      );
    case "LIMIT_PART_COUNT":
    case "LIMIT_FIELD_COUNT":
    case "LIMIT_FIELD_VALUE":
    case "LIMIT_FIELD_KEY":
      return new HttpError(
        413,
        `Request payload too large: ${err.message}.`,
        { code: err.code, field: err.field },
        "payload-too-large",
      );
    case "LIMIT_UNEXPECTED_FILE":
      return new HttpError(
        400,
        `Unexpected file field${err.field ? ` "${err.field}"` : ""}.`,
        { code: err.code, field: err.field },
        "validation",
      );
    default:
      return new HttpError(
        400,
        `Upload failed: ${err.message}.`,
        { code: err.code, field: err.field },
        "validation",
      );
  }
}

// Lazily-instantiated singleton — multipartIdempotencyMiddleware() returns
// a closure that does real work; building it once and reusing avoids
// creating a fresh closure (and re-resolving the import) on every upload.
let cachedMultipartIdempotency: RequestHandler | null = null;
function getMultipartIdempotency(): RequestHandler {
  if (!cachedMultipartIdempotency) {
    cachedMultipartIdempotency = multipartIdempotencyMiddleware();
  }
  return cachedMultipartIdempotency;
}

function wrapMulter(
  handler: RequestHandler,
  limits: { fileSize: number; files: number },
): RequestHandler {
  return function uploadAndCleanup(req, res, next) {
    handler(req, res, async (err: unknown) => {
      if (err) {
        await cleanupTempUploads(collectRequestUploads(req)).catch(() => {});
        if (err instanceof MulterError) {
          next(multerErrorToHttpError(err, limits));
          return;
        }
        next(err);
        return;
      }
      attachResponseCleanup(req, res);

      // Magic-byte validation. Extension + Content-Type are trivially
      // spoofable, so before any route logic runs we sniff the bytes
      // multer already wrote to the temp file and reject mismatches
      // with a 415 problem+json. This runs after `attachResponseCleanup`
      // so the temp files get purged regardless of which middleware
      // sends the response.
      try {
        await validateMagicBytesForFiles(collectRequestUploads(req));
      } catch (validationErr) {
        next(validationErr);
        return;
      }

      // Run the multipart-aware idempotency check now that multer has
      // parsed the form fields and populated `contentHash` on every
      // saved file. The global idempotency middleware (which fingerprints
      // by JSON body) skips multipart writes specifically so this hook
      // can fingerprint by file content instead.
      getMultipartIdempotency()(req, res, next);
    });
  };
}

function resolveLimits(options?: UploadMiddlewareOptions): {
  fileSize: number;
  files: number;
} {
  return {
    fileSize: options?.fileSize ?? MAX_UPLOAD_FILE_BYTES,
    files: options?.files ?? MAX_UPLOAD_FILE_COUNT,
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
  // Two limits race here: multer's global `limits.files` and the
  // per-field `array(_, maxCount)` cap. Whichever fires first
  // surfaces the error, so the *effective* file-count limit users
  // run into is the smaller of the two. Pass that through to the
  // error mapper so problem+json messages name the actual cap.
  const baseLimits = resolveLimits(options);
  return wrapMulter(middleware, {
    ...baseLimits,
    files: Math.min(baseLimits.files, maxCount),
  });
}

export function uploadFields(
  fields: Field[],
  options?: UploadMiddlewareOptions,
): RequestHandler {
  const middleware = options
    ? createUploadMiddleware(options).fields(fields)
    : sharedUpload.fields(fields);
  return wrapMulter(middleware, resolveLimits(options));
}

export function uploadSingle(
  fieldName: string,
  options?: UploadMiddlewareOptions,
): RequestHandler {
  const middleware = options
    ? createUploadMiddleware(options).single(fieldName)
    : sharedUpload.single(fieldName);
  return wrapMulter(middleware, resolveLimits(options));
}
