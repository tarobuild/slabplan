import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import type { Writable } from "node:stream";
import type { Request } from "express";
import { MAX_UPLOAD_FILE_BYTES, formatUploadSize } from "@workspace/api-zod";
import { HttpError } from "./http";
import type { DuplicateAction } from "./file-manager";

const CHUNKED_UPLOAD_ROOT = path.resolve(process.cwd(), "tmp", "chunked-uploads");
const DEFAULT_MAX_TOTAL_BYTES = MAX_UPLOAD_FILE_BYTES;
const DEFAULT_MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOTAL_CHUNKS = 10_000;
const BASE64_CHUNK_CONTENT_TYPES = new Set(["text/plain", "application/base64"]);

export type ChunkedUploadSession = {
  uploadId: string;
  folderId: string;
  userId: string;
  originalName: string;
  mimeType: string;
  totalSize: number;
  totalChunks: number;
  contentHash: string | null;
  note: string | null;
  duplicateAction: DuplicateAction;
  videoDurationSeconds: number | null;
  createdAt: string;
  expiresAt: string;
};

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getChunkedUploadLimits() {
  return {
    maxTotalBytes: readPositiveIntEnv("CADSTONE_CHUNKED_UPLOAD_MAX_BYTES", DEFAULT_MAX_TOTAL_BYTES),
    maxChunkBytes: readPositiveIntEnv("CADSTONE_CHUNKED_UPLOAD_MAX_CHUNK_BYTES", DEFAULT_MAX_CHUNK_BYTES),
    sessionTtlMs: readPositiveIntEnv("CADSTONE_CHUNKED_UPLOAD_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS),
  };
}

function assertSafeUploadId(uploadId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new HttpError(404, "Chunked upload session not found.", { code: "CHUNKED_UPLOAD_NOT_FOUND" }, "not-found");
  }
}

