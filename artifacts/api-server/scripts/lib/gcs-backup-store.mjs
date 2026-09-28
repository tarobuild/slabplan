/**
 * Minimal Google Cloud Storage JSON API client for SlabPlan's independent
 * backup destination. Only Node built-ins are used.
 *
 * Uploads use the resumable protocol with bounded chunk buffers:
 * https://docs.cloud.google.com/storage/docs/performing-resumable-uploads
 * New objects are created with `ifGenerationMatch=0`, so the backup writer can
 * never overwrite an existing backup even if its IAM role allowed it.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

export const GCS_API_ORIGIN = "https://storage.googleapis.com";
export const GCS_CHUNK_ALIGNMENT = 256 * 1024;
export const DEFAULT_GCS_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TOKEN_REFRESH_MS = 40 * 60 * 1000;

export class GcsRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GcsRequestError";
    this.status = status;
  }
}

/**
 * Access tokens come from the Google Cloud CLI. In GitHub Actions the
 * `google-github-actions/auth` step configures gcloud with short-lived
 * Workload Identity Federation credentials, so no long-lived key exists.
 * Tokens are cached briefly, refreshed before their one-hour expiry, and
 * never logged.
 */
export function createGcloudTokenProvider({
  impersonateServiceAccount = "",
  execFileImpl = execFile,
  now = () => Date.now(),
} = {}) {
  let cached = null;
  let cachedAt = 0;
  const args = ["auth", "print-access-token", "--quiet"];
  if (impersonateServiceAccount) {
    if (!/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(impersonateServiceAccount)) {
      throw new Error("GCS_IMPERSONATE_SERVICE_ACCOUNT is not a service account email.");
    }
    args.push(`--impersonate-service-account=${impersonateServiceAccount}`);
  }
  return async function getAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && cached && now() - cachedAt < TOKEN_REFRESH_MS) return cached;
    const token = await new Promise((resolve, reject) => {
      execFileImpl(
        "gcloud",
        args,
        { timeout: 60_000, maxBuffer: 64 * 1024, env: process.env },
        (error, stdout) => {
          if (error) {
            reject(new Error("gcloud could not issue a Google Cloud access token. Confirm Workload Identity Federation or gcloud login."));
            return;
          }
          resolve(String(stdout).trim());
        },
      );
    });
    if (!token || /\s/.test(token)) {
      throw new Error("gcloud returned an unusable Google Cloud access token.");
    }
    cached = token;
    cachedAt = now();
    return token;
  };
}

function assertBucketName(bucket) {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket ?? "")) {
    throw new Error("FILE_BACKUP_GCS_BUCKET is not a valid bucket name.");
  }
}

async function readErrorSummary(response) {
  try {
    const text = await response.text();
    const parsed = JSON.parse(text);
    return String(parsed?.error?.message ?? "").slice(0, 200);
  } catch {
    return "";
  }
}

function parseRangeEnd(rangeHeader) {
  if (!rangeHeader) return -1;
  const match = /^bytes=0-(\d+)$/.exec(rangeHeader.trim());
  if (!match) throw new GcsRequestError("Unexpected resumable upload Range header.", 308);
  return Number(match[1]);
}

