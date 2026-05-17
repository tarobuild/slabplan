import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Response as ExpressResponse } from "express";
import {
  FILE_RESPONSE_CSP,
  resolveSafeFileServingHeaders,
} from "./file-serving";
import { HttpError } from "./http";
import { logger } from "./logger";
import { APP_STORAGE_PREFIX } from "./brand";

const SUPABASE_UPLOAD_PREFIX = APP_STORAGE_PREFIX;
const SUPABASE_OBJECT_MISSING_STATUSES = new Set([400, 404]);

function getRequiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

function getSupabaseConfig() {
  const rawUrl = getRequiredEnv("SUPABASE_URL");
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
  if (
    relative.includes("..") ||
    relative.startsWith("/") ||
    relative.includes("\0")
  ) {
    throw new Error(`Invalid stored file URL: ${fileUrl}`);
  }
  return relative;
}

function fileUrlToSupabaseObjectName(fileUrl: string): string {
  const relative = fileUrlToRelativePath(fileUrl);
  return path.posix.join(SUPABASE_UPLOAD_PREFIX, relative);
}

function encodeStoragePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function supabaseStorageRequest(
  storagePath: string,
  init: RequestInit & { duplex?: "half" } = {},
  okStatuses: ReadonlySet<number> = new Set([200]),
): Promise<globalThis.Response> {
  const config = getSupabaseConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);

  const response = await fetch(`${config.url}/storage/v1${storagePath}`, {
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
    throw new Error(
      `Supabase Storage request failed (${response.status}) for ${storagePath}${
        body ? `: ${body.slice(0, 240)}` : ""
      }`,
    );
  }

  return response;
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

function normalizeFileComponent(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function ensureUploadRoot(): Promise<void> {
  // Supabase Storage requires no local filesystem preparation; retained for
  // backwards compatibility with existing startup code.
}

type HeadBucketImpl = () => Promise<void>;

const defaultHeadBucket: HeadBucketImpl = async () => {
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
};

const defaultWriteUploadedFromPath: WriteUploadedFromPathImpl = async (
  fileUrl,
  sourcePath,
  options,
) => {
  const { encodedPath } = supabaseObjectPath(fileUrl);
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
  },
};

export async function deletePhysicalFile(
  fileUrl: string | null | undefined,
): Promise<void> {
  if (!fileUrl) {
    return;
  }
  try {
    const { encodedPath } = supabaseObjectPath(fileUrl);
    await supabaseStorageRequest(
      `/object/${encodedPath}`,
      { method: "DELETE" },
      new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
    );
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

export async function openStoredFileReadStream(
  fileUrl: string,
): Promise<Readable> {
  const { encodedPath } = supabaseObjectPath(fileUrl);
  const response = await supabaseStorageRequest(
    `/object/${encodedPath}`,
    { method: "GET" },
    new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
  );
  if (SUPABASE_OBJECT_MISSING_STATUSES.has(response.status)) {
    throw new HttpError(404, "Stored file missing.");
  }
  if (!response.body) {
    throw new Error("Supabase Storage returned an empty response body.");
  }
  return Readable.fromWeb(response.body as unknown as WebReadableStream);
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

type StreamStoredFileImpl = (
  res: ExpressResponse,
  fileUrl: string,
  opts: SendStoredFileOptions,
  progress?: StreamStoredFileProgress,
) => Promise<StreamStoredFileResult>;

let streamStoredFileImpl: StreamStoredFileImpl | null = null;

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
}): Promise<StreamStoredFileResult> {
  let bytesStreamed = 0;
  let aborted = false;

  await new Promise<void>((resolve, reject) => {
    const { stream, res, fileUrl, progress } = params;
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
    });

    stream.on("error", (err) => {
      logger.error({ err, fileUrl }, "Stored file read stream error");
      if (!res.headersSent) {
        res.status(500).end();
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

  const { objectName, encodedPath } = supabaseObjectPath(fileUrl);
  const response = await supabaseStorageRequest(
    `/object/${encodedPath}`,
    { method: "GET" },
    new Set([200, ...SUPABASE_OBJECT_MISSING_STATUSES]),
  );
  if (SUPABASE_OBJECT_MISSING_STATUSES.has(response.status)) {
    throw new HttpError(404, "Stored file missing.");
  }
  if (!response.body) {
    throw new Error("Supabase Storage returned an empty response body.");
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
  const size = response.headers.get("content-length");
  if (size) {
    res.setHeader("Content-Length", size);
  }

  return streamReadableToResponse({
    stream: Readable.fromWeb(response.body as unknown as WebReadableStream),
    res,
    fileUrl,
    progress,
  });
}

function resolveAbsolutePathFromFileUrl(_fileUrl: string): never {
  throw new Error(
    "resolveAbsolutePathFromFileUrl is no longer supported; use streamStoredFileToResponse or openStoredFileReadStream.",
  );
}
