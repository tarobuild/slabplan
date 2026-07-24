import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open as openFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Response as ExpressResponse } from "express";
import { formatUploadSize } from "@workspace/api-zod";
import {
  FILE_RESPONSE_CSP,
  resolveSafeFileServingHeaders,
} from "./file-serving";
import { getChunkedUploadLimits } from "./chunked-upload";
import { HttpError } from "./http";
import { logger } from "./logger";
import { APP_STORAGE_PREFIX } from "./brand";
import { getRequiredSupabaseUrl } from "./supabase-url";

const SUPABASE_UPLOAD_PREFIX = APP_STORAGE_PREFIX;
const SUPABASE_OBJECT_MISSING_STATUSES = new Set([400, 404]);
const STORAGE_BUCKET_FILE_SIZE_LIMIT_ENV = "CADSTONE_STORAGE_BUCKET_FILE_SIZE_LIMIT_BYTES";
const STORAGE_BUCKET_LIMIT_VERIFY_TIMEOUT_ENV =
  "CADSTONE_STORAGE_BUCKET_LIMIT_VERIFY_TIMEOUT_MS";
const SUPABASE_RESUMABLE_UPLOAD_MIN_BYTES = 6 * 1024 * 1024;
const SUPABASE_RESUMABLE_UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024;
const SUPABASE_TUS_VERSION = "1.0.0";
const SUPABASE_MULTIPART_UPLOAD_MIN_BYTES = 24 * 1024 * 1024;
const SUPABASE_MULTIPART_PART_BYTES = 8 * 1024 * 1024;
const SUPABASE_MULTIPART_MANIFEST_CONTENT_TYPE =
  "application/vnd.cadstone.multipart-upload+json; charset=utf-8";
const SUPABASE_MULTIPART_MANIFEST_VERSION = 1;
const SUPABASE_MULTIPART_MANIFEST_PROBE_MAX_BYTES = 1024 * 1024;
const SUPABASE_READ_MAX_ATTEMPTS = 3;
const SUPABASE_READ_RETRY_BASE_DELAY_MS = 150;
const SUPABASE_READ_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_SUPABASE_READ_OPEN_TIMEOUT_MS = 30_000;
const DEFAULT_SUPABASE_READ_IDLE_TIMEOUT_MS = 60_000;
const SUPABASE_WRITE_REQUEST_TIMEOUT_MS = 120_000;
const CLOUD_RUN_SAFE_RESPONSE_BYTES = 24 * 1024 * 1024;
let supabaseReadOpenTimeoutMs = DEFAULT_SUPABASE_READ_OPEN_TIMEOUT_MS;
let supabaseReadIdleTimeoutMs = DEFAULT_SUPABASE_READ_IDLE_TIMEOUT_MS;
const LEGACY_MULTIPART_UPLOAD_ENV = "CADSTONE_SUPABASE_LEGACY_MULTIPART_UPLOAD";
const SUPABASE_NATIVE_OBJECT_CACHE_MAX_ENTRIES = 10_000;

type SupabaseBucketInfo = {
  id?: unknown;
  name?: unknown;
  public?: unknown;
  file_size_limit?: unknown;
  allowed_mime_types?: unknown;
};

type SupabaseMultipartManifest = {
  version: typeof SUPABASE_MULTIPART_MANIFEST_VERSION;
  kind: "cadstone-supabase-multipart";
  totalBytes: number;
  contentType: string;
  parts: Array<{
    index: number;
    fileUrl: string;
    size: number;
  }>;
};

class SupabaseStorageRequestError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(params: { status: number; url: string; body: string }) {
    super(
      `Supabase Storage request failed (${params.status}) for ${params.url}${
        params.body ? `: ${params.body.slice(0, 240)}` : ""
      }`,
    );
    this.name = "SupabaseStorageRequestError";
    this.status = params.status;
    this.url = params.url;
    this.body = params.body;
  }
}

function storageBackend() {
  const backend = process.env.CADSTONE_STORAGE_BACKEND?.trim().toLowerCase();
  if (!backend) {
    return process.env.NODE_ENV === "test" ? "local" : "supabase";
  }
  if (backend === "supabase") {
    return "supabase";
  }
  if (backend === "local") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CADSTONE_STORAGE_BACKEND=local is not allowed in production.");
    }
    return "local";
  }
  throw new Error(`Unsupported CADSTONE_STORAGE_BACKEND: ${backend}`);
}

function shouldUseLegacySupabaseMultipartUpload(size: number): boolean {
  return (
    process.env[LEGACY_MULTIPART_UPLOAD_ENV]?.trim().toLowerCase() === "true" &&
    size > SUPABASE_MULTIPART_UPLOAD_MIN_BYTES
  );
}

function getRequiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

function getSupabaseConfig() {
  const rawUrl = getRequiredSupabaseUrl();
  const url = rawUrl.endsWith("/") ? rawUrl.slice(0, -1) : rawUrl;
  return {
    url,
    bucketName: getRequiredEnv("SUPABASE_STORAGE_BUCKET"),
    serviceRoleKey: getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function fileUrlToRelativePath(fileUrl: string): string {
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("Stored file URL is missing.");
  }
  const match = /^\/uploads\/(.+)$/.exec(fileUrl);
  if (!match) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  const relative = match[1];
  const segments = relative.split("/");
  if (
    segments.some((segment) => segment === ".." || segment === "") ||
    relative.startsWith("/") ||
    relative.includes("\0") ||
    relative.includes("\\")
  ) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }

  for (const segment of relative.split("/")) {
    let decodedSegment: string;
    try {
      decodedSegment = decodeURIComponent(segment);
    } catch {
      throw new Error(`Invalid stored file URL: ${fileUrl}`);
    }

    if (
      decodedSegment === "." ||
      decodedSegment === ".." ||
      decodedSegment.includes("/") ||
      decodedSegment.includes("\\") ||
      decodedSegment.includes("\0")
    ) {
      throw new Error(`Invalid stored file URL: ${fileUrl}`);
    }
  }

  return relative;
}

function fileUrlToSupabaseObjectName(fileUrl: string): string {
  const relative = fileUrlToRelativePath(fileUrl);
  return path.posix.join(SUPABASE_UPLOAD_PREFIX, relative);
}

function localStorageRoot() {
  const configured = process.env.CADSTONE_LOCAL_STORAGE_ROOT?.trim();
  return path.resolve(configured || ".local/slabplan-storage");
}

function localFilePath(fileUrl: string) {
  const root = localStorageRoot();
  const relative = fileUrlToRelativePath(fileUrl);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  return resolved;
}

async function localFileExists(fileUrl: string) {
  try {
    const info = await stat(localFilePath(fileUrl));
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function encodeStoragePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function readPositiveByteLimitEnv(key: string, defaultValue: number): number {
  const value = readPositiveIntEnv(key, defaultValue);
  return value > 0 ? value : defaultValue;
}

function desiredSupabaseBucketFileSizeLimit(): number {
  return readPositiveByteLimitEnv(
    STORAGE_BUCKET_FILE_SIZE_LIMIT_ENV,
    getChunkedUploadLimits().maxTotalBytes,
  );
}

function normalizeStorageByteLimit(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function isStoragePayloadTooLargeResponse(status: number, body: string): boolean {
  if (status === 413) return true;
  return /(file|object|payload|request).{0,40}(size|large|limit|maximum|exceed)|exceed.{0,40}(size|limit|maximum)/i.test(body);
}

function storagePayloadTooLargeError(status: number): HttpError {
  const limit = desiredSupabaseBucketFileSizeLimit();
  return new HttpError(
    413,
    `Stored file exceeds the ${formatUploadSize(limit)} storage upload limit.`,
    {
      code: "STORAGE_FILE_TOO_LARGE",
      upstreamStatus: status,
      storageLimitBytes: limit,
    },
    "payload-too-large",
  );
}

function bucketLimitVerificationTimeoutMs(): number {
  return readPositiveIntEnv(STORAGE_BUCKET_LIMIT_VERIFY_TIMEOUT_ENV, 5_000);
}

function bucketLimitVerificationSignal(): AbortSignal {
  return AbortSignal.timeout(bucketLimitVerificationTimeoutMs());
}

function isStorageConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /\b[A-Z0-9_]+\b is not set\./.test(error.message) ||
    error.message.includes("Unsupported CADSTONE_STORAGE_BACKEND") ||
    error.message.includes("CADSTONE_STORAGE_BACKEND=local is not allowed")
  );
}

let supabaseBucketUploadLimitVerified = false;
let supabaseBucketUploadLimitInFlight: Promise<void> | null = null;

function resetSupabaseBucketUploadLimitVerification() {
  supabaseBucketUploadLimitVerified = false;
  supabaseBucketUploadLimitInFlight = null;
}

async function supabaseStorageRequest(
  storagePath: string,
  init: RequestInit & { duplex?: "half" } = {},
  okStatuses: ReadonlySet<number> = new Set([200]),
): Promise<globalThis.Response> {
  const config = getSupabaseConfig();
  return supabaseAuthenticatedRequest(
    `${config.url}/storage/v1${storagePath}`,
    init,
    okStatuses,
  );
}

async function supabaseAuthenticatedRequest(
  url: string,
  init: RequestInit & { duplex?: "half" } = {},
  okStatuses: ReadonlySet<number> = new Set([200]),
): Promise<globalThis.Response> {
  const config = getSupabaseConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!okStatuses.has(response.status)) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    if (isStoragePayloadTooLargeResponse(response.status, body)) {
      throw storagePayloadTooLargeError(response.status);
    }
    throw new SupabaseStorageRequestError({
      status: response.status,
      url,
      body,
    });
  }

  return response;
}