export function createGcsBackupStore({
  bucket,
  getAccessToken,
  fetchImpl = globalThis.fetch,
  apiOrigin = GCS_API_ORIGIN,
  uploadChunkBytes = DEFAULT_GCS_UPLOAD_CHUNK_BYTES,
  maxAttempts = 5,
  retryDelayMs = 1_000,
} = {}) {
  assertBucketName(bucket);
  if (typeof getAccessToken !== "function") {
    throw new Error("A Google Cloud access token provider is required.");
  }
  if (
    !Number.isInteger(uploadChunkBytes) ||
    uploadChunkBytes <= 0 ||
    uploadChunkBytes % GCS_CHUNK_ALIGNMENT !== 0
  ) {
    throw new Error("GCS upload chunk size must be a positive multiple of 256 KiB.");
  }
  const origin = new URL(apiOrigin).origin;
  const encodedBucket = encodeURIComponent(bucket);

  async function authorizedFetch(url, init = {}, { retry = true } = {}) {
    let attempt = 0;
    let forceRefresh = false;
    while (true) {
      attempt += 1;
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${await getAccessToken({ forceRefresh })}`);
      let response;
      try {
        response = await fetchImpl(url, { ...init, headers });
      } catch (error) {
        if (!retry || attempt >= maxAttempts) {
          throw new GcsRequestError(`Google Cloud Storage request failed: ${error?.message ?? error}`, 0);
        }
        await delay(retryDelayMs * attempt);
        continue;
      }
      if (response.status === 401 && attempt < maxAttempts && !forceRefresh) {
        await response.body?.cancel();
        forceRefresh = true;
        continue;
      }
      forceRefresh = false;
      if (retry && RETRYABLE_STATUSES.has(response.status) && attempt < maxAttempts) {
        await response.body?.cancel();
        await delay(retryDelayMs * attempt);
        continue;
      }
      return response;
    }
  }

  async function expectOk(response, action, okStatuses = [200]) {
    if (okStatuses.includes(response.status)) return response;
    const summary = await readErrorSummary(response);
    throw new GcsRequestError(
      `Google Cloud Storage ${action} failed (${response.status})${summary ? `: ${summary}` : ""}`,
      response.status,
    );
  }

  function objectUrl(name, query = {}) {
    const url = new URL(`${origin}/storage/v1/b/${encodedBucket}/o/${encodeURIComponent(name)}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    return url;
  }

  /** List objects under a prefix. Returns name/size/generation/md5/time/metadata only. */
  async function listObjects(prefix, { maxObjects = 1_000_000 } = {}) {
    const items = [];
    let pageToken = "";
    do {
      const url = new URL(`${origin}/storage/v1/b/${encodedBucket}/o`);
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("maxResults", "1000");
      url.searchParams.set(
        "fields",
        "nextPageToken,items(name,size,generation,md5Hash,timeCreated,metadata)",
      );
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await expectOk(await authorizedFetch(url), "list");
      const page = await response.json();
      for (const item of page.items ?? []) {
        items.push({
          name: item.name,
          size: Number(item.size ?? 0),
          generation: item.generation ?? null,
          md5Hash: item.md5Hash ?? null,
          timeCreated: item.timeCreated ?? null,
          metadata: item.metadata ?? {},
        });
        if (items.length > maxObjects) {
          throw new Error(`Backup listing exceeded ${maxObjects} objects under ${prefix}; refusing to continue.`);
        }
      }
      pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return items;
  }

  async function startResumableUpload(name, { contentType, metadata, ifGenerationMatch }) {
    const url = new URL(`${origin}/upload/storage/v1/b/${encodedBucket}/o`);
    url.searchParams.set("uploadType", "resumable");
    if (ifGenerationMatch !== undefined && ifGenerationMatch !== null) {
      url.searchParams.set("ifGenerationMatch", String(ifGenerationMatch));
    }
    const response = await expectOk(
      await authorizedFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": contentType,
        },
        body: JSON.stringify({ name, contentType, metadata }),
      }),
      "upload session start",
    );
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) throw new GcsRequestError("Upload session did not return a session URI.", response.status);
    const sessionUrl = new URL(location);
    // Never send credentials or data to a session host other than the API.
    if (sessionUrl.origin !== origin) {
      throw new GcsRequestError("Upload session URI has an unexpected origin.", response.status);
    }
    return sessionUrl;
  }

  async function queryUploadStatus(sessionUrl) {
    const response = await authorizedFetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": "bytes */*" },
      body: Buffer.alloc(0),
    });
    if (response.status === 308) {
      await response.body?.cancel();
      return { persistedEnd: parseRangeEnd(response.headers.get("range")), stored: null };
    }
    if (response.status === 200 || response.status === 201) {
      return { persistedEnd: null, stored: await response.json() };
    }
    await expectOk(response, "upload status", []);
    return { persistedEnd: -1, stored: null };
  }

  async function putChunk(sessionUrl, chunk, start, totalBytes) {
    const end = start + chunk.length - 1;
    const total = totalBytes === null ? "*" : String(totalBytes);
    const final = totalBytes !== null;
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await authorizedFetch(
          sessionUrl,
          {
            method: "PUT",
            headers: { "Content-Range": `bytes ${start}-${end}/${total}` },
            body: chunk,
          },
          { retry: false },
        );
      } catch (error) {
        response = null;
        if (attempt >= maxAttempts) throw error;
      }
      if (response && final && (response.status === 200 || response.status === 201)) {
        return await response.json();
      }
      if (response && !final && response.status === 308) {
        const persistedEnd = parseRangeEnd(response.headers.get("range"));
        await response.body?.cancel();
        if (persistedEnd !== end) {
          throw new GcsRequestError(
            `Upload persisted through byte ${persistedEnd}, expected ${end}.`,
            308,
          );
        }
        return null;
      }
      if (response && !RETRYABLE_STATUSES.has(response.status)) {
        await expectOk(response, "upload chunk", []);
      }
      await response?.body?.cancel();
      if (attempt >= maxAttempts) {
        throw new GcsRequestError("Upload chunk failed after retries.", response?.status ?? 0);
      }
      await delay(retryDelayMs * attempt);
      // Resume from whatever the service persisted; resend only if needed.
      const status = await queryUploadStatus(sessionUrl);
      if (status.stored) {
        if (final) return status.stored;
        throw new GcsRequestError("Upload session finalized before all chunks were sent.", 200);
      }
      const persistedEnd = status.persistedEnd;
      if (!final && persistedEnd === end) return null;
      if (persistedEnd !== start - 1) {
        throw new GcsRequestError(
          `Upload session persisted through byte ${persistedEnd}; cannot safely resume chunk at ${start}.`,
          308,
        );
      }
    }
  }

  async function cancelSession(sessionUrl) {
    try {
      const response = await authorizedFetch(sessionUrl, { method: "DELETE" }, { retry: false });
      await response.body?.cancel();
    } catch {
      // Abandoned sessions expire automatically after one week.
    }
  }

  /**
   * Stream a readable into a new object. Memory is bounded by one upload
   * chunk plus the readable's own buffer. Returns the stored object's
   * metadata after verifying its size and MD5 against the bytes sent.
   */
  async function uploadStream(
    name,
    readable,
    { contentType = "application/octet-stream", metadata = {}, ifGenerationMatch = 0 } = {},
  ) {
    const sessionUrl = await startResumableUpload(name, { contentType, metadata, ifGenerationMatch });
    const md5 = createHash("md5");
    let buffered = [];
    let bufferedBytes = 0;
    let offset = 0;
    let completed = false;

    const takeChunk = (count) => {
      const all = Buffer.concat(buffered, bufferedBytes);
      const chunk = all.subarray(0, count);
      const rest = all.subarray(count);
      buffered = rest.length ? [rest] : [];
      bufferedBytes = rest.length;
      return chunk;
    };

    try {
      for await (const piece of readable) {
        const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
        md5.update(buffer);
        buffered.push(buffer);
        bufferedBytes += buffer.length;
        // Keep at least one byte back so the final request always has data.
        while (bufferedBytes > uploadChunkBytes) {
          const chunk = takeChunk(uploadChunkBytes);
          await putChunk(sessionUrl, chunk, offset, null);
          offset += chunk.length;
        }
      }
      if (bufferedBytes === 0 && offset === 0) {
        throw new Error("Refusing to upload an empty backup object.");
      }
      const finalChunk = takeChunk(bufferedBytes);
      const totalBytes = offset + finalChunk.length;
      const stored = await putChunk(sessionUrl, finalChunk, offset, totalBytes);
      completed = true;
      const expectedMd5 = md5.digest("base64");
      if (Number(stored?.size) !== totalBytes) {
        throw new GcsRequestError(`Stored object size ${stored?.size} does not match ${totalBytes} bytes sent.`, 200);
      }
      if (stored?.md5Hash && stored.md5Hash !== expectedMd5) {
        throw new GcsRequestError("Stored object MD5 does not match the bytes sent.", 200);
      }
      if (!stored?.md5Hash) {
        throw new GcsRequestError("Stored object did not report an MD5 hash for verification.", 200);
      }
      return {
        name: stored.name,
        size: totalBytes,
        generation: stored.generation ?? null,
        md5Hash: stored.md5Hash,
      };
    } catch (error) {
      if (!completed) await cancelSession(sessionUrl);
      throw error;
    }
  }

  async function uploadBuffer(name, buffer, options = {}) {
    return await uploadStream(name, Readable.from([buffer]), options);
  }

  /** Download an object as a Node readable stream. */
  async function downloadStream(name, { generation } = {}) {
    const query = { alt: "media" };
    if (generation) query.generation = generation;
    const response = await expectOk(await authorizedFetch(objectUrl(name, query)), "download");
    if (!response.body) throw new GcsRequestError("Download returned no body.", response.status);
    return Readable.fromWeb(response.body);
  }

  async function downloadBuffer(name, { maxBytes = 64 * 1024 * 1024 } = {}) {
    const stream = await downloadStream(name);
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy();
        throw new Error(`Object ${name} exceeds the ${maxBytes}-byte in-memory limit.`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }

  /** Delete one object generation. Used only by operator-run pruning. */
  async function deleteObject(name, { generation } = {}) {
    const query = {};
    if (generation) query.generation = generation;
    const response = await authorizedFetch(objectUrl(name, query), { method: "DELETE" });
    await expectOk(response, "delete", [200, 204]);
    await response.body?.cancel();
  }

  return {
    bucket,
    listObjects,
    uploadStream,
    uploadBuffer,
    downloadStream,
    downloadBuffer,
    deleteObject,
  };
}