function normalizeContentHash(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

function sessionDir(uploadId: string) {
  assertSafeUploadId(uploadId);
  return path.join(CHUNKED_UPLOAD_ROOT, uploadId);
}

function sessionFile(uploadId: string) {
  return path.join(sessionDir(uploadId), "session.json");
}

function chunksDir(uploadId: string) {
  return path.join(sessionDir(uploadId), "chunks");
}

function chunkPath(uploadId: string, chunkIndex: number) {
  return path.join(chunksDir(uploadId), String(chunkIndex));
}

function assembledPath(uploadId: string) {
  return path.join(sessionDir(uploadId), "assembled-upload");
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return Buffer.from(chunk as ArrayBuffer);
}

function contentTypeWithoutParams(req: Request): string {
  return (req.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isBase64ChunkRequest(req: Request): boolean {
  return BASE64_CHUNK_CONTENT_TYPES.has(contentTypeWithoutParams(req));
}

function trackWritableErrors(out: Writable) {
  let streamError: unknown = null;
  const errorPromise = new Promise<never>((_, reject) => {
    out.once("error", (error) => {
      streamError = error;
      reject(error);
    });
  });
  errorPromise.catch(() => {});

  return {
    errorPromise,
    throwIfError() {
      if (streamError) throw streamError;
    },
  };
}

async function writeOrWaitForDrain(
  out: Writable,
  buffer: Buffer,
  tracker: ReturnType<typeof trackWritableErrors>,
) {
  tracker.throwIfError();
  if (!out.write(buffer)) {
    await Promise.race([once(out, "drain"), tracker.errorPromise]);
  }
  tracker.throwIfError();
}

async function endWritable(
  out: Writable,
  tracker: ReturnType<typeof trackWritableErrors>,
) {
  out.end();
  await Promise.race([once(out, "finish"), tracker.errorPromise]);
  tracker.throwIfError();
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function createChunkedUploadSession(params: {
  folderId: string;
  userId: string;
  originalName: string;
  mimeType: string | null | undefined;
  totalSize: number;
  totalChunks: number;
  contentHash?: string | null;
  note?: string | null;
  duplicateAction: DuplicateAction;
  videoDurationSeconds?: number | null;
}) {
  const limits = getChunkedUploadLimits();
  if (!Number.isSafeInteger(params.totalSize) || params.totalSize <= 0) {
    throw new HttpError(400, "totalSize must be a positive integer.", { code: "INVALID_TOTAL_SIZE" }, "validation");
  }
  if (params.totalSize > limits.maxTotalBytes) {
    throw new HttpError(
      413,
      `File exceeds the ${formatUploadSize(limits.maxTotalBytes)} chunked upload limit.`,
      { code: "FILE_TOO_LARGE", limit: limits.maxTotalBytes },
      "payload-too-large",
    );
  }
  if (!Number.isSafeInteger(params.totalChunks) || params.totalChunks <= 0 || params.totalChunks > MAX_TOTAL_CHUNKS) {
    throw new HttpError(400, "totalChunks is invalid.", { code: "INVALID_TOTAL_CHUNKS" }, "validation");
  }
  const minimumChunks = Math.ceil(params.totalSize / limits.maxChunkBytes);
  if (params.totalChunks < minimumChunks) {
    throw new HttpError(
      400,
      `totalChunks is too small for the declared totalSize. Use at least ${minimumChunks} chunks.`,
      {
        code: "INVALID_TOTAL_CHUNKS",
        minimumChunks,
        maxChunkBytes: limits.maxChunkBytes,
      },
      "validation",
    );
  }
  if (params.totalChunks > params.totalSize) {
    throw new HttpError(
      400,
      "totalChunks is too large for the declared totalSize.",
      {
        code: "INVALID_TOTAL_CHUNKS",
        maximumChunks: params.totalSize,
      },
      "validation",
    );
  }

  const now = new Date();
  const uploadId = crypto.randomUUID();
  const session: ChunkedUploadSession = {
    uploadId,
    folderId: params.folderId,
    userId: params.userId,
    originalName: params.originalName.trim(),
    mimeType: params.mimeType?.trim() || "application/octet-stream",
    totalSize: params.totalSize,
    totalChunks: params.totalChunks,
    contentHash: normalizeContentHash(params.contentHash),
    note: params.note?.trim() || null,
    duplicateAction: params.duplicateAction,
    videoDurationSeconds:
      typeof params.videoDurationSeconds === "number" && Number.isFinite(params.videoDurationSeconds) && params.videoDurationSeconds > 0
        ? Math.min(Math.round(params.videoDurationSeconds), 24 * 60 * 60)
        : null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + limits.sessionTtlMs).toISOString(),
  };

  await fs.mkdir(chunksDir(uploadId), { recursive: true });
  await fs.writeFile(sessionFile(uploadId), `${JSON.stringify(session, null, 2)}\n`, "utf8");

  return session;
}

export async function getChunkedUploadSession(uploadId: string): Promise<ChunkedUploadSession> {
  try {
    const session = await readJsonFile<ChunkedUploadSession>(sessionFile(uploadId));
    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw new HttpError(
        410,
        "Chunked upload session expired. Start a new upload session.",
        { code: "CHUNKED_UPLOAD_EXPIRED" },
        "gone",
      );
    }
    return session;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new HttpError(404, "Chunked upload session not found.", { code: "CHUNKED_UPLOAD_NOT_FOUND" }, "not-found");
    }
    throw error;
  }
}

export function assertChunkedUploadAccess(session: ChunkedUploadSession, params: {
  folderId: string;
  userId: string;
}) {
  if (session.folderId !== params.folderId || session.userId !== params.userId) {
    throw new HttpError(404, "Chunked upload session not found.", { code: "CHUNKED_UPLOAD_NOT_FOUND" }, "not-found");
  }
}

export async function listReceivedChunks(uploadId: string) {
  let entries: string[];
  try {
    entries = await fs.readdir(chunksDir(uploadId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }

  const chunks: Array<{ index: number; size: number }> = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const index = Number(entry);
    const stat = await fs.stat(path.join(chunksDir(uploadId), entry));
    if (stat.isFile()) {
      chunks.push({ index, size: stat.size });
    }
  }

  return chunks.sort((a, b) => a.index - b.index);
}

export async function getChunkedUploadStatus(session: ChunkedUploadSession) {
  const receivedChunks = await listReceivedChunks(session.uploadId);
  const receivedBytes = receivedChunks.reduce((sum, chunk) => sum + chunk.size, 0);
  const receivedIndexes = new Set(receivedChunks.map((chunk) => chunk.index));
  const missingChunks: number[] = [];
  for (let index = 0; index < session.totalChunks; index += 1) {
    if (!receivedIndexes.has(index)) missingChunks.push(index);
  }

  return {
    uploadId: session.uploadId,
    folderId: session.folderId,
    originalName: session.originalName,
    totalSize: session.totalSize,
    totalChunks: session.totalChunks,
    receivedBytes,
    receivedChunks,
    missingChunks,
    complete: missingChunks.length === 0,
    expiresAt: session.expiresAt,
    limits: getChunkedUploadLimits(),
  };
}

export async function writeChunkFromRequest(req: Request, session: ChunkedUploadSession, chunkIndex: number) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw new HttpError(400, "chunkIndex is out of range.", { code: "INVALID_CHUNK_INDEX" }, "validation");
  }

  const limits = getChunkedUploadLimits();
  const contentLength = Number(req.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > limits.maxChunkBytes) {
    throw new HttpError(
      413,
      `Chunk exceeds the ${formatUploadSize(limits.maxChunkBytes)} upload chunk limit.`,
      { code: "CHUNK_TOO_LARGE", limit: limits.maxChunkBytes },
      "payload-too-large",
    );
  }

  await fs.mkdir(chunksDir(session.uploadId), { recursive: true });
  const tempPath = path.join(chunksDir(session.uploadId), `${chunkIndex}.partial-${crypto.randomUUID()}`);
  const finalPath = chunkPath(session.uploadId, chunkIndex);
  const out = createWriteStream(tempPath);
  const outTracker = trackWritableErrors(out);
  const hash = crypto.createHash("sha256");
  let size = 0;

  try {
    for await (const chunk of req) {
      const buffer = toBuffer(chunk);
      size += buffer.length;
      if (size > limits.maxChunkBytes) {
        throw new HttpError(
          413,
          `Chunk exceeds the ${formatUploadSize(limits.maxChunkBytes)} upload chunk limit.`,
          { code: "CHUNK_TOO_LARGE", limit: limits.maxChunkBytes },
          "payload-too-large",
        );
      }
      hash.update(buffer);
      await writeOrWaitForDrain(out, buffer, outTracker);
    }

    if (size === 0) {
      throw new HttpError(400, "Chunk body is empty.", { code: "EMPTY_CHUNK" }, "validation");
    }

    await endWritable(out, outTracker);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    out.destroy();
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }

  return {
    uploadId: session.uploadId,
    chunkIndex,
    size,
    checksum: hash.digest("hex"),
    status: await getChunkedUploadStatus(session),
  };
}