function isRetryableSupabaseReadError(error: unknown): boolean {
  if (error instanceof SupabaseStorageRequestError) {
    return SUPABASE_READ_RETRY_STATUSES.has(error.status);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /fetch failed|network|socket|timeout|temporar/i.test(error.message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function supabaseStorageReadRequest(
  storagePath: string,
  init: RequestInit & { duplex?: "half" } = {},
  okStatuses: ReadonlySet<number> = new Set([200]),
): Promise<globalThis.Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SUPABASE_READ_MAX_ATTEMPTS; attempt += 1) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      const error = new Error("Supabase Storage read timed out before opening.");
      error.name = "TimeoutError";
      timeoutController.abort(error);
    }, supabaseReadOpenTimeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      return await supabaseStorageRequest(
        storagePath,
        { ...init, signal },
        okStatuses,
      );
    } catch (error) {
      if (
        attempt >= SUPABASE_READ_MAX_ATTEMPTS ||
        !isRetryableSupabaseReadError(error)
      ) {
        throw error;
      }

      lastError = error;
      logger.warn(
        { err: error, storagePath, attempt, maxAttempts: SUPABASE_READ_MAX_ATTEMPTS },
        "Retrying Supabase Storage read after transient failure",
      );
      await sleep(SUPABASE_READ_RETRY_BASE_DELAY_MS * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Supabase Storage read failed.");
}

function supabaseObjectPath(fileUrl: string): {
  bucketName: string;
  objectName: string;
  encodedPath: string;
} {
  const { bucketName } = getSupabaseConfig();
  const objectName = fileUrlToSupabaseObjectName(fileUrl);
  return {
    bucketName,
    objectName,
    encodedPath: `${encodeURIComponent(bucketName)}/${encodeStoragePath(objectName)}`,
  };
}

function supabaseResumableUploadBaseUrl(): string {
  const explicit = process.env.SUPABASE_STORAGE_DIRECT_URL?.trim();
  if (explicit) {
    return explicit.endsWith("/") ? explicit.slice(0, -1) : explicit;
  }

  const { url } = getSupabaseConfig();
  const parsed = new URL(url);
  if (
    parsed.hostname.endsWith(".supabase.co") &&
    !parsed.hostname.endsWith(".storage.supabase.co")
  ) {
    parsed.hostname = parsed.hostname.replace(
      /\.supabase\.co$/,
      ".storage.supabase.co",
    );
    return parsed.origin;
  }

  return url;
}

function encodeTusMetadataValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function buildSupabaseTusMetadata(params: {
  bucketName: string;
  objectName: string;
  contentType: string;
}) {
  return [
    ["bucketName", params.bucketName],
    ["objectName", params.objectName],
    ["contentType", params.contentType],
    ["cacheControl", "3600"],
  ]
    .map(([key, value]) => `${key} ${encodeTusMetadataValue(value)}`)
    .join(",");
}

async function createSupabaseResumableUpload(params: {
  fileUrl: string;
  totalBytes: number;
  contentType?: string | null;
}) {
  const { bucketName, objectName } = supabaseObjectPath(params.fileUrl);
  const baseUrl = supabaseResumableUploadBaseUrl();
  const contentType = params.contentType?.trim() || "application/octet-stream";
  await ensureSupabaseBucketUploadLimitBestEffort("write-resumable");
  for (let attempt = 1; attempt <= SUPABASE_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await supabaseAuthenticatedRequest(
        `${baseUrl}/storage/v1/upload/resumable`,
        {
          method: "POST",
          headers: {
            "Tus-Resumable": SUPABASE_TUS_VERSION,
            "Upload-Length": String(params.totalBytes),
            "Upload-Metadata": buildSupabaseTusMetadata({
              bucketName,
              objectName,
              contentType,
            }),
            "x-upsert": "true",
          },
          signal: AbortSignal.timeout(SUPABASE_WRITE_REQUEST_TIMEOUT_MS),
        },
        new Set([201]),
      );
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Supabase resumable upload did not return a location.");
      }
      return new URL(
        location,
        `${baseUrl}/storage/v1/upload/resumable/`,
      ).toString();
    } catch (error) {
      if (
        attempt >= SUPABASE_READ_MAX_ATTEMPTS ||
        !isRetryableSupabaseReadError(error)
      ) {
        throw error;
      }
      logger.warn(
        {
          err: error,
          fileUrl: params.fileUrl,
          attempt,
          maxAttempts: SUPABASE_READ_MAX_ATTEMPTS,
        },
        "Retrying Supabase resumable upload creation after transient failure",
      );
      await sleep(SUPABASE_READ_RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw new Error("Supabase resumable upload creation failed.");
}

async function headSupabaseResumableOffset(
  uploadUrl: string,
): Promise<number | null> {
  const response = await supabaseAuthenticatedRequest(
    uploadUrl,
    {
      method: "HEAD",
      headers: { "Tus-Resumable": SUPABASE_TUS_VERSION },
      signal: AbortSignal.timeout(SUPABASE_WRITE_REQUEST_TIMEOUT_MS),
    },
    new Set([200, 404, 410]),
  );
  if (response.status === 404 || response.status === 410) {
    return null;
  }

  const offset = Number(response.headers.get("upload-offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Supabase resumable upload returned an invalid offset.");
  }
  return offset;
}

function redactSupabaseResumableUploadError(
  error: unknown,
  uploadUrl: string,
): Error {
  if (error instanceof SupabaseStorageRequestError) {
    const redacted = new Error(
      `Supabase resumable upload request failed (${error.status}).`,
    );
    redacted.name = error.name;
    return redacted;
  }
  if (error instanceof Error) {
    const redacted = new Error(
      error.message.split(uploadUrl).join("[redacted]"),
    );
    redacted.name = error.name;
    return redacted;
  }
  return new Error("Supabase resumable upload request failed.");
}

async function patchSupabaseResumableUpload(
  uploadUrl: string,
  offset: number,
  chunk: Buffer,
) {
  const expectedOffset = offset + chunk.length;
  let currentOffset = offset;
  let remaining = chunk;

  for (let attempt = 1; attempt <= SUPABASE_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await supabaseAuthenticatedRequest(
        uploadUrl,
        {
          method: "PATCH",
          headers: {
            "Tus-Resumable": SUPABASE_TUS_VERSION,
            "Upload-Offset": String(currentOffset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: remaining,
          signal: AbortSignal.timeout(SUPABASE_WRITE_REQUEST_TIMEOUT_MS),
        },
        new Set([200, 204]),
      );
      const nextOffset = Number(
        response.headers.get("upload-offset") ??
          currentOffset + remaining.length,
      );
      if (!Number.isSafeInteger(nextOffset) || nextOffset !== expectedOffset) {
        throw new Error(
          "Supabase resumable upload returned an invalid offset.",
        );
      }
      return nextOffset;
    } catch (error) {
      if (
        attempt >= SUPABASE_READ_MAX_ATTEMPTS ||
        !isRetryableSupabaseReadError(error)
      ) {
        throw redactSupabaseResumableUploadError(error, uploadUrl);
      }

      const serverOffset = await headSupabaseResumableOffset(uploadUrl).catch(
        () => null,
      );
      if (serverOffset === null) {
        throw redactSupabaseResumableUploadError(error, uploadUrl);
      }
      if (serverOffset >= expectedOffset) {
        return expectedOffset;
      }
      if (serverOffset < currentOffset) {
        throw redactSupabaseResumableUploadError(error, uploadUrl);
      }

      remaining = chunk.subarray(serverOffset - offset);
      currentOffset = serverOffset;
      logger.warn(
        { uploadUrl: "[redacted]", currentOffset, attempt },
        "Retrying TUS chunk after transient failure",
      );
      await sleep(SUPABASE_READ_RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw new Error("Supabase resumable upload chunk failed.");
}

async function writeSupabaseResumableBuffer(
  fileUrl: string,
  buffer: Buffer,
  options?: { contentType?: string | null },
) {
  const uploadUrl = await createSupabaseResumableUpload({
    fileUrl,
    totalBytes: buffer.length,
    contentType: options?.contentType,
  });

  let offset = 0;
  while (offset < buffer.length) {
    const chunk = buffer.subarray(
      offset,
      Math.min(offset + SUPABASE_RESUMABLE_UPLOAD_CHUNK_BYTES, buffer.length),
    );
    offset = await patchSupabaseResumableUpload(uploadUrl, offset, chunk);
  }
}

async function writeSupabaseResumableFromPath(
  fileUrl: string,
  sourcePath: string,
  size: number,
  options?: { contentType?: string | null },
) {
  const uploadUrl = await createSupabaseResumableUpload({
    fileUrl,
    totalBytes: size,
    contentType: options?.contentType,
  });
  const handle = await openFile(sourcePath, "r");

  try {
    let offset = 0;
    while (offset < size) {
      const length = Math.min(
        SUPABASE_RESUMABLE_UPLOAD_CHUNK_BYTES,
        size - offset,
      );
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead <= 0) {
        throw new Error("Failed to read chunk for Supabase resumable upload.");
      }
      offset = await patchSupabaseResumableUpload(
        uploadUrl,
        offset,
        bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead),
      );
    }
  } finally {
    await handle.close();
  }
}

function bareContentType(value: string | null | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isSupabaseMultipartManifestContentType(value: string | null | undefined) {
  return bareContentType(value) === bareContentType(SUPABASE_MULTIPART_MANIFEST_CONTENT_TYPE);
}

function readContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeSupabaseMultipartContentType(value: string | null | undefined) {
  return value?.trim() || "application/octet-stream";
}

function supabaseMultipartPartFileUrl(fileUrl: string, index: number) {
  fileUrlToRelativePath(fileUrl);
  return `${fileUrl}.parts/${String(index).padStart(6, "0")}`;
}

function buildSupabaseMultipartManifest(params: {
  fileUrl: string;
  totalBytes: number;
  contentType?: string | null;
  partSizes: number[];
}): SupabaseMultipartManifest {
  return {
    version: SUPABASE_MULTIPART_MANIFEST_VERSION,
    kind: "cadstone-supabase-multipart",
    totalBytes: params.totalBytes,
    contentType: normalizeSupabaseMultipartContentType(params.contentType),
    parts: params.partSizes.map((size, index) => ({
      index,
      fileUrl: supabaseMultipartPartFileUrl(params.fileUrl, index),
      size,
    })),
  };
}

function assertSupabaseMultipartManifestForFile(
  fileUrl: string,
  value: unknown,
): SupabaseMultipartManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Stored multipart manifest is invalid.");
  }
  const manifest = value as Partial<SupabaseMultipartManifest>;
  const totalBytes = manifest.totalBytes;
  const contentType = manifest.contentType;
  const parts = manifest.parts;
  if (
    manifest.version !== SUPABASE_MULTIPART_MANIFEST_VERSION ||
    manifest.kind !== "cadstone-supabase-multipart" ||
    !Number.isSafeInteger(totalBytes) ||
    typeof totalBytes !== "number" ||
    totalBytes < 0 ||
    typeof contentType !== "string" ||
    !Array.isArray(parts) ||
    parts.length === 0
  ) {
    throw new Error("Stored multipart manifest is invalid.");
  }

  let totalSize = 0;
  for (const [index, part] of parts.entries()) {
    if (
      !part ||
      typeof part !== "object" ||
      part.index !== index ||
      part.fileUrl !== supabaseMultipartPartFileUrl(fileUrl, index) ||
      !Number.isSafeInteger(part.size) ||
      part.size <= 0
    ) {
      throw new Error("Stored multipart manifest contains an invalid part.");
    }
    totalSize += part.size;
  }

  if (totalSize !== totalBytes) {
    throw new Error("Stored multipart manifest size does not match its parts.");
  }

  return {
    version: SUPABASE_MULTIPART_MANIFEST_VERSION,
    kind: "cadstone-supabase-multipart",
    totalBytes,
    contentType,
    parts,
  };
}

async function writeSupabaseObjectBuffer(
  fileUrl: string,
  buffer: Buffer,
  options?: { contentType?: string | null },
) {
  const { encodedPath } = supabaseObjectPath(fileUrl);
  await supabaseStorageRequest(
    `/object/${encodedPath}`,
    {
      method: "POST",
      headers: {
        "Content-Type": options?.contentType ?? "application/octet-stream",
        "x-upsert": "true",
      },
      body: buffer,
    },
    new Set([200, 201]),
  );
}

async function deleteSupabaseObject(fileUrl: string) {
  const { encodedPath } = supabaseObjectPath(fileUrl);
  await supabaseStorageRequest(
    `/object/${encodedPath}`,
    { method: "DELETE" },
    new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
  );
}

async function cleanupSupabaseMultipartParts(fileUrls: string[]) {
  await Promise.all(
    fileUrls.map(async (partFileUrl) => {
      try {
        await deleteSupabaseObject(partFileUrl);
      } catch (error) {
        logger.warn(
          { err: error, partFileUrl },
          "Failed to clean up multipart upload part",
        );
      }
    }),
  );
}

async function writeSupabaseMultipartManifestBuffer(
  fileUrl: string,
  buffer: Buffer,
  options?: { contentType?: string | null },
) {
  await ensureSupabaseBucketUploadLimitBestEffort("write-multipart-buffer");
  const partSizes: number[] = [];
  const uploadedParts: string[] = [];

  try {
    for (let offset = 0, index = 0; offset < buffer.length; index += 1) {
      const part = buffer.subarray(
        offset,
        Math.min(offset + SUPABASE_MULTIPART_PART_BYTES, buffer.length),
      );
      const partFileUrl = supabaseMultipartPartFileUrl(fileUrl, index);
      await writeSupabaseObjectBuffer(partFileUrl, part, options);
      uploadedParts.push(partFileUrl);
      partSizes.push(part.length);
      offset += part.length;
    }

    const manifest = buildSupabaseMultipartManifest({
      fileUrl,
      totalBytes: buffer.length,
      contentType: options?.contentType,
      partSizes,
    });
    await writeSupabaseObjectBuffer(
      fileUrl,
      Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8"),
      { contentType: SUPABASE_MULTIPART_MANIFEST_CONTENT_TYPE },
    );
  } catch (error) {
    await cleanupSupabaseMultipartParts(uploadedParts);
    throw error;
  }
}

async function writeSupabaseMultipartManifestFromPath(
  fileUrl: string,
  sourcePath: string,
  size: number,
  options?: { contentType?: string | null },
) {
  await ensureSupabaseBucketUploadLimitBestEffort("write-multipart-file");
  const partSizes: number[] = [];
  const uploadedParts: string[] = [];
  const handle = await openFile(sourcePath, "r");

  try {
    let offset = 0;
    let index = 0;
    while (offset < size) {
      const length = Math.min(SUPABASE_MULTIPART_PART_BYTES, size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead <= 0) {
        throw new Error("Failed to read chunk for Supabase multipart upload.");
      }
      const part = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      const partFileUrl = supabaseMultipartPartFileUrl(fileUrl, index);
      await writeSupabaseObjectBuffer(partFileUrl, part, options);
      uploadedParts.push(partFileUrl);
      partSizes.push(part.length);
      offset += part.length;
      index += 1;
    }

    const manifest = buildSupabaseMultipartManifest({
      fileUrl,
      totalBytes: size,
      contentType: options?.contentType,
      partSizes,
    });
    await writeSupabaseObjectBuffer(
      fileUrl,
      Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8"),
      { contentType: SUPABASE_MULTIPART_MANIFEST_CONTENT_TYPE },
    );
  } catch (error) {
    await cleanupSupabaseMultipartParts(uploadedParts);
    throw error;
  } finally {
    await handle.close();
  }
}

async function readSupabaseMultipartManifestFromResponse(
  fileUrl: string,
  response: globalThis.Response,
): Promise<SupabaseMultipartManifest> {
  const rawBody = await readResponseBody(response.body);
  const body = JSON.parse(rawBody.toString("utf8"));
  return assertSupabaseMultipartManifestForFile(fileUrl, body);
}

function tryParseSupabaseMultipartManifest(
  fileUrl: string,
  body: Buffer,
): SupabaseMultipartManifest | null {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    return assertSupabaseMultipartManifestForFile(fileUrl, parsed);
  } catch {
    return null;
  }
}

async function readSupabaseResponsePrefix(params: {
  response: globalThis.Response;
  maxBytes: number;
  shouldContinueAfterFirstChunk: (chunk: Buffer) => boolean;
}): Promise<
  | { complete: true; body: Buffer }
  | { complete: false; stream: Readable }
> {
  if (!params.response.body) {
    throw new Error("Supabase Storage returned an empty response body.");
  }

  const reader = params.response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let firstChunk = true;

  async function readNextChunk() {
    return new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error("Supabase Storage response stalled.");
        error.name = "TimeoutError";
        reject(error);
        void reader.cancel(error).catch(() => undefined);
      }, supabaseReadIdleTimeoutMs);

      reader.read().then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  async function* replayBufferedThenReader() {
    let completed = false;
    try {
      for (const chunk of chunks) {
        yield chunk;
      }
      while (true) {
        const next = await readNextChunk();
        if (next.done) {
          completed = true;
          return;
        }
        yield Buffer.from(next.value);
      }
    } finally {
      if (!completed) {
        await reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
    }
  }

  while (true) {
    const next = await readNextChunk();
    if (next.done) {
      reader.releaseLock();
      return { complete: true, body: Buffer.concat(chunks, totalBytes) };
    }

    const chunk = Buffer.from(next.value);
    chunks.push(chunk);
    totalBytes += chunk.length;

    if (firstChunk) {
      firstChunk = false;
      if (!params.shouldContinueAfterFirstChunk(chunk)) {
        return { complete: false, stream: Readable.from(replayBufferedThenReader()) };
      }
    }

    if (totalBytes > params.maxBytes) {
      return { complete: false, stream: Readable.from(replayBufferedThenReader()) };
    }
  }
}

function firstNonWhitespaceByte(buffer: Buffer): number | null {
  for (const byte of buffer) {
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      return byte;
    }
  }
  return null;
}

async function resolveSupabaseObjectRead(
  fileUrl: string,
  response: globalThis.Response,
): Promise<{ stream: Readable; manifest: SupabaseMultipartManifest | null }> {
  const contentType = response.headers.get("content-type");
  if (isSupabaseMultipartManifestContentType(contentType)) {
    const manifest = await readSupabaseMultipartManifestFromResponse(fileUrl, response);
    return { stream: openSupabaseMultipartReadStream(manifest), manifest };
  }

  const contentLength = readContentLength(response.headers.get("content-length"));
  const shouldProbe =
    contentLength === null ||
    contentLength <= SUPABASE_MULTIPART_MANIFEST_PROBE_MAX_BYTES;

  if (!shouldProbe) {
    if (!response.body) {
      throw new Error("Supabase Storage returned an empty response body.");
    }
    return {
      stream: Readable.fromWeb(response.body as unknown as WebReadableStream),
      manifest: null,
    };
  }

  const prefix = await readSupabaseResponsePrefix({
    response,
    maxBytes: SUPABASE_MULTIPART_MANIFEST_PROBE_MAX_BYTES,
    shouldContinueAfterFirstChunk: (chunk) => firstNonWhitespaceByte(chunk) === 0x7b,
  });

  if (!prefix.complete) {
    return { stream: prefix.stream, manifest: null };
  }

  const manifest = tryParseSupabaseMultipartManifest(fileUrl, prefix.body);
  if (manifest) {
    return { stream: openSupabaseMultipartReadStream(manifest), manifest };
  }

  return { stream: Readable.from(prefix.body), manifest: null };
}

async function readSupabaseMultipartManifestObject(
  fileUrl: string,
): Promise<SupabaseMultipartManifest | null> {
  try {
    return await inspectSupabaseMultipartManifestObject(fileUrl);
  } catch (error) {
    logger.warn(
      { err: error, fileUrl },
      "Failed to inspect stored file for multipart manifest",
    );
    return null;
  }
}

async function inspectSupabaseMultipartManifestObject(
  fileUrl: string,
): Promise<SupabaseMultipartManifest | null> {
  const { encodedPath } = supabaseObjectPath(fileUrl);
  const response = await supabaseStorageReadRequest(
    `/object/${encodedPath}`,
    { method: "GET" },
    new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
  );
  if (SUPABASE_OBJECT_MISSING_STATUSES.has(response.status)) {
    return null;
  }
  const resolved = await resolveSupabaseObjectRead(fileUrl, response);
  if (!resolved.manifest) {
    resolved.stream.destroy();
  }
  return resolved.manifest;
}

function openSupabaseMultipartReadStream(
  manifest: SupabaseMultipartManifest,
  range?: ByteRange | null,
): Readable {
  async function* readParts() {
    const requestedStart = range?.start ?? 0;
    const requestedEnd = range?.end ?? manifest.totalBytes - 1;
    let partStart = 0;

    for (const part of manifest.parts) {
      const partEnd = partStart + part.size - 1;
      const overlaps =
        requestedStart <= partEnd && requestedEnd >= partStart;
      if (overlaps) {
        const body = await readSupabaseMultipartPart(part);
        const sliceStart = Math.max(requestedStart - partStart, 0);
        const sliceEnd = Math.min(requestedEnd - partStart, part.size - 1);
        yield body.subarray(sliceStart, sliceEnd + 1);
      }
      partStart += part.size;
    }
  }

  return Readable.from(readParts());
}

async function readSupabaseMultipartPart(
  part: SupabaseMultipartManifest["parts"][number],
): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SUPABASE_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { encodedPath } = supabaseObjectPath(part.fileUrl);
      const response = await supabaseStorageReadRequest(
        `/object/${encodedPath}`,
        { method: "GET" },
        new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
      );
      if (SUPABASE_OBJECT_MISSING_STATUSES.has(response.status)) {
        throw new HttpError(404, "Stored file missing.");
      }
      if (!response.body) {
        throw new Error("Supabase Storage returned an empty multipart part body.");
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && Number(contentLength) !== part.size) {
        throw new Error("Supabase multipart part size does not match its manifest.");
      }
      const body = await readResponseBody(response.body);
      if (body.length !== part.size) {
        throw new Error("Supabase multipart part stream ended before the expected size.");
      }
      return body;
    } catch (error) {
      if (error instanceof HttpError && error.statusCode < 500) {
        throw error;
      }
      lastError = error;
      if (attempt >= SUPABASE_READ_MAX_ATTEMPTS) {
        break;
      }
      logger.warn(
        { err: error, partFileUrl: part.fileUrl, attempt, maxAttempts: SUPABASE_READ_MAX_ATTEMPTS },
        "Retrying Supabase multipart part read after failure",
      );
      await sleep(SUPABASE_READ_RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Supabase multipart part read failed.");
}

async function readResponseBody(body: WebReadableStream | null): Promise<Buffer> {
  if (!body) {
    throw new Error("Supabase Storage returned an empty response body.");
  }

  const stream = Readable.fromWeb(body as unknown as WebReadableStream);
  const chunks: Buffer[] = [];
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const armTimeout = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const error = new Error("Supabase Storage response stalled.");
      error.name = "TimeoutError";
      stream.destroy(error);
    }, supabaseReadIdleTimeoutMs);
  };

  try {
    armTimeout();
    for await (const chunk of stream) {
      armTimeout();
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return Buffer.concat(chunks);
}

const supabaseNativeObjectCache = new Map<string, string>();
const supabaseNativeObjectInFlight = new Map<string, Promise<string>>();

function cacheSupabaseNativeObject(sourceFileUrl: string, nativeFileUrl: string): void {
  if (supabaseNativeObjectCache.has(sourceFileUrl)) return;
  if (supabaseNativeObjectCache.size >= SUPABASE_NATIVE_OBJECT_CACHE_MAX_ENTRIES) {
    const oldest = supabaseNativeObjectCache.keys().next().value;
    if (typeof oldest === "string") {
      supabaseNativeObjectCache.delete(oldest);
    }
  }
  supabaseNativeObjectCache.set(sourceFileUrl, nativeFileUrl);
}

function supabaseMaterializedFileUrl(fileUrl: string): string {
  fileUrlToRelativePath(fileUrl);
  return `${fileUrl}.cadstone-native`;
}

async function supabaseObjectMatchesSize(
  fileUrl: string,
  expectedBytes: number,
): Promise<boolean> {
  const { encodedPath } = supabaseObjectPath(fileUrl);
  const response = await supabaseStorageReadRequest(
    `/object/${encodedPath}`,
    {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    },
    new Set([200, 206, ...SUPABASE_OBJECT_MISSING_STATUSES]),
  );
  if (SUPABASE_OBJECT_MISSING_STATUSES.has(response.status)) {
    return false;
  }

  const contentRange = response.headers.get("content-range");
  const rangeTotal = contentRange
    ? Number.parseInt(contentRange.match(/\/(\d+)$/)?.[1] ?? "", 10)
    : null;
  const contentLength = readContentLength(response.headers.get("content-length"));
  if (response.body) {
    try {
      await response.body.cancel();
    } catch {
      // The size headers are already available; cancellation only prevents a
      // provider that ignored Range from continuing to send the full object.
    }
  }
  return (
    rangeTotal === expectedBytes ||
    (response.status === 200 && contentLength === expectedBytes)
  );
}

async function materializeSupabaseMultipartObject(
  sourceFileUrl: string,
  nativeFileUrl: string,
  manifest: SupabaseMultipartManifest,
): Promise<void> {
  const uploadUrl = await createSupabaseResumableUpload({
    fileUrl: nativeFileUrl,
    totalBytes: manifest.totalBytes,
    contentType: manifest.contentType,
  });
  let offset = 0;
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  for (const part of manifest.parts) {
    const partBody = await readSupabaseMultipartPart(part);
    pending = pending.length === 0 ? partBody : Buffer.concat([pending, partBody]);

    while (pending.length >= SUPABASE_RESUMABLE_UPLOAD_CHUNK_BYTES) {
      const chunk = pending.subarray(0, SUPABASE_RESUMABLE_UPLOAD_CHUNK_BYTES);
      offset = await patchSupabaseResumableUpload(uploadUrl, offset, chunk);
      pending = pending.subarray(SUPABASE_RESUMABLE_UPLOAD_CHUNK_BYTES);
    }
  }

  if (pending.length > 0) {
    offset = await patchSupabaseResumableUpload(uploadUrl, offset, pending);
  }
  if (offset !== manifest.totalBytes) {
    throw new Error("Materialized Supabase object size does not match its manifest.");
  }

  // The original manifest and every original part remain untouched. This
  // derived native object avoids multipart reconstruction during browser
  // delivery without risking any customer data.
  logger.info(
    {
      sourceFileUrl,
      nativeFileUrl,
      totalBytes: manifest.totalBytes,
      partCount: manifest.parts.length,
    },
    "Created native delivery copy for legacy multipart file",
  );
}

function startBackgroundNativeMaterialization(
  fileUrl: string,
  nativeFileUrl: string,
  manifest: SupabaseMultipartManifest,
): void {
  if (supabaseNativeObjectInFlight.has(fileUrl)) return;

  const task = (async () => {
    await materializeSupabaseMultipartObject(fileUrl, nativeFileUrl, manifest);
    if (
      !(await supabaseObjectMatchesSize(nativeFileUrl, manifest.totalBytes))
    ) {
      throw new Error(
        "Native Supabase delivery copy failed size verification.",
      );
    }
    cacheSupabaseNativeObject(fileUrl, nativeFileUrl);
    return nativeFileUrl;
  })();
  supabaseNativeObjectInFlight.set(fileUrl, task);
  void task
    .catch(async (error) => {
      // Multiple production instances may race to create the same derived
      // object. If another instance completed a valid copy, adopt it.
      try {
        if (
          await supabaseObjectMatchesSize(nativeFileUrl, manifest.totalBytes)
        ) {
          cacheSupabaseNativeObject(fileUrl, nativeFileUrl);
          return;
        }
      } catch {
        // The original error is more useful than a secondary verification
        // failure and delivery remains available from the manifest parts.
      }
      logger.warn(
        { err: error, fileUrl, nativeFileUrl },
        "Background native materialization failed",
      );
    })
    .finally(() => {
      if (supabaseNativeObjectInFlight.get(fileUrl) === task) {
        supabaseNativeObjectInFlight.delete(fileUrl);
      }
    });
}

async function resolveSupabaseDeliveryObject(fileUrl: string): Promise<string> {
  const cached = supabaseNativeObjectCache.get(fileUrl);
  if (cached) return cached;

  let manifest: SupabaseMultipartManifest | null;
  try {
    manifest = await inspectSupabaseMultipartManifestObject(fileUrl);
  } catch (error) {
    // The delivery GET re-detects multipart manifests from their content type,
    // so a failed optimization probe must never block a customer response.
    logger.warn(
      { err: error, fileUrl },
      "Stored file inspect failed; deferring to delivery GET",
    );
    return fileUrl;
  }

  if (!manifest) {
    cacheSupabaseNativeObject(fileUrl, fileUrl);
    return fileUrl;
  }

  const nativeFileUrl = supabaseMaterializedFileUrl(fileUrl);
  try {
    if (await supabaseObjectMatchesSize(nativeFileUrl, manifest.totalBytes)) {
      cacheSupabaseNativeObject(fileUrl, nativeFileUrl);
      return nativeFileUrl;
    }
  } catch (error) {
    logger.warn(
      { err: error, fileUrl, nativeFileUrl },
      "Native copy check failed; serving from parts",
    );
  }

  startBackgroundNativeMaterialization(fileUrl, nativeFileUrl, manifest);
  return fileUrl;
}

export async function warmStoredFileNativeCopy(
  fileUrl: string,
): Promise<"native" | "already-materialized" | "created"> {
  if (storageBackend() === "local") {
    return "native";
  }

  const manifest = await inspectSupabaseMultipartManifestObject(fileUrl);
  if (!manifest) {
    cacheSupabaseNativeObject(fileUrl, fileUrl);
    return "native";
  }

  const nativeFileUrl = supabaseMaterializedFileUrl(fileUrl);
  if (await supabaseObjectMatchesSize(nativeFileUrl, manifest.totalBytes)) {
    cacheSupabaseNativeObject(fileUrl, nativeFileUrl);
    return "already-materialized";
  }

  const existing = supabaseNativeObjectInFlight.get(fileUrl);
  if (existing) {
    try {
      await existing;
    } catch {
      // Verify below in case a different production instance completed it.
    }
    if (await supabaseObjectMatchesSize(nativeFileUrl, manifest.totalBytes)) {
      cacheSupabaseNativeObject(fileUrl, nativeFileUrl);
      return "already-materialized";
    }
  }

  try {
    await materializeSupabaseMultipartObject(fileUrl, nativeFileUrl, manifest);
    if (
      !(await supabaseObjectMatchesSize(nativeFileUrl, manifest.totalBytes))
    ) {
      throw new Error(
        "Native Supabase delivery copy failed size verification.",
      );
    }
  } catch (error) {
    if (
      !(await supabaseObjectMatchesSize(nativeFileUrl, manifest.totalBytes))
    ) {
      throw error;
    }
  }
  cacheSupabaseNativeObject(fileUrl, nativeFileUrl);
  return "created";
}

export async function inspectStoredFileNativeCopy(
  fileUrl: string,
): Promise<"native" | "already-materialized" | "needs-materialization"> {
  if (storageBackend() === "local") {
    return "native";
  }

  const manifest = await inspectSupabaseMultipartManifestObject(fileUrl);
  if (!manifest) {
    return "native";
  }
  return (await supabaseObjectMatchesSize(
    supabaseMaterializedFileUrl(fileUrl),
    manifest.totalBytes,
  ))
    ? "already-materialized"
    : "needs-materialization";
}

/**
 * Resolve the size- and structure-verified object that is safe to deliver to
 * a browser.
 *
 * Local files are already native objects. Supabase files may use CAD Stone's
 * legacy multipart representation, so those are materialized once into a
 * separate `.cadstone-native` object without changing the source manifest,
 * its parts, or the database row.
 */
export async function prepareStoredFileForDelivery(fileUrl: string): Promise<string> {
  if (storageBackend() === "local") {
    return fileUrl;
  }
  return resolveSupabaseDeliveryObject(fileUrl);
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
  if (storageBackend() === "local") {
    await mkdir(localStorageRoot(), { recursive: true });
    return;
  }
  await ensureSupabaseBucketUploadLimitBestEffort("startup");
}

async function ensureSupabaseBucketUploadLimit(): Promise<void> {
  const { bucketName } = getSupabaseConfig();
  const desiredLimit = desiredSupabaseBucketFileSizeLimit();
  const response = await supabaseStorageRequest(
    `/bucket/${encodeURIComponent(bucketName)}`,
    { method: "GET", signal: bucketLimitVerificationSignal() },
    new Set([200]),
  );
  const bucket = (await response.json()) as SupabaseBucketInfo;
  const currentLimit = normalizeStorageByteLimit(bucket.file_size_limit);
  if (currentLimit !== null && currentLimit >= desiredLimit) {
    return;
  }

  const payload: Record<string, unknown> = {
    id: typeof bucket.id === "string" ? bucket.id : bucketName,
    name: typeof bucket.name === "string" ? bucket.name : bucketName,
    file_size_limit: desiredLimit,
  };
  if (typeof bucket.public === "boolean") {
    payload.public = bucket.public;
  }
  if (Array.isArray(bucket.allowed_mime_types) || bucket.allowed_mime_types === null) {
    payload.allowed_mime_types = bucket.allowed_mime_types;
  }

  await supabaseStorageRequest(
    `/bucket/${encodeURIComponent(bucketName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: bucketLimitVerificationSignal(),
    },
    new Set([200]),
  );
  logger.info(
    {
      bucketName,
      previousFileSizeLimitBytes: currentLimit,
      fileSizeLimitBytes: desiredLimit,
    },
    "Supabase storage bucket upload limit verified",
  );
}

async function ensureSupabaseBucketUploadLimitBestEffort(context: string): Promise<void> {
  if (supabaseBucketUploadLimitVerified) {
    return;
  }

  supabaseBucketUploadLimitInFlight ??= (async () => {
    try {
      await ensureSupabaseBucketUploadLimit();
      supabaseBucketUploadLimitVerified = true;
    } catch (error) {
      if (isStorageConfigurationError(error)) {
        throw error;
      }
      logger.warn(
        {
          err: error,
          context,
          fileSizeLimitBytes: desiredSupabaseBucketFileSizeLimit(),
        },
        "Supabase storage bucket upload limit could not be verified",
      );
    } finally {
      supabaseBucketUploadLimitInFlight = null;
    }
  })();

  await supabaseBucketUploadLimitInFlight;
}

type HeadBucketImpl = () => Promise<void>;

const defaultHeadBucket: HeadBucketImpl = async () => {
  if (storageBackend() === "local") {
    await mkdir(localStorageRoot(), { recursive: true });
    return;
  }
  const { bucketName } = getSupabaseConfig();
  await supabaseStorageRequest(
    `/bucket/${encodeURIComponent(bucketName)}`,
    { method: "HEAD" },
    new Set([200]),
  );
};

let headBucketImpl: HeadBucketImpl = defaultHeadBucket;

/**
 * Lightweight readiness probe for the upload bucket. Used by /healthz to
 * confirm storage is reachable before the load balancer routes traffic at
 * this instance. Throws on any failure (missing env, network error, missing
 * bucket); the caller is responsible for downgrading that into a `503` and
 * a structured log entry.
 */
export async function headBucket(): Promise<void> {
  await headBucketImpl();
}

/**
 * Internal hook used by the test suite to swap the bucket head check with a
 * stub. Not part of the public API.
 */
const __headBucketTesting = {
  setImpl(fn: HeadBucketImpl) {
    headBucketImpl = fn;
  },
  reset() {
    headBucketImpl = defaultHeadBucket;
  },
};

export function buildStoredFileName(originalName: string) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const normalizedBase = normalizeFileComponent(base) || "file";
  const normalizedExt = normalizeFileComponent(ext) || ext.toLowerCase();

  return `${Date.now()}-${crypto.randomUUID()}-${normalizedBase}${normalizedExt}`;
}

export function buildUploadPath(params: {
  organizationId?: string | null;
  jobId: string;
  mediaType: string;
  storedFileName: string;
}) {
  const relative = params.organizationId
    ? path.posix.join(
        "organizations",
        params.organizationId,
        params.jobId,
        params.mediaType,
        params.storedFileName,
      )
    : path.posix.join(
        params.jobId,
        params.mediaType,
        params.storedFileName,
      );
  return {
    relative,
    fileUrl: `/uploads/${relative}`,
  };
}

type WriteUploadedBufferImpl = (
  fileUrl: string,
  buffer: Buffer,
  options?: { contentType?: string | null },
) => Promise<void>;

type WriteUploadedFromPathImpl = (
  fileUrl: string,
  sourcePath: string,
  options?: { contentType?: string | null },
) => Promise<void>;

const defaultWriteUploadedBuffer: WriteUploadedBufferImpl = async (
  fileUrl,
  buffer,
  options,
) => {
  if (storageBackend() === "local") {
    const target = localFilePath(fileUrl);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return;
  }
  if (shouldUseLegacySupabaseMultipartUpload(buffer.length)) {
    await writeSupabaseMultipartManifestBuffer(fileUrl, buffer, options);
    return;
  }
  if (buffer.length > SUPABASE_RESUMABLE_UPLOAD_MIN_BYTES) {
    await writeSupabaseResumableBuffer(fileUrl, buffer, options);
    return;
  }
  const { encodedPath } = supabaseObjectPath(fileUrl);
  await ensureSupabaseBucketUploadLimitBestEffort("write-buffer");
  await supabaseStorageRequest(
    `/object/${encodedPath}`,
    {
      method: "POST",
      headers: {
        "Content-Type": options?.contentType ?? "application/octet-stream",
        "x-upsert": "true",
      },
      body: buffer,
    },
    new Set([200, 201]),
  );
};

const defaultWriteUploadedFromPath: WriteUploadedFromPathImpl = async (
  fileUrl,
  sourcePath,
  options,
) => {
  if (storageBackend() === "local") {
    const target = localFilePath(fileUrl);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(sourcePath, target);
    return;
  }
  const sourceInfo = await stat(sourcePath);
  if (shouldUseLegacySupabaseMultipartUpload(sourceInfo.size)) {
    await writeSupabaseMultipartManifestFromPath(fileUrl, sourcePath, sourceInfo.size, options);
    return;
  }
  if (sourceInfo.size > SUPABASE_RESUMABLE_UPLOAD_MIN_BYTES) {
    await writeSupabaseResumableFromPath(fileUrl, sourcePath, sourceInfo.size, options);
    return;
  }
  const { encodedPath } = supabaseObjectPath(fileUrl);
  await ensureSupabaseBucketUploadLimitBestEffort("write-file");
  await supabaseStorageRequest(
    `/object/${encodedPath}`,
    {
      method: "POST",
      headers: {
        "Content-Type": options?.contentType ?? "application/octet-stream",
        "x-upsert": "true",
      },
      body: Readable.toWeb(
        createReadStream(sourcePath),
      ) as unknown as NonNullable<RequestInit["body"]>,
      duplex: "half",
    },
    new Set([200, 201]),
  );
};

let writeUploadedBufferImpl = defaultWriteUploadedBuffer;
let writeUploadedFromPathImpl = defaultWriteUploadedFromPath;

export async function writeUploadedBuffer(
  fileUrl: string,
  buffer: Buffer,
  options?: { contentType?: string | null },
): Promise<void> {
  await writeUploadedBufferImpl(fileUrl, buffer, options);
}

export async function writeUploadedFromPath(
  fileUrl: string,
  sourcePath: string,
  options?: { contentType?: string | null },
): Promise<void> {
  await writeUploadedFromPathImpl(fileUrl, sourcePath, options);
}

export const __storageWriteTesting = {
  setImpls(impls: {
    writeBuffer?: WriteUploadedBufferImpl;
    writeFromPath?: WriteUploadedFromPathImpl;
  }) {
    writeUploadedBufferImpl = impls.writeBuffer ?? defaultWriteUploadedBuffer;
    writeUploadedFromPathImpl =
      impls.writeFromPath ?? defaultWriteUploadedFromPath;
  },
  reset() {
    writeUploadedBufferImpl = defaultWriteUploadedBuffer;
    writeUploadedFromPathImpl = defaultWriteUploadedFromPath;
    resetSupabaseBucketUploadLimitVerification();
    supabaseNativeObjectCache.clear();
    supabaseNativeObjectInFlight.clear();
  },
  async waitForNativeMaterialization(fileUrl: string) {
    const task = supabaseNativeObjectInFlight.get(fileUrl);
    if (task) await task;
  },
  cachedNativeObject(fileUrl: string) {
    return supabaseNativeObjectCache.get(fileUrl);
  },
  createResumableUpload: createSupabaseResumableUpload,
  patchResumableUpload: patchSupabaseResumableUpload,
};

export const __storageReadTesting = {
  setTimeouts(params: { openMs?: number; idleMs?: number }) {
    if (params.openMs !== undefined) {
      if (!Number.isFinite(params.openMs) || params.openMs <= 0) {
        throw new Error("openMs must be a positive number.");
      }
      supabaseReadOpenTimeoutMs = params.openMs;
    }
    if (params.idleMs !== undefined) {
      if (!Number.isFinite(params.idleMs) || params.idleMs <= 0) {
        throw new Error("idleMs must be a positive number.");
      }
      supabaseReadIdleTimeoutMs = params.idleMs;
    }
  },
  reset() {
    supabaseReadOpenTimeoutMs = DEFAULT_SUPABASE_READ_OPEN_TIMEOUT_MS;
    supabaseReadIdleTimeoutMs = DEFAULT_SUPABASE_READ_IDLE_TIMEOUT_MS;
  },
};

export async function deletePhysicalFile(
  fileUrl: string | null | undefined,
): Promise<void> {
  if (!fileUrl) {
    return;
  }
  try {
    if (storageBackend() === "local") {
      await unlink(localFilePath(fileUrl)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      return;
    }
    supabaseNativeObjectCache.delete(fileUrl);
    supabaseNativeObjectInFlight.delete(fileUrl);
    const manifest = await readSupabaseMultipartManifestObject(fileUrl);
    if (manifest) {
      await cleanupSupabaseMultipartParts(manifest.parts.map((part) => part.fileUrl));
    }
    await deleteSupabaseObject(fileUrl);
    // This is reached only from the existing explicit file-deletion workflow.
    // Remove the derived delivery copy along with the customer-requested file.
    await deleteSupabaseObject(supabaseMaterializedFileUrl(fileUrl));
  } catch (error) {
    logger.warn({ err: error, fileUrl }, "Failed to delete stored file");
  }
}

export async function storedFileExists(
  fileUrl: string | null | undefined,
): Promise<boolean> {
  if (!fileUrl) {
    return false;
  }
  try {
    if (storageBackend() === "local") {
      return await localFileExists(fileUrl);
    }
    const { encodedPath } = supabaseObjectPath(fileUrl);
    const response = await supabaseStorageRequest(
      `/object/info/${encodedPath}`,
      { method: "HEAD" },
      new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
    );
    return response.status === 200;
  } catch (error) {
    logger.warn(
      { err: error, fileUrl },
      "Failed to probe stored file existence",
    );
    return false;
  }
}

export type StorageStatus = "ok" | "missing";

/**
 * Result of a single uncached round-trip to Supabase Storage. Distinct from
 * {@link StorageStatus} so we can tell a definitive "object missing" response
 * apart from a transient failure that we want to fail-open on but explicitly
 * not cache (otherwise a 30-second outage would freeze every probed URL into
 * a stale "ok" until the TTL expires).
 */
type RawProbeResult = "ok" | "missing" | "error";

async function rawProbeStorageStatus(fileUrl: string): Promise<RawProbeResult> {
  try {
    if (storageBackend() === "local") {
      return (await localFileExists(fileUrl)) ? "ok" : "missing";
    }
    const { encodedPath } = supabaseObjectPath(fileUrl);
    const response = await supabaseStorageRequest(
      `/object/info/${encodedPath}`,
      { method: "HEAD" },
      new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
    );
    return response.status === 200 ? "ok" : "missing";
  } catch (error) {
    logger.warn({ err: error, fileUrl }, "Failed to probe stored file status");
    return "error";
  }
}

// Indirection so tests can swap in a stub probe without mocking fetch.
// Production code always calls this through {@link probeStorageStatus}, which
// adds the cache and inflight coalescing.
let probeImpl: (fileUrl: string) => Promise<RawProbeResult> =
  rawProbeStorageStatus;

interface ProbeCacheEntry {
  status: StorageStatus;
  expiresAt: number;
}

// Keyed by fileUrl. Shared across requests/users since object existence is a
// global property of the bucket, not a per-user fact.
const probeCache = new Map<string, ProbeCacheEntry>();

// Concurrent probes for the same URL share a single inflight promise so a
// burst of listings (or a single listing with many duplicates) only hits
// storage once even before the cache has been populated.
const probeInflight = new Map<string, Promise<StorageStatus>>();

// Hard upper bound to keep the cache from growing unboundedly in long-lived
// processes that touch many distinct files. When we cross this, we drop any
// entries whose TTL has already lapsed; if that doesn't free enough room we
// drop the oldest-by-expiry remainder to bring us back under the cap.
const PROBE_CACHE_MAX_ENTRIES = 10_000;

function readPositiveIntEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultValue;
  return parsed;
}

function getOkTtlMs(): number {
  return readPositiveIntEnv("STORAGE_PROBE_OK_CACHE_TTL_MS", 30_000);
}

function getMissingTtlMs(): number {
  return readPositiveIntEnv("STORAGE_PROBE_MISSING_CACHE_TTL_MS", 30_000);
}

function pruneProbeCache() {
  if (probeCache.size <= PROBE_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of probeCache) {
    if (entry.expiresAt <= now) {
      probeCache.delete(key);
    }
  }
  if (probeCache.size <= PROBE_CACHE_MAX_ENTRIES) return;
  // Still over the cap: drop entries with the soonest expiry first.
  const sorted = Array.from(probeCache.entries()).sort(
    (a, b) => a[1].expiresAt - b[1].expiresAt,
  );
  const overflow = probeCache.size - PROBE_CACHE_MAX_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    probeCache.delete(sorted[i][0]);
  }
}

/**
 * Probe whether a stored file is still backed by an object in Supabase Storage.
 *
 * Distinct from {@link storedFileExists} in how errors are handled: this is the
 * helper used by listing endpoints to surface a "file unavailable" badge in the
 * UI, and we never want to label a file as missing because of a transient
 * network/permissions blip. Only a definitive "object does not exist" response
 * from storage produces "missing"; everything else (including thrown errors and
 * an empty/invalid fileUrl that we still need to render somehow) collapses to
 * "ok" so the row continues to behave normally.
 *
 * Results are cached in-process for a short TTL (default 30s, configurable
 * via `STORAGE_PROBE_OK_CACHE_TTL_MS` and
 * `STORAGE_PROBE_MISSING_CACHE_TTL_MS`) so repeated listings of large folders
 * do not pay a per-row round-trip on every request. Transient failures are
 * intentionally not cached so the next request gets a real probe.
 */
export async function probeStorageStatus(
  fileUrl: string | null | undefined,
): Promise<StorageStatus> {
  if (!fileUrl) {
    return "missing";
  }

  const now = Date.now();
  const cached = probeCache.get(fileUrl);
  if (cached) {
    if (cached.expiresAt > now) {
      return cached.status;
    }
    probeCache.delete(fileUrl);
  }

  const existing = probeInflight.get(fileUrl);
  if (existing) {
    return existing;
  }

  const pending = (async (): Promise<StorageStatus> => {
    const result = await probeImpl(fileUrl);
    if (result === "ok") {
      const ttl = getOkTtlMs();
      if (ttl > 0) {
        probeCache.set(fileUrl, { status: "ok", expiresAt: Date.now() + ttl });
        pruneProbeCache();
      }
      return "ok";
    }
    if (result === "missing") {
      const ttl = getMissingTtlMs();
      if (ttl > 0) {
        probeCache.set(fileUrl, {
          status: "missing",
          expiresAt: Date.now() + ttl,
        });
        pruneProbeCache();
      }
      return "missing";
    }
    // Transient error: fail-open to "ok" but skip the cache so the next
    // probe re-checks against storage.
    return "ok";
  })();

  probeInflight.set(fileUrl, pending);
  pending.finally(() => {
    if (probeInflight.get(fileUrl) === pending) {
      probeInflight.delete(fileUrl);
    }
  });

  return pending;
}

/**
 * Probe storage status for many fileUrls in parallel, deduplicating identical
 * URLs so each is only checked once per request. Backed by the same shared
 * cache as {@link probeStorageStatus}, so URLs probed by an earlier request
 * within the cache TTL skip the network round-trip.
 */
export async function probeStorageStatuses(
  fileUrls: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, StorageStatus>> {
  const unique = new Set<string>();
  for (const url of fileUrls) {
    if (typeof url === "string" && url.length > 0) {
      unique.add(url);
    }
  }
  const entries = await Promise.all(
    Array.from(unique).map(
      async (url) => [url, await probeStorageStatus(url)] as const,
    ),
  );
  return new Map(entries);
}

/**
 * Internal hooks used by the test suite to swap the underlying storage probe
 * with a stub and to reset cache state between tests. Not part of the public
 * API.
 */
export const __probeCacheTesting = {
  setProbeImpl(fn: (fileUrl: string) => Promise<RawProbeResult>) {
    probeImpl = fn;
  },
  resetProbeImpl() {
    probeImpl = rawProbeStorageStatus;
  },
  clearCache() {
    probeCache.clear();
    probeInflight.clear();
  },
  cacheSize() {
    return probeCache.size;
  },
};

function withStoredFileReadIdleTimeout(stream: Readable): Readable {
  async function* readWithTimeout() {
    const iterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        const next = await new Promise<IteratorResult<unknown>>((resolve, reject) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            const error = new Error("Stored file read stream stalled.");
            error.name = "TimeoutError";
            reject(error);
            stream.destroy(error);
          }, supabaseReadIdleTimeoutMs);

          iterator.next().then(
            (result) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              resolve(result);
            },
            (error) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              reject(error);
            },
          );
        });

        if (next.done) return;
        yield next.value;
      }
    } finally {
      try {
        await iterator.return?.();
      } catch {
        // The original stream error is already propagating to the consumer.
      }
      if (!stream.destroyed) stream.destroy();
    }
  }

  return Readable.from(readWithTimeout());
}

export async function openStoredFileReadStream(
  fileUrl: string,
): Promise<Readable> {
  if (storageBackend() === "local") {
    if (!(await localFileExists(fileUrl))) {
      throw new HttpError(404, "Stored file missing.");
    }
    return withStoredFileReadIdleTimeout(createReadStream(localFilePath(fileUrl)));
  }
  const { encodedPath } = supabaseObjectPath(fileUrl);
  const response = await supabaseStorageReadRequest(
    `/object/${encodedPath}`,
    { method: "GET" },
    new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
  );
  if (SUPABASE_OBJECT_MISSING_STATUSES.has(response.status)) {
    throw new HttpError(404, "Stored file missing.");
  }
  const resolved = await resolveSupabaseObjectRead(fileUrl, response);
  return withStoredFileReadIdleTimeout(resolved.stream);
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
  rangeHeader?: string | null;
  /** Chunk full responses and large ranges through Cloud Run. */
  forceChunked?: boolean;
}

export interface StreamStoredFileProgress {
  /**
   * Bytes that have actually been piped to the response so far. Caller
   * passes a mutable object so the running count is observable from
   * outside the promise, including from the catch path of the caller
   * when the storage read stream errors mid-transfer.
   */
  bytesStreamed: number;
}

export interface StreamStoredFileResult {
  /** Final bytes piped to the response. */
  bytesStreamed: number;
  /**
   * `true` when the response socket closed before the stream finished
   * (typical for a user navigating away from a slow PDF, or an `<img>`
   * src swap mid-load). The streamed bytes are still meaningful but
   * the transfer was not complete; callers should report this as a
   * failure when they want partial-view visibility in logs.
   */
  aborted: boolean;
}

function sendStoredFileReadFailurePage(res: ExpressResponse): void {
  if (res.headersSent) return;

  const requestId = String((res.req as { id?: unknown } | undefined)?.id ?? "")
    .replace(/[^\w.-]/g, "")
    .slice(0, 64);
  const reference = requestId
    ? `\n      <p class="reference">Reference: <code>${requestId}</code></p>`
    : "";
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>File temporarily unavailable</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f8fafc;
        color: #0f172a;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
        line-height: 1.2;
      }
      p {
        margin: 0;
        color: #475569;
        line-height: 1.5;
      }
      .reference {
        margin-top: 0.75rem;
        font-size: 0.875rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>File temporarily unavailable</h1>
      <p>We could not open this file just now. Please refresh and try again.</p>${reference}
    </main>
  </body>
</html>`;

  res.removeHeader("Content-Length");
  res.removeHeader("Transfer-Encoding");
  res.removeHeader("Content-Disposition");
  res.removeHeader("Content-Security-Policy");
  res.status(500);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

type StreamStoredFileImpl = (
  res: ExpressResponse,
  fileUrl: string,
  opts: SendStoredFileOptions,
  progress?: StreamStoredFileProgress,
) => Promise<StreamStoredFileResult>;

let streamStoredFileImpl: StreamStoredFileImpl | null = null;

type ByteRange = {
  start: number;
  end: number;
  size: number;
};

function parseByteRangeHeader(
  value: string | null | undefined,
  size: number,
): ByteRange | "invalid" | null {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size < 0) return "invalid";

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return "invalid";

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "invalid";

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd!, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    if (size === 0) return "invalid";
    const start = Math.max(size - suffixLength, 0);
    return { start, end: size - 1, size };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, size - 1),
    size,
  };
}

