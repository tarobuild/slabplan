#!/usr/bin/env node
/**
 * Independent private-file backup for SlabPlan.
 *
 * Copies private objects from the primary Supabase Storage bucket, plus the
 * day's logical database dump, into a separate Google Cloud Storage bucket.
 * Every object is encrypted client-side before upload (see
 * lib/backup-crypto.mjs), destination names are keyed digests, and uploads
 * are create-only. Runs are incremental: unchanged object versions that are
 * already in the destination are carried forward from the previous manifest.
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_STORAGE_BUCKET, SUPABASE_SERVICE_ROLE_KEY
 *   FILE_BACKUP_GCS_BUCKET
 *   FILE_BACKUP_ENCRYPTION_KEY       64 hex characters, never logged
 * Optional env:
 *   FILE_BACKUP_EXPECTED_KEY_ID      16 hex characters; guards key mix-ups
 *   FILE_BACKUP_DEST_ROOT            default slabplan-file-backup/v1
 *   FILE_BACKUP_SOURCE_PREFIXES      default slabplan/uploads/
 *   FILE_BACKUP_REQUIRE_DB_DUMP      default true
 *   FILE_BACKUP_DB_DUMP_DATE         default today's UTC date
 *   FILE_BACKUP_MAX_NEW_BYTES        default 107374182400 (100 GiB per run)
 *   FILE_BACKUP_MAX_OBJECTS          default 250000
 *   FILE_BACKUP_CONCURRENCY          default 3
 *   FILE_BACKUP_SUMMARY_PATH         write the run summary JSON locally
 *   GCS_IMPERSONATE_SERVICE_ACCOUNT  optional, for operator-run drills
 *
 * Documented in docs/private-file-backup-runbook.md.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  backupBlobDigest,
  backupKeyIdHex,
  createBackupDecryptStream,
  createBackupEncryptStream,
  createDigestPassThrough,
  DEFAULT_BACKUP_SEGMENT_BYTES,
  encryptedLengthFor,
  parseBackupMasterKey,
} from "./lib/backup-crypto.mjs";
import {
  backupPaths,
  makeRunId,
  normalizeBackupRoot,
  organizationIdForObject,
  readManifestEntries,
  resolveRun,
  RUN_SUMMARY_FORMAT,
  storageIdentity,
  writeManifest,
} from "./lib/file-backup-manifest.mjs";
import { createGcloudTokenProvider, createGcsBackupStore } from "./lib/gcs-backup-store.mjs";
import {
  classifyStoredObject,
  createManifestCapture,
  isMultipartManifestContentType,
  multipartClosureProblems,
  multipartSummary,
  safeInvalidManifestReason,
} from "./lib/multipart-manifest.mjs";
import { createSupabaseStorage, getRequiredEnv } from "./lib/supabase-storage.mjs";

export const DEFAULT_SOURCE_PREFIXES = ["slabplan/uploads/"];
export const DB_DUMP_PREFIX = "backups/db/";
export const DEFAULT_MAX_NEW_BYTES = 100 * 1024 ** 3;
export const DEFAULT_MAX_OBJECTS = 250_000;
// Delivery copies are re-materialized on demand from their multipart
// manifest and parts (see prepareStoredFileForDelivery in src/lib/storage.ts).
export const EXCLUDED_OBJECT_SUFFIXES = [".cadstone-native"];

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(String(value).trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new Error(`Expected a boolean value, received "${value}".`);
}

export function parseSourcePrefixes(value) {
  if (!value || !value.trim()) return [...DEFAULT_SOURCE_PREFIXES];
  const prefixes = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.endsWith("/") ? item : `${item}/`));
  for (const prefix of prefixes) {
    if (prefix.startsWith("/") || prefix.split("/").slice(0, -1).some((part) => !part || part === "." || part === "..")) {
      throw new Error("FILE_BACKUP_SOURCE_PREFIXES contains an unsafe prefix.");
    }
  }
  return prefixes;
}

export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function readBackupConfig(env = process.env, now = new Date()) {
  const masterKey = parseBackupMasterKey(getRequiredEnv("FILE_BACKUP_ENCRYPTION_KEY", env));
  const keyId = backupKeyIdHex(masterKey);
  const expectedKeyId = env.FILE_BACKUP_EXPECTED_KEY_ID?.trim();
  if (expectedKeyId && expectedKeyId.toLowerCase() !== keyId) {
    throw new Error(
      `FILE_BACKUP_ENCRYPTION_KEY has key id ${keyId}, but FILE_BACKUP_EXPECTED_KEY_ID is ${expectedKeyId}. Refusing to use an unexpected key.`,
    );
  }
  const dbDumpDate = env.FILE_BACKUP_DB_DUMP_DATE?.trim() || todayUtc(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dbDumpDate)) throw new Error("FILE_BACKUP_DB_DUMP_DATE must be YYYY-MM-DD.");
  return {
    masterKey,
    keyId,
    gcsBucket: getRequiredEnv("FILE_BACKUP_GCS_BUCKET", env),
    root: normalizeBackupRoot(env.FILE_BACKUP_DEST_ROOT?.trim() || undefined),
    sourcePrefixes: parseSourcePrefixes(env.FILE_BACKUP_SOURCE_PREFIXES),
    requireDbDump: parseBoolean(env.FILE_BACKUP_REQUIRE_DB_DUMP, true),
    dbDumpDate,
    maxNewBytes: parsePositiveInteger(env.FILE_BACKUP_MAX_NEW_BYTES, DEFAULT_MAX_NEW_BYTES, "FILE_BACKUP_MAX_NEW_BYTES"),
    maxObjects: parsePositiveInteger(env.FILE_BACKUP_MAX_OBJECTS, DEFAULT_MAX_OBJECTS, "FILE_BACKUP_MAX_OBJECTS"),
    concurrency: Math.min(parsePositiveInteger(env.FILE_BACKUP_CONCURRENCY, 3, "FILE_BACKUP_CONCURRENCY"), 16),
    summaryPath: env.FILE_BACKUP_SUMMARY_PATH?.trim() || null,
    impersonateServiceAccount: env.GCS_IMPERSONATE_SERVICE_ACCOUNT?.trim() || "",
  };
}

export function versionTagFor(object) {
  const metadata = object.metadata ?? {};
  return [
    metadata.eTag ?? "",
    Number(metadata.size ?? 0),
    metadata.lastModified ?? object.updated ?? "",
  ].join("|");
}

export function isExcludedObject(name) {
  return EXCLUDED_OBJECT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Error text safe for CI logs: object names are replaced by a digest label. */
