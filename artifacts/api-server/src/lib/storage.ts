import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import { Storage } from "@google-cloud/storage";
import {
  FILE_RESPONSE_CSP,
  resolveSafeFileServingHeaders,
} from "./file-serving";
import { HttpError } from "./http";
import { logger } from "./logger";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function getPrivateObjectDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR is not set. Provision object storage before serving uploads.",
    );
  }
  return dir;
}

function parseBucketAndPrefix(fullPath: string) {
  const normalized = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 1) {
    throw new Error(`Invalid PRIVATE_OBJECT_DIR: ${fullPath}`);
  }
  const bucketName = parts[0];
  const prefix = parts.slice(1).join("/");
  return { bucketName, prefix };
}

function fileUrlToObject(fileUrl: string): { bucketName: string; objectName: string } {
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("Stored file URL is missing.");
  }
  const match = /^\/uploads\/(.+)$/.exec(fileUrl);
  if (!match) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  const relative = match[1];
  if (relative.includes("..") || relative.startsWith("/") || relative.includes("\0")) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  const { bucketName, prefix } = parseBucketAndPrefix(getPrivateObjectDir());
  const segments = [prefix, "cadstone", "uploads", relative].filter(Boolean);
  return { bucketName, objectName: segments.join("/") };
}

function normalizeFileComponent(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function ensureUploadRoot(): Promise<void> {
  // Object storage requires no filesystem preparation; retained for backwards
  // compatibility with existing startup code.
}

export function buildStoredFileName(originalName: string) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const normalizedBase = normalizeFileComponent(base) || "file";
  const normalizedExt = normalizeFileComponent(ext) || ext.toLowerCase();

  return `${Date.now()}-${crypto.randomUUID()}-${normalizedBase}${normalizedExt}`;
}

export function buildUploadPath(params: {
  jobId: string;
  mediaType: string;
  storedFileName: string;
}) {
  const relative = path.posix.join(params.jobId, params.mediaType, params.storedFileName);
  return {
    relative,
    fileUrl: `/uploads/${relative}`,
  };
}

export async function writeUploadedBuffer(
  fileUrl: string,
  buffer: Buffer,
  options?: { contentType?: string | null },
): Promise<void> {
  const { bucketName, objectName } = fileUrlToObject(fileUrl);
  const file = storageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    resumable: false,
    contentType: options?.contentType ?? "application/octet-stream",
  });
}

export async function writeUploadedFromPath(
  fileUrl: string,
  sourcePath: string,
  options?: { contentType?: string | null },
): Promise<void> {
  const { bucketName, objectName } = fileUrlToObject(fileUrl);
  const file = storageClient.bucket(bucketName).file(objectName);
  const writeStream = file.createWriteStream({
    resumable: false,
    contentType: options?.contentType ?? "application/octet-stream",
  });
  await pipeline(createReadStream(sourcePath), writeStream);
}

export async function deletePhysicalFile(fileUrl: string | null | undefined): Promise<void> {
  if (!fileUrl) {
    return;
  }
  try {
    const { bucketName, objectName } = fileUrlToObject(fileUrl);
    await storageClient
      .bucket(bucketName)
      .file(objectName)
      .delete({ ignoreNotFound: true });
  } catch (error) {
    logger.warn({ err: error, fileUrl }, "Failed to delete stored file");
  }
}

export async function storedFileExists(fileUrl: string | null | undefined): Promise<boolean> {
  if (!fileUrl) {
    return false;
  }
  try {
    const { bucketName, objectName } = fileUrlToObject(fileUrl);
    const [exists] = await storageClient.bucket(bucketName).file(objectName).exists();
    return exists;
  } catch (error) {
    logger.warn({ err: error, fileUrl }, "Failed to probe stored file existence");
    return false;
  }
}

export function openStoredFileReadStream(fileUrl: string): Readable {
  const { bucketName, objectName } = fileUrlToObject(fileUrl);
  return storageClient.bucket(bucketName).file(objectName).createReadStream();
}

export interface SendStoredFileOptions {
  disposition: "inline" | "attachment";
  filename: string;
  /**
   * @deprecated Ignored. The served Content-Type is always derived
   * from the filename's extension against the allowlist in
   * `lib/file-serving.ts`; honouring a caller-supplied (and
   * ultimately client-claimed) MIME type would defeat the XSS
   * protections this helper exists to enforce.
   */
  contentType?: string | null;
  cacheControl?: string;
}

export async function streamStoredFileToResponse(
  res: Response,
  fileUrl: string,
  opts: SendStoredFileOptions,
): Promise<void> {
  const { bucketName, objectName } = fileUrlToObject(fileUrl);
  const file = storageClient.bucket(bucketName).file(objectName);

  let size: string | number | undefined;
  try {
    const [metadata] = await file.getMetadata();
    size = metadata.size;
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 404) {
      throw new HttpError(404, "Stored file missing.");
    }
    throw error;
  }

  const filename = opts.filename || objectName.split("/").pop() || "file";
  const headers = resolveSafeFileServingHeaders({
    originalName: filename,
    requestedDisposition: opts.disposition,
  });

  res.setHeader("Content-Type", headers.contentType);
  res.setHeader("Content-Disposition", headers.contentDispositionHeader);
  // nosniff stops browsers from second-guessing our Content-Type and
  // running an HTML payload that we served as application/octet-stream.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Even when a browser ignores the disposition (e.g. a user opens the
  // download in a new tab and the type happens to be renderable), this
  // CSP keeps any embedded scripts from running.
  res.setHeader("Content-Security-Policy", FILE_RESPONSE_CSP);
  res.setHeader("Cache-Control", opts.cacheControl ?? "private, max-age=3600");
  if (size !== undefined && size !== null) {
    res.setHeader("Content-Length", String(size));
  }

  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const cleanup = () => {
      stream.removeAllListeners();
      res.removeListener("close", onResClose);
    };

    const onResClose = () => {
      if (!res.writableEnded) {
        stream.destroy();
        settle(() => {
          cleanup();
          resolve();
        });
      }
    };

    stream.on("error", (err) => {
      const code = (err as { code?: number })?.code;
      logger.error({ err, fileUrl }, "Stored file read stream error");
      if (!res.headersSent) {
        res.status(code === 404 ? 404 : 500).end();
      } else {
        res.destroy(err);
      }
      settle(() => {
        cleanup();
        reject(err);
      });
    });

    stream.on("end", () => {
      settle(() => {
        cleanup();
        resolve();
      });
    });

    res.on("close", onResClose);
    stream.pipe(res);
  });
}

export function resolveAbsolutePathFromFileUrl(_fileUrl: string): never {
  throw new Error(
    "resolveAbsolutePathFromFileUrl is no longer supported; use streamStoredFileToResponse or openStoredFileReadStream.",
  );
}