function byteRangeLength(range: ByteRange): number {
  return range.end - range.start + 1;
}

async function assertSupabaseRangeResponse(
  response: globalThis.Response,
  range: ByteRange,
): Promise<void> {
  const contentRange = response.headers.get("content-range")?.trim() ?? "";
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  const contentLength = readContentLength(response.headers.get("content-length"));
  const expectedLength = byteRangeLength(range);
  const valid =
    response.status === 206 &&
    match !== null &&
    Number(match[1]) === range.start &&
    Number(match[2]) === range.end &&
    Number(match[3]) === range.size &&
    contentLength === expectedLength;

  if (valid) return;

  if (response.body) {
    try {
      await response.body.cancel();
    } catch {
      // The response is already rejected; cancellation only stops an invalid
      // full-object response from continuing to consume bandwidth.
    }
  }
  throw new Error("Supabase Storage returned an invalid byte-range response.");
}

function sendUnsatisfiableRangeResponse(
  res: ExpressResponse,
  size: number,
): StreamStoredFileResult {
  res.status(416);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Range", `bytes */${size}`);
  res.setHeader("Content-Length", "0");
  res.end();
  return { bytesStreamed: 0, aborted: false };
}

function setStoredFileResponseHeaders(params: {
  res: ExpressResponse;
  opts: SendStoredFileOptions;
  contentLength: number | null;
  range: ByteRange | null;
}) {
  const headers = resolveSafeFileServingHeaders({
    originalName: params.opts.filename || "file",
    requestedDisposition: params.opts.disposition,
  });

  if (params.range) {
    params.res.status(206);
    params.res.setHeader(
      "Content-Range",
      `bytes ${params.range.start}-${params.range.end}/${params.range.size}`,
    );
  }

  params.res.setHeader("Content-Type", headers.contentType);
  params.res.setHeader("Content-Disposition", headers.contentDispositionHeader);
  params.res.setHeader("X-Content-Type-Options", "nosniff");
  params.res.setHeader("Content-Security-Policy", FILE_RESPONSE_CSP);
  params.res.setHeader("Cache-Control", params.opts.cacheControl ?? "private, max-age=3600");
  params.res.setHeader("Accept-Ranges", "bytes");

  const shouldChunkResponse =
    params.opts.forceChunked &&
    (!params.range || byteRangeLength(params.range) > CLOUD_RUN_SAFE_RESPONSE_BYTES);

  if (shouldChunkResponse) {
    params.res.removeHeader("Content-Length");
    params.res.setHeader("Transfer-Encoding", "chunked");
  } else if (params.contentLength !== null) {
    params.res.setHeader("Content-Length", String(params.contentLength));
  }
}