export function redactObjectName(message, objectName, label) {
  let text = String(message ?? "unknown error");
  for (const variant of [objectName, encodeURI(objectName), objectName.split("/").map(encodeURIComponent).join("/")]) {
    if (variant) text = text.split(variant).join(label);
  }
  return text.slice(0, 300);
}

/** Fails the stream before the final segment if the source is not the listed size. */
function createExactSizeGuard(expectedBytes) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length;
      if (seen > expectedBytes) {
        callback(new Error(`Source object grew beyond its listed ${expectedBytes} bytes during backup.`));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      callback(
        seen === expectedBytes
          ? null
          : new Error(`Source object returned ${seen} bytes, but was listed at ${expectedBytes}.`),
      );
    },
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function loadPreviousIndex({ dest, root, masterKey, log }) {
  const previousRun = await resolveRun(dest, root, "latest");
  const index = new Map();
  if (!previousRun) return { previousRunId: null, index };
  for await (const entry of readManifestEntries({ dest, root, runId: previousRun.runId, masterKey })) {
    index.set(entry.blobDigest, { sha256: entry.sha256, size: entry.size, classification: classificationFromEntry(entry) });
  }
  log(`[backup] previous run ${previousRun.runId}`);
  return { previousRunId: previousRun.runId, index };
}

function contentTypeOf(object) {
  return object.metadata?.mimetype ?? object.metadata?.contentType ?? null;
}