function validateBase64Text(value: string): void {
  if (/[^A-Za-z0-9+/=\s]/.test(value)) {
    throw new HttpError(
      400,
      "Chunk body must be valid base64 text.",
      { code: "INVALID_BASE64_CHUNK" },
      "validation",
    );
  }
}

function decodeBase64Segment(segment: string): Buffer {
  let normalized = segment;
  if (!normalized.includes("=")) {
    const remainder = normalized.length % 4;
    if (remainder === 1) {
      throw new HttpError(
        400,
        "Chunk body must be valid base64 text.",
        { code: "INVALID_BASE64_CHUNK" },
        "validation",
      );
    }
    if (remainder > 0) {
      normalized = `${normalized}${"=".repeat(4 - remainder)}`;
    }
  }

  if (
    normalized.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new HttpError(
      400,
      "Chunk body must be valid base64 text.",
      { code: "INVALID_BASE64_CHUNK" },
      "validation",
    );
  }

  return Buffer.from(normalized, "base64");
}

export async function writeBase64ChunkFromRequest(req: Request, session: ChunkedUploadSession, chunkIndex: number) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw new HttpError(400, "chunkIndex is out of range.", { code: "INVALID_CHUNK_INDEX" }, "validation");
  }

  const limits = getChunkedUploadLimits();
  const encodedLength = Number(req.get("content-length") ?? "0");
  const maxEncodedBytes = Math.ceil(limits.maxChunkBytes / 3) * 4 + 4096;
  if (Number.isFinite(encodedLength) && encodedLength > maxEncodedBytes) {
    throw new HttpError(
      413,
      `Base64 chunk exceeds the ${formatUploadSize(limits.maxChunkBytes)} decoded upload chunk limit.`,
      { code: "CHUNK_TOO_LARGE", limit: limits.maxChunkBytes },
      "payload-too-large",
    );
  }

  await fs.mkdir(chunksDir(session.uploadId), { recursive: true });
  const tempPath = path.join(chunksDir(session.uploadId), `${chunkIndex}.partial-${crypto.randomUUID()}`);
  const finalPath = chunkPath(session.uploadId, chunkIndex);
  const out = createWriteStream(tempPath);
  const outTracker = trackWritableErrors(out);
  const hash = crypto.createHash("sha256");
  let size = 0;
  let pending = "";
  let sawPadding = false;

  const writeDecoded = async (decoded: Buffer) => {
    if (decoded.length === 0) return;
    size += decoded.length;
    if (size > limits.maxChunkBytes) {
      throw new HttpError(
        413,
        `Base64 chunk exceeds the ${formatUploadSize(limits.maxChunkBytes)} decoded upload chunk limit.`,
        { code: "CHUNK_TOO_LARGE", limit: limits.maxChunkBytes },
        "payload-too-large",
      );
    }
    hash.update(decoded);
    await writeOrWaitForDrain(out, decoded, outTracker);
  };

  try {
    for await (const chunk of req) {
      const text = toBuffer(chunk).toString("ascii");
      validateBase64Text(text);
      const normalized = text.replace(/\s+/g, "");
      if (!normalized) continue;
      if (sawPadding) {
        throw new HttpError(
          400,
          "Chunk body must be valid base64 text.",
          { code: "INVALID_BASE64_CHUNK" },
          "validation",
        );
      }
      if (normalized.includes("=")) {
        sawPadding = true;
      }

      pending += normalized;
      const paddingIndex = pending.indexOf("=");
      const decodeEnd = paddingIndex >= 0
        ? Math.floor(paddingIndex / 4) * 4
        : Math.floor(pending.length / 4) * 4;
      if (decodeEnd > 0) {
        await writeDecoded(decodeBase64Segment(pending.slice(0, decodeEnd)));
        pending = pending.slice(decodeEnd);
      }
    }

    if (pending.length > 0) {
      await writeDecoded(decodeBase64Segment(pending));
    }
    if (size === 0) {
      throw new HttpError(400, "Chunk body is empty.", { code: "EMPTY_CHUNK" }, "validation");
    }

    await endWritable(out, outTracker);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    out.destroy();
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }

  return {
    uploadId: session.uploadId,
    chunkIndex,
    size,
    checksum: hash.digest("hex"),
    transport: "base64",
    status: await getChunkedUploadStatus(session),
  };
}