/**
 * Internal hook used by the test suite to swap the storage-backed streaming
 * implementation with a stub. Not part of the public API.
 */
export const __streamStoredFileTesting = {
  setImpl(fn: StreamStoredFileImpl) {
    streamStoredFileImpl = fn;
  },
  reset() {
    streamStoredFileImpl = null;
  },
};

async function streamReadableToResponse(params: {
  stream: Readable;
  res: ExpressResponse;
  fileUrl: string;
  progress?: StreamStoredFileProgress;
  expectedBytes?: number | null;
}): Promise<StreamStoredFileResult> {
  let bytesStreamed = 0;
  let aborted = false;

  await new Promise<void>((resolve, reject) => {
    const { stream, res, fileUrl, progress } = params;
    let settled = false;
    let idleTimeout: ReturnType<typeof setTimeout> | null = null;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const clearIdleTimeout = () => {
      if (!idleTimeout) return;
      clearTimeout(idleTimeout);
      idleTimeout = null;
    };

    const armIdleTimeout = () => {
      clearIdleTimeout();
      if (settled || stream.destroyed || stream.readableEnded) return;
      idleTimeout = setTimeout(() => {
        const error = new Error("Stored file response stalled.");
        error.name = "TimeoutError";
        stream.destroy(error);
      }, supabaseReadIdleTimeoutMs);
    };

    const cleanup = () => {
      clearIdleTimeout();
      stream.removeAllListeners();
      res.removeListener("close", onResClose);
    };

    const onResClose = () => {
      if (!res.writableEnded) {
        aborted = true;
        stream.destroy();
        settle(() => {
          cleanup();
          resolve();
        });
      }
    };

    stream.on("data", (chunk: Buffer | string) => {
      const len =
        typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      bytesStreamed += len;
      if (progress) {
        progress.bytesStreamed = bytesStreamed;
      }
      armIdleTimeout();
    });

    stream.on("error", (err) => {
      logger.error({ err, fileUrl }, "Stored file read stream error");
      if (!res.headersSent) {
        sendStoredFileReadFailurePage(res);
      } else {
        res.destroy(err);
      }
      settle(() => {
        cleanup();
        reject(err);
      });
    });

    stream.on("end", () => {
      if (
        typeof params.expectedBytes === "number" &&
        bytesStreamed !== params.expectedBytes
      ) {
        const error = new Error("Stored file response ended at an unexpected byte count.");
        logger.error(
          { fileUrl, bytesStreamed, expectedBytes: params.expectedBytes },
          "Stored file response byte count mismatch",
        );
        settle(() => {
          cleanup();
          if (!res.headersSent) {
            sendStoredFileReadFailurePage(res);
          } else {
            res.destroy(error);
          }
          reject(error);
        });
        return;
      }
      settle(() => {
        cleanup();
        resolve();
      });
    });

    res.on("close", onResClose);
    stream.on("pause", clearIdleTimeout);
    stream.on("resume", armIdleTimeout);
    armIdleTimeout();
    stream.pipe(res);
  });

  if (params.progress) {
    params.progress.bytesStreamed = bytesStreamed;
  }

  return { bytesStreamed, aborted };
}