/** Restore the recorded classification of a carried-forward entry. */
function classificationFromEntry(entry) {
  if (entry.multipart) return { kind: "multipart", summary: entry.multipart };
  if (entry.invalidMultipart) return { kind: "invalid", reason: safeInvalidManifestReason(entry.invalidMultipart) };
  return { kind: "native" };
}

function classify(object, capture) {
  const result = classifyStoredObject({ objectName: object.name, contentType: contentTypeOf(object), capture });
  if (result.kind === "multipart") return { kind: "multipart", summary: multipartSummary(result.manifest) };
  return result;
}

/** Download and authenticate an existing blob to recover its plaintext hash. */
async function hashExistingBlob({ dest, blobName, masterKey, object }) {
  const digest = createDigestPassThrough();
  const capture = createManifestCapture({ declared: isMultipartManifestContentType(contentTypeOf(object)) });
  const sink = new PassThrough();
  sink.resume();
  await pipeline(await dest.downloadStream(blobName), createBackupDecryptStream(masterKey), digest.stream, capture.stream, sink);
  return { sha256: digest.result.sha256Hex, size: digest.result.bytes, classification: classify(object, capture.result) };
}

async function copyObject({ source, dest, object, blobName, masterKey, keyId, segmentBytes }) {
  const expectedBytes = Number(object.metadata?.size ?? NaN);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new Error("Source listing did not report a valid object size.");
  }
  const digest = createDigestPassThrough();
  // Keep a bounded copy of anything that could be a multipart manifest so
  // the run can check that every part the file needs was also captured.
  const capture = createManifestCapture({ declared: isMultipartManifestContentType(contentTypeOf(object)) });
  let stored = null;
  await pipeline(
    await source.downloadStream(object.name),
    digest.stream,
    capture.stream,
    createExactSizeGuard(expectedBytes),
    createBackupEncryptStream(masterKey, { segmentBytes }),
    async (encrypted) => {
      stored = await dest.uploadStream(blobName, encrypted, {
        contentType: "application/octet-stream",
        metadata: { "slabplan-backup-format": "spfb1", "slabplan-backup-key-id": keyId },
      });
    },
  );
  const expectedStored = encryptedLengthFor(digest.result.bytes, segmentBytes);
  if (stored?.size !== expectedStored) {
    throw new Error(`Stored blob is ${stored?.size} bytes, expected ${expectedStored}.`);
  }
  return { sha256: digest.result.sha256Hex, size: digest.result.bytes, classification: classify(object, capture.result) };
}

function manifestEntryFor(object, category, blobDigest, hashed) {
  const metadata = object.metadata ?? {};
  const classification = hashed.classification ?? { kind: "native" };
  return {
    name: object.name,
    category,
    organizationId: organizationIdForObject(object.name),
    size: hashed.size,
    sha256: hashed.sha256,
    contentType: metadata.mimetype ?? metadata.contentType ?? null,
    cacheControl: metadata.cacheControl ?? null,
    sourceETag: metadata.eTag ?? null,
    sourceUpdatedAt: metadata.lastModified ?? object.updated ?? null,
    blobDigest,
    ...(classification.kind === "multipart" ? { multipart: classification.summary } : {}),
    ...(classification.kind === "invalid" ? { invalidMultipart: classification.reason } : {}),
  };
}

