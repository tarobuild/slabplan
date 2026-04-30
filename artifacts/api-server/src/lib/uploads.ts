import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer, { type Field } from "multer";
import { logger } from "./logger";

const TMP_UPLOAD_DIR = path.resolve(process.cwd(), "tmp", "uploads");

export const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 100;
export const MAX_UPLOAD_FILE_COUNT = 20;

export function getTempUploadDir(): string {
  return TMP_UPLOAD_DIR;
}

export async function ensureTempUploadDir(): Promise<void> {
  await fs.mkdir(TMP_UPLOAD_DIR, { recursive: true });
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