export async function streamStoredFileToResponse(
  res: ExpressResponse,
  fileUrl: string,
  opts: SendStoredFileOptions,
  progress?: StreamStoredFileProgress,
): Promise<StreamStoredFileResult> {
  if (streamStoredFileImpl) {
    return streamStoredFileImpl(res, fileUrl, opts, progress);
  }

  if (storageBackend() === "local") {
    const filePath = localFilePath(fileUrl);
    let size: number | null = null;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        throw new HttpError(404, "Stored file missing.");
      }
      size = info.size;
    } catch (error) {
      if (error instanceof HttpError || (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "Stored file missing.");
      }
      throw error;
    }

    const range = parseByteRangeHeader(opts.rangeHeader, size);
    if (range === "invalid") {
      return sendUnsatisfiableRangeResponse(res, size);
    }

    setStoredFileResponseHeaders({
      res,
      opts: {
        ...opts,
        filename: opts.filename || path.basename(filePath) || "file",
      },
      contentLength: range ? byteRangeLength(range) : size,
      range,
    });
    return streamReadableToResponse({
      stream: range
        ? createReadStream(filePath, { start: range.start, end: range.end })
        : createReadStream(filePath),
      res,
      fileUrl,
      progress,
      expectedBytes: range ? byteRangeLength(range) : size,
    });
  }

  const { objectName, encodedPath } = supabaseObjectPath(fileUrl);
  let response: globalThis.Response;
  let resolved: { stream: Readable; manifest: SupabaseMultipartManifest | null };
  try {
    response = await supabaseStorageReadRequest(
      `/object/${encodedPath}`,
      { method: "GET" },
      new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
    );
    if (SUPABASE_OBJECT_MISSING_STATUSES.has(response.status)) {
      throw new HttpError(404, "Stored file missing.");
    }
    resolved = await resolveSupabaseObjectRead(fileUrl, response);
  } catch (error) {
    if (error instanceof HttpError && error.statusCode < 500) {
      throw error;
    }
    sendStoredFileReadFailurePage(res);
    throw error;
  }

  const filename = opts.filename || objectName.split("/").pop() || "file";

  if (resolved.manifest) {
    const range = parseByteRangeHeader(opts.rangeHeader, resolved.manifest.totalBytes);
    if (range === "invalid") {
      return sendUnsatisfiableRangeResponse(res, resolved.manifest.totalBytes);
    }

    setStoredFileResponseHeaders({
      res,
      opts: { ...opts, filename },
      contentLength: range
        ? byteRangeLength(range)
        : resolved.manifest.totalBytes,
      range,
    });
    return streamReadableToResponse({
      stream: range
        ? openSupabaseMultipartReadStream(resolved.manifest, range)
        : resolved.stream,
      res,
      fileUrl,
      progress,
      expectedBytes: range
        ? byteRangeLength(range)
        : resolved.manifest.totalBytes,
    });
  }

  const size = readContentLength(response.headers.get("content-length"));
  const range = size === null ? null : parseByteRangeHeader(opts.rangeHeader, size);
  if (range === "invalid") {
    if (size === null) {
      throw new Error("Cannot reject a byte range for a Supabase object without a known object size.");
    }
    return sendUnsatisfiableRangeResponse(res, size);
  }

  if (range) {
    resolved.stream.destroy();
    const rangedResponse = await supabaseStorageReadRequest(
      `/object/${encodedPath}`,
      {
        method: "GET",
        headers: {
          Range: `bytes=${range.start}-${range.end}`,
        },
      },
      new Set([200, 206, ...SUPABASE_OBJECT_MISSING_STATUSES]),
    );
    if (SUPABASE_OBJECT_MISSING_STATUSES.has(rangedResponse.status)) {
      throw new HttpError(404, "Stored file missing.");
    }
    await assertSupabaseRangeResponse(rangedResponse, range);
    if (!rangedResponse.body) {
      throw new Error("Supabase Storage returned an empty response body.");
    }
    setStoredFileResponseHeaders({
      res,
      opts: { ...opts, filename },
      contentLength: byteRangeLength(range),
      range,
    });
    return streamReadableToResponse({
      stream: Readable.fromWeb(rangedResponse.body as unknown as WebReadableStream),
      res,
      fileUrl,
      progress,
      expectedBytes: byteRangeLength(range),
    });
  }

  setStoredFileResponseHeaders({
    res,
    opts: { ...opts, filename },
    contentLength: size,
    range: null,
  });

  return streamReadableToResponse({
    stream: resolved.stream,
    res,
    fileUrl,
    progress,
    expectedBytes: size,
  });
}

/**
 * Stream a browser-safe native object through the application origin.
 * Legacy source objects remain untouched. Full responses and large ranges are
 * chunked so Cloud Run does not buffer a file above its HTTP/1 response cap.
 */
export async function streamPreparedStoredFileToResponse(
  res: ExpressResponse,
  fileUrl: string,
  opts: SendStoredFileOptions,
  progress?: StreamStoredFileProgress,
): Promise<StreamStoredFileResult> {
  const preparedFileUrl = await prepareStoredFileForDelivery(fileUrl);
  return streamStoredFileToResponse(
    res,
    preparedFileUrl,
    { ...opts, forceChunked: true },
    progress,
  );
}

function resolveAbsolutePathFromFileUrl(_fileUrl: string): never {
  throw new Error(
    "resolveAbsolutePathFromFileUrl is no longer supported; use streamStoredFileToResponse or openStoredFileReadStream.",
  );
}