export async function assembleChunkedUpload(session: ChunkedUploadSession): Promise<Express.Multer.File> {
  const status = await getChunkedUploadStatus(session);
  if (!status.complete) {
    throw new HttpError(
      409,
      "Chunked upload is missing one or more chunks.",
      { code: "CHUNKED_UPLOAD_INCOMPLETE", missingChunks: status.missingChunks },
      "conflict",
    );
  }

  const targetPath = assembledPath(session.uploadId);
  const out = createWriteStream(targetPath);
  const outTracker = trackWritableErrors(out);
  const hash = crypto.createHash("sha256");
  let size = 0;

  try {
    for (let index = 0; index < session.totalChunks; index += 1) {
      const input = createReadStream(chunkPath(session.uploadId, index));
      for await (const chunk of input) {
        const buffer = toBuffer(chunk);
        size += buffer.length;
        hash.update(buffer);
        await writeOrWaitForDrain(out, buffer, outTracker);
      }
    }
    await endWritable(out, outTracker);
  } catch (error) {
    out.destroy();
    await fs.unlink(targetPath).catch(() => {});
    throw error;
  }

  const contentHash = hash.digest("hex");
  if (size !== session.totalSize) {
    await fs.unlink(targetPath).catch(() => {});
    throw new HttpError(
      400,
      "Assembled file size does not match the declared totalSize.",
      { code: "FILE_SIZE_MISMATCH", expectedSize: session.totalSize, actualSize: size },
      "validation",
    );
  }
  if (session.contentHash && contentHash !== session.contentHash) {
    await fs.unlink(targetPath).catch(() => {});
    throw new HttpError(
      400,
      "Assembled file checksum does not match the declared contentHash.",
      { code: "CHECKSUM_MISMATCH", expectedChecksum: session.contentHash, actualChecksum: contentHash },
      "validation",
    );
  }

  return {
    fieldname: "files",
    originalname: session.originalName,
    encoding: "7bit",
    mimetype: session.mimeType,
    destination: sessionDir(session.uploadId),
    filename: "assembled-upload",
    path: targetPath,
    size,
    contentHash,
  } as Express.Multer.File;
}

export async function removeChunkedUploadSession(uploadId: string) {
  await fs.rm(sessionDir(uploadId), { recursive: true, force: true });
}