export async function runFileBackup({
  source,
  dest,
  config,
  now = () => new Date(),
  log = console.log,
  segmentBytes = DEFAULT_BACKUP_SEGMENT_BYTES,
}) {
  const { masterKey, keyId, root } = config;
  // The primary's identity is recorded in the authenticated manifest so a
  // later storage restore can refuse to target it without an override.
  const sourceIdentity = storageIdentity(source.projectUrl, source.bucketName);
  if (!sourceIdentity) throw new Error("Source storage must report its project URL and bucket.");
  const recordedSource = { url: new URL(source.projectUrl).origin, bucket: source.bucketName };
  const startedAt = now();
  const runId = makeRunId(startedAt);
  // The repository is public, so CI logs carry status only. Counts, sizes
  // and tenant totals stay in the private run summary in the backup bucket.
  log(`[backup] run=${runId} keyId=${keyId}`);

  const failures = [];
  const { previousRunId, index: previousIndex } = await loadPreviousIndex({ dest, root, masterKey, log });
  const existingBlobs = new Map(
    (await dest.listObjects(backupPaths.blobPrefix(root), { maxObjects: config.maxObjects * 4 })).map((item) => [item.name, item]),
  );

  const candidates = [];
  let excluded = 0;
  for (const prefix of config.sourcePrefixes) {
    const listed = await source.listAllObjects(prefix, { maxObjects: config.maxObjects });
    for (const object of listed) {
      if (isExcludedObject(object.name)) {
        excluded += 1;
        continue;
      }
      candidates.push({ object, category: "upload" });
    }
  }

  const dbDump = { date: config.dbDumpDate, required: config.requireDbDump, present: false };
  if (config.requireDbDump) {
    const dumpName = `${DB_DUMP_PREFIX}${config.dbDumpDate}.sql.gz`;
    const dumps = await source.listAllObjects(DB_DUMP_PREFIX.replace(/\/$/, ""), { maxObjects: 5_000 });
    const dump = dumps.find((item) => item.name === dumpName);
    if (dump && Number(dump.metadata?.size ?? 0) > 0) {
      dbDump.present = true;
      candidates.push({ object: dump, category: "database" });
    } else {
      failures.push({ label: "db-dump", reason: `Database dump for ${config.dbDumpDate} is missing or empty.` });
    }
  }
  if (candidates.length > config.maxObjects) {
    throw new Error(`Source has ${candidates.length} objects, above FILE_BACKUP_MAX_OBJECTS=${config.maxObjects}.`);
  }
  candidates.sort((a, b) => (a.object.name < b.object.name ? -1 : a.object.name > b.object.name ? 1 : 0));

  const entries = [];
  const toCopy = [];
  const counts = { sourceObjects: candidates.length, excluded, carried: 0, recovered: 0, copied: 0, vanished: 0, failed: 0, deferred: 0, multipartFiles: 0, multipartIncomplete: 0 };
  let sourceBytes = 0;

  for (const candidate of candidates) {
    const { object } = candidate;
    const size = Number(object.metadata?.size ?? 0);
    sourceBytes += size;
    const blobDigest = backupBlobDigest(masterKey, object.name, versionTagFor(object));
    const blobName = backupPaths.blob(root, blobDigest);
    const label = `blob:${blobDigest.slice(0, 12)}`;
    const existing = existingBlobs.get(blobName);
    if (!existing) {
      toCopy.push({ ...candidate, blobDigest, blobName, label, size });
      continue;
    }
    const previous = previousIndex.get(blobDigest);
    // Carry forward only when the stored ciphertext has the exact expected
    // length; anything else is re-authenticated from the destination below.
    if (previous && previous.size === size && existing.size === encryptedLengthFor(size, segmentBytes)) {
      entries.push(manifestEntryFor(object, candidate.category, blobDigest, previous));
      counts.carried += 1;
      continue;
    }
    try {
      const hashed = await hashExistingBlob({ dest, blobName, masterKey, object });
      if (hashed.size !== size) throw new Error(`Existing blob holds ${hashed.size} bytes, listed ${size}.`);
      entries.push(manifestEntryFor(object, candidate.category, blobDigest, hashed));
      counts.recovered += 1;
    } catch (error) {
      failures.push({ label, reason: redactObjectName(error?.message, object.name, label) });
      counts.failed += 1;
    }
  }

  let plannedBytes = 0;
  const admitted = [];
  for (const item of toCopy) {
    if (plannedBytes + item.size > config.maxNewBytes) {
      counts.deferred += 1;
      continue;
    }
    plannedBytes += item.size;
    admitted.push(item);
  }
  if (counts.deferred > 0) {
    failures.push({
      label: "new-bytes-cap",
      reason: `${counts.deferred} objects deferred: FILE_BACKUP_MAX_NEW_BYTES=${config.maxNewBytes} reached. Review cost, then raise the cap or let later runs continue.`,
    });
  }

  let copiedBytes = 0;
  await mapWithConcurrency(admitted, config.concurrency, async (item) => {
    try {
      const hashed = await copyObject({
        source,
        dest,
        object: item.object,
        blobName: item.blobName,
        masterKey,
        keyId,
        segmentBytes,
      });
      entries.push(manifestEntryFor(item.object, item.category, item.blobDigest, hashed));
      counts.copied += 1;
      copiedBytes += hashed.size;
    } catch (error) {
      // An object deleted by a user after listing is not a backup failure.
      const stillExists = await source.objectExists(item.object.name).catch(() => true);
      if (!stillExists) {
        counts.vanished += 1;
        return;
      }
      counts.failed += 1;
      failures.push({ label: item.label, reason: redactObjectName(error?.message, item.object.name, item.label) });
    }
  });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Recovery coverage: a file stored as a multipart manifest is only
  // recoverable if every part it names is in this same run with its size.
  for (const entry of entries) {
    if (entry.multipart) counts.multipartFiles += 1;
    if (entry.invalidMultipart) {
      const label = `blob:${entry.blobDigest.slice(0, 12)}`;
      failures.push({ label, reason: safeInvalidManifestReason(entry.invalidMultipart) });
      counts.multipartIncomplete += 1;
    }
  }
  const incomplete = new Set();
  for (const problem of multipartClosureProblems(entries)) {
    const label = `blob:${problem.entry.blobDigest.slice(0, 12)}`;
    failures.push({ label, reason: problem.reason });
    incomplete.add(problem.entry.name);
  }
  counts.multipartIncomplete += incomplete.size;

  const manifest = await writeManifest({
    dest,
    root,
    runId,
    masterKey,
    segmentBytes,
    header: {
      startedAt: startedAt.toISOString(),
      keyId,
      source: recordedSource,
      sourcePrefixes: config.sourcePrefixes,
      dbDumpDate: config.dbDumpDate,
    },
    entries,
  });

  const organizations = new Set(entries.map((entry) => entry.organizationId).filter(Boolean));
  const status = failures.length === 0 ? "complete" : "partial";
  const summary = {
    format: RUN_SUMMARY_FORMAT,
    runId,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    keyId,
    previousRunId,
    source: recordedSource,
    sourcePrefixes: config.sourcePrefixes,
    manifestObject: manifest.name,
    manifestPlainSha256: manifest.plainSha256,
    manifestEntries: entries.length,
    organizations: organizations.size,
    counts,
    bytes: { source: sourceBytes, copied: copiedBytes, maxNewBytes: config.maxNewBytes },
    dbDump,
    failures: failures.slice(0, 50),
    failureCount: failures.length,
  };
  await dest.uploadBuffer(backupPaths.run(root, runId), Buffer.from(`${JSON.stringify(summary, null, 2)}\n`), {
    contentType: "application/json",
    metadata: { "slabplan-backup-format": "run-summary" },
  });
  log(`[backup] run=${runId} status=${status} failed=${counts.failed} deferred=${counts.deferred} dbDump=${dbDump.present ? "present" : dbDump.required ? "MISSING" : "not-required"}`);
  for (const failure of failures.slice(0, 20)) log(`[backup] failure ${failure.label}: ${failure.reason}`);
  return summary;
}

export function createDestinationFromConfig(config, overrides = {}) {
  return createGcsBackupStore({
    bucket: config.gcsBucket,
    getAccessToken: createGcloudTokenProvider({ impersonateServiceAccount: config.impersonateServiceAccount }),
    ...overrides,
  });
}

async function main() {
  const config = readBackupConfig();
  const summary = await runFileBackup({
    source: createSupabaseStorage(),
    dest: createDestinationFromConfig(config),
    config,
  });
  if (config.summaryPath) {
    await writeFile(config.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  }
  if (summary.status !== "complete") {
    console.error(`[backup] run ${summary.runId} is ${summary.status}; see failures above.`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`FILE BACKUP FAILED: ${String(error?.message ?? error).slice(0, 500)}`);
    process.exit(1);
  });
}
