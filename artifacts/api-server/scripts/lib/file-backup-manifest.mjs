/**
 * Destination layout and manifest handling for SlabPlan's independent
 * private-file backup.
 *
 *   <root>/blobs/<aa>/<digest>          encrypted object versions
 *   <root>/manifests/<runId>.ndjson.spfb encrypted NDJSON manifest per run
 *   <root>/runs/<runId>.json            plaintext run summary, written last
 *
 * Blob and manifest names contain no customer file names or organization
 * IDs. Run summaries contain only counts, sizes and identifiers.
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createBackupDecryptStream,
  createBackupEncryptStream,
  createDigestPassThrough,
} from "./backup-crypto.mjs";

export const DEFAULT_BACKUP_ROOT = "slabplan-file-backup/v1";
export const MANIFEST_FORMAT = "slabplan-file-backup-manifest/v1";
export const RUN_SUMMARY_FORMAT = "slabplan-file-backup-run/v1";
const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const MAX_RUN_SUMMARY_BYTES = 256 * 1024;

export function normalizeBackupRoot(root = DEFAULT_BACKUP_ROOT) {
  const value = String(root).replace(/^\/+|\/+$/g, "");
  if (!value || value.split("/").some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === "." || part === "..")) {
    throw new Error("FILE_BACKUP_DEST_ROOT must be a relative path of safe segments.");
  }
  return value;
}

export function makeRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${randomBytes(4).toString("hex")}`;
}

export function assertRunId(runId) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) throw new Error("Invalid backup run id.");
  return runId;
}

export const backupPaths = {
  blobPrefix: (root) => `${root}/blobs/`,
  blob: (root, digest) => {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid blob digest.");
    return `${root}/blobs/${digest.slice(0, 2)}/${digest}`;
  },
  digestFromBlobName: (root, name) => {
    const match = new RegExp(`^${escapeRegExp(root)}/blobs/[0-9a-f]{2}/([0-9a-f]{64})$`).exec(name);
    return match ? match[1] : null;
  },
  manifest: (root, runId) => `${root}/manifests/${assertRunId(runId)}.ndjson.spfb`,
  manifestPrefix: (root) => `${root}/manifests/`,
  run: (root, runId) => `${root}/runs/${assertRunId(runId)}.json`,
  runPrefix: (root) => `${root}/runs/`,
  runIdFromRunName: (root, name) => {
    const match = new RegExp(`^${escapeRegExp(root)}/runs/(\\d{8}T\\d{6}Z-[0-9a-f]{8})\\.json$`).exec(name);
    return match ? match[1] : null;
  },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Organization id for tenant-scoped uploads, or null for other objects. */
export function organizationIdForObject(objectName) {
  const match = /^slabplan\/uploads\/organizations\/([^/]+)\//.exec(objectName);
  return match ? match[1] : null;
}

/**
 * Encrypt and upload a manifest. Entries are written as NDJSON between a
 * header and a footer; a reader that does not see the footer rejects the
 * manifest as incomplete.
 */
export async function writeManifest({ dest, root, runId, masterKey, header, entries, segmentBytes }) {
  const name = backupPaths.manifest(root, runId);
  const lines = (function* () {
    yield `${JSON.stringify({ type: "header", format: MANIFEST_FORMAT, runId, ...header })}\n`;
    let bytes = 0;
    for (const entry of entries) {
      bytes += entry.size;
      yield `${JSON.stringify({ type: "object", ...entry })}\n`;
    }
    yield `${JSON.stringify({ type: "footer", entries: entries.length, bytes })}\n`;
  })();
  const digest = createDigestPassThrough();
  let stored = null;
  await pipeline(
    Readable.from(lines, { objectMode: false }),
    digest.stream,
    createBackupEncryptStream(masterKey, segmentBytes ? { segmentBytes } : {}),
    async (encrypted) => {
      stored = await dest.uploadStream(name, encrypted, {
        contentType: "application/octet-stream",
        metadata: { "slabplan-backup-format": "spfb1-manifest" },
      });
    },
  );
  return { name, plainSha256: digest.result.sha256Hex, plainBytes: digest.result.bytes, stored };
}

/**
 * Stream a manifest, yielding its object entries only after the header has
 * been validated. Throws if the footer is missing or inconsistent.
 */
export async function* readManifestEntries({ dest, root, runId, masterKey }) {
  const source = await dest.downloadStream(backupPaths.manifest(root, runId));
  const plain = new PassThrough();
  const done = pipeline(source, createBackupDecryptStream(masterKey), plain);
  const lines = createInterface({ input: plain, crlfDelay: Infinity });
  let header = null;
  let footer = null;
  let count = 0;
  let bytes = 0;
  let finished = false;
  try {
    for await (const line of lines) {
      if (!line) continue;
      if (footer) throw new Error("Backup manifest has data after its footer.");
      const record = JSON.parse(line);
      if (!header) {
        if (record.type !== "header" || record.format !== MANIFEST_FORMAT || record.runId !== runId) {
          throw new Error("Backup manifest header does not match the requested run.");
        }
        header = record;
        continue;
      }
      if (record.type === "footer") {
        footer = record;
        continue;
      }
      if (record.type !== "object") throw new Error("Backup manifest has an unknown record type.");
      count += 1;
      bytes += record.size;
      yield record;
    }
    await done;
    finished = true;
  } finally {
    // Also runs when a consumer stops early; release the download.
    if (!finished) {
      plain.destroy();
      source.destroy();
      await done.catch(() => {});
    }
  }
  if (!footer || footer.entries !== count || footer.bytes !== bytes) {
    throw new Error("Backup manifest is incomplete or its footer does not match its entries.");
  }
}

export async function listRunIds(dest, root) {
  const items = await dest.listObjects(backupPaths.runPrefix(root));
  return items
    .map((item) => backupPaths.runIdFromRunName(root, item.name))
    .filter(Boolean)
    .sort();
}

export async function loadRunSummary(dest, root, runId) {
  const buffer = await dest.downloadBuffer(backupPaths.run(root, runId), {
    maxBytes: MAX_RUN_SUMMARY_BYTES,
  });
  const summary = JSON.parse(buffer.toString("utf8"));
  if (summary?.format !== RUN_SUMMARY_FORMAT || summary.runId !== runId) {
    throw new Error("Backup run summary is not in the expected format.");
  }
  return summary;
}

/** Resolve "latest" (newest run with a manifest) or an explicit run id. */
export async function resolveRun(dest, root, requested = "latest") {
  if (requested && requested !== "latest") {
    return await loadRunSummary(dest, root, assertRunId(requested));
  }
  const runIds = await listRunIds(dest, root);
  for (const runId of runIds.reverse()) {
    const summary = await loadRunSummary(dest, root, runId);
    if (summary.manifestObject) return summary;
  }
  return null;
}
