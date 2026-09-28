#!/usr/bin/env node
/**
 * Verify, restore and prune SlabPlan's independent private-file backups.
 *
 *   verify  --run latest|<runId> [--sample N] [--organization <id>] [--compare-source]
 *   restore --run latest|<runId> (--organization <id> | --all) --to-dir <path>
 *   restore --run latest|<runId> (--organization <id> | --all) --to-supabase [--allow-primary-target]
 *   db-dump --run latest|<runId> --to <path>
 *   check-db-files --run latest|<runId> --files-csv <path>
 *   summary --run latest|<runId>   (operator terminal only; prints private counts)
 *   prune   [--keep-days 90] [--keep-runs 14] [--apply]
 *
 * Every restored object is decrypted, authenticated and SHA-256 checked
 * against the run manifest before it is kept. Restores never overwrite
 * existing files or objects. Output contains counts and blob labels only.
 *
 * Env: FILE_BACKUP_GCS_BUCKET, FILE_BACKUP_ENCRYPTION_KEY and optional
 * FILE_BACKUP_EXPECTED_KEY_ID / FILE_BACKUP_DEST_ROOT /
 * GCS_IMPERSONATE_SERVICE_ACCOUNT. --compare-source uses SUPABASE_URL,
 * SUPABASE_STORAGE_BUCKET and SUPABASE_SERVICE_ROLE_KEY. --to-supabase uses
 * RESTORE_TARGET_SUPABASE_URL, RESTORE_TARGET_SUPABASE_STORAGE_BUCKET and
 * RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY.
 *
 * Documented in docs/private-file-backup-runbook.md.
 */
import { randomBytes, randomInt } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, lstat, mkdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  backupKeyIdHex,
  createBackupDecryptStream,
  createDigestPassThrough,
  parseBackupMasterKey,
} from "./lib/backup-crypto.mjs";
import {
  backupPaths,
  listRunIds,
  loadRunSummary,
  normalizeBackupRoot,
  readManifestEntries,
  resolveRun,
} from "./lib/file-backup-manifest.mjs";
import { createGcloudTokenProvider, createGcsBackupStore } from "./lib/gcs-backup-store.mjs";
import { createSupabaseStorage, getRequiredEnv } from "./lib/supabase-storage.mjs";

const ORGANIZATION_ID_PATTERN = /^[0-9A-Za-z-]{1,64}$/;

export function readRestoreConfig(env = process.env) {
  const masterKey = parseBackupMasterKey(getRequiredEnv("FILE_BACKUP_ENCRYPTION_KEY", env));
  const keyId = backupKeyIdHex(masterKey);
  const expectedKeyId = env.FILE_BACKUP_EXPECTED_KEY_ID?.trim();
  if (expectedKeyId && expectedKeyId.toLowerCase() !== keyId) {
    throw new Error(`Configured key id ${keyId} does not match FILE_BACKUP_EXPECTED_KEY_ID ${expectedKeyId}.`);
  }
  return {
    masterKey,
    keyId,
    gcsBucket: getRequiredEnv("FILE_BACKUP_GCS_BUCKET", env),
    root: normalizeBackupRoot(env.FILE_BACKUP_DEST_ROOT?.trim() || undefined),
    impersonateServiceAccount: env.GCS_IMPERSONATE_SERVICE_ACCOUNT?.trim() || "",
  };
}

function label(entry) {
  return `blob:${entry.blobDigest.slice(0, 12)}`;
}

/** Collect manifest entries matching a scope. */
export async function selectEntries({ dest, root, masterKey, run, organizationId = null, all = false, category = null }) {
  if (organizationId !== null && !ORGANIZATION_ID_PATTERN.test(organizationId)) {
    throw new Error("Organization id contains unsupported characters.");
  }
  if (!all && organizationId === null && category === null) {
    throw new Error("Choose --organization <id> or --all.");
  }
  const selected = [];
  for await (const entry of readManifestEntries({ dest, root, runId: run.runId, masterKey })) {
    if (category && entry.category !== category) continue;
    if (organizationId !== null) {
      // Require both the recorded tenant and the tenant path prefix.
      const prefix = `slabplan/uploads/organizations/${organizationId}/`;
      if (entry.organizationId !== organizationId || !entry.name.startsWith(prefix)) continue;
    }
    selected.push(entry);
  }
  return selected;
}

function sampleEntries(entries, sample) {
  if (!sample || sample >= entries.length) return entries;
  const pool = [...entries];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, sample);
}

/**
 * Stream a decrypted blob. `done` rejects if authentication fails; the
 * digest is final only after `done` resolves.
 */
async function openDecrypted({ dest, root, masterKey, entry }) {
  const plain = new PassThrough();
  const digest = createDigestPassThrough();
  const done = pipeline(
    await dest.downloadStream(backupPaths.blob(root, entry.blobDigest)),
    createBackupDecryptStream(masterKey),
    digest.stream,
    plain,
  );
  return { stream: plain, digest: digest.result, done };
}

function assertMatches(entry, digest) {
  if (digest.bytes !== entry.size || digest.sha256Hex !== entry.sha256) {
    throw new Error(`Restored bytes do not match the manifest (size ${digest.bytes}/${entry.size}).`);
  }
}

async function hashStream(stream) {
  const digest = createDigestPassThrough();
  const sink = new PassThrough();
  sink.resume();
  await pipeline(stream, digest.stream, sink);
  return digest.result;
}

/** Decrypt and hash-check entries without writing plaintext anywhere. */
export async function verifyEntries({ dest, root, masterKey, entries, source = null, log = console.log }) {
  const result = { checked: 0, matched: 0, failed: 0, sourceCompared: 0, sourceMatched: 0, sourceChanged: 0, sourceMissing: 0, bytes: 0, failures: [] };
  for (const entry of entries) {
    result.checked += 1;
    try {
      const opened = await openDecrypted({ dest, root, masterKey, entry });
      opened.stream.resume();
      await opened.done;
      assertMatches(entry, opened.digest);
      result.matched += 1;
      result.bytes += entry.size;
      if (source) {
        result.sourceCompared += 1;
        const info = await source.getObjectInfo(entry.name);
        if (!info) {
          result.sourceMissing += 1;
        } else {
          const current = await hashStream(await source.downloadStream(entry.name));
          if (current.sha256Hex === entry.sha256 && current.bytes === entry.size) result.sourceMatched += 1;
          else result.sourceChanged += 1;
        }
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({ label: label(entry), reason: String(error?.message ?? error).split(entry.name).join(label(entry)).slice(0, 300) });
    }
  }
  log(`[verify] checked=${result.checked} matched=${result.matched} failed=${result.failed}${source ? ` sourceMatched=${result.sourceMatched} sourceChanged=${result.sourceChanged} sourceMissing=${result.sourceMissing}` : ""}`);
  for (const failure of result.failures.slice(0, 20)) log(`[verify] failure ${failure.label}: ${failure.reason}`);
  return result;
}

/** Resolve an object name under a restore directory, rejecting traversal. */
export function safeRestorePath(outDir, objectName) {
  const segments = objectName.split("/");
  if (
    !objectName ||
    objectName.startsWith("/") ||
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\0") || segment.includes("\\"))
  ) {
    throw new Error("Manifest entry has an unsafe object name.");
  }
  const root = path.resolve(outDir);
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Manifest entry escapes the restore directory.");
  return target;
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Restore to a local directory; files are kept only after hash verification. */
export async function restoreToDirectory({ dest, root, masterKey, entries, outDir, log = console.log }) {
  const result = { restored: 0, failed: 0, skippedExisting: 0, bytes: 0, failures: [] };
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    let temporary = null;
    try {
      const target = safeRestorePath(outDir, entry.name);
      if (await exists(target)) {
        result.skippedExisting += 1;
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      temporary = `${target}.restore-${randomBytes(6).toString("hex")}`;
      const opened = await openDecrypted({ dest, root, masterKey, entry });
      await Promise.all([
        pipeline(opened.stream, createWriteStream(temporary, { flags: "wx", mode: 0o600 })),
        opened.done,
      ]);
      assertMatches(entry, opened.digest);
      // link() fails if the target appeared meanwhile, so nothing is overwritten.
      await link(temporary, target);
      await unlink(temporary);
      temporary = null;
      result.restored += 1;
      result.bytes += entry.size;
    } catch (error) {
      result.failed += 1;
      result.failures.push({ label: label(entry), reason: String(error?.message ?? error).split(entry.name).join(label(entry)).slice(0, 300) });
    } finally {
      if (temporary) await rm(temporary, { force: true });
    }
  }
  log(`[restore] directory restored=${result.restored} skippedExisting=${result.skippedExisting} failed=${result.failed} bytes=${result.bytes}`);
  return result;
}

/**
 * Restore into a Supabase Storage bucket without overwriting. An object that
 * fails verification after upload is removed again.
 */
export async function restoreToStorage({ dest, root, masterKey, entries, target, log = console.log }) {
  const result = { restored: 0, failed: 0, skippedExisting: 0, bytes: 0, failures: [] };
  for (const entry of entries) {
    let uploaded = false;
    try {
      if (await target.objectExists(entry.name)) {
        result.skippedExisting += 1;
        continue;
      }
      const opened = await openDecrypted({ dest, root, masterKey, entry });
      await Promise.all([
        target.uploadStream(entry.name, opened.stream, {
          contentType: entry.contentType ?? "application/octet-stream",
          cacheControl: entry.cacheControl ?? undefined,
          contentLengthBytes: entry.size,
          upsert: false,
        }).then(() => {
          uploaded = true;
        }),
        opened.done,
      ]);
      assertMatches(entry, opened.digest);
      result.restored += 1;
      result.bytes += entry.size;
    } catch (error) {
      result.failed += 1;
      result.failures.push({ label: label(entry), reason: String(error?.message ?? error).split(entry.name).join(label(entry)).slice(0, 300) });
      if (uploaded) await target.deleteObject(entry.name).catch(() => {});
    }
  }
  log(`[restore] storage restored=${result.restored} skippedExisting=${result.skippedExisting} failed=${result.failed} bytes=${result.bytes}`);
  return result;
}

export function assertRestoreTargetAllowed({ sourceEnv, targetEnv, allowPrimaryTarget }) {
  const normalize = (value) => String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
  const sameProject = normalize(sourceEnv.SUPABASE_URL) && normalize(sourceEnv.SUPABASE_URL) === normalize(targetEnv.SUPABASE_URL);
  const sameBucket = String(sourceEnv.SUPABASE_STORAGE_BUCKET ?? "").trim() === String(targetEnv.SUPABASE_STORAGE_BUCKET ?? "").trim();
  if (sameProject && sameBucket && !allowPrimaryTarget) {
    throw new Error("Restore target is the primary bucket. Restore elsewhere, or pass --allow-primary-target during an approved incident.");
  }
}

/** Remove blobs no retained manifest references. Dry-run unless apply=true. */
export async function pruneBackups({ dest, root, masterKey, keepDays = 90, keepRuns = 14, apply = false, now = new Date(), log = console.log }) {
  const runIds = await listRunIds(dest, root);
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const runTime = (runId) => Date.parse(`${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T${runId.slice(9, 11)}:${runId.slice(11, 13)}:${runId.slice(13, 15)}Z`);
  const retained = runIds.filter((runId, index) => index >= runIds.length - keepRuns || runTime(runId) >= cutoff);
  const expired = runIds.filter((runId) => !retained.includes(runId));
  if (retained.length === 0) throw new Error("No retained runs; refusing to prune.");
  const referenced = new Set();
  for (const runId of retained) {
    const summary = await loadRunSummary(dest, root, runId);
    if (!summary.manifestObject) continue;
    for await (const entry of readManifestEntries({ dest, root, runId, masterKey })) referenced.add(entry.blobDigest);
  }
  const blobs = await dest.listObjects(backupPaths.blobPrefix(root));
  const orphaned = blobs.filter((blob) => {
    const digest = backupPaths.digestFromBlobName(root, blob.name);
    return digest && !referenced.has(digest) && Date.parse(blob.timeCreated ?? 0) < cutoff;
  });
  const plan = {
    runs: runIds.length,
    retainedRuns: retained.length,
    expiredRuns: expired.length,
    blobs: blobs.length,
    orphanedBlobs: orphaned.length,
    orphanedBytes: orphaned.reduce((sum, blob) => sum + blob.size, 0),
    applied: apply,
    deleted: 0,
    deleteFailures: 0,
  };
  if (apply) {
    const targets = [
      ...orphaned.map((blob) => ({ name: blob.name, generation: blob.generation })),
      ...expired.flatMap((runId) => [
        { name: backupPaths.manifest(root, runId) },
        { name: backupPaths.run(root, runId) },
      ]),
    ];
    for (const item of targets) {
      try {
        await dest.deleteObject(item.name, { generation: item.generation });
        plan.deleted += 1;
      } catch {
        plan.deleteFailures += 1; // e.g. bucket retention policy still applies
      }
    }
  }
  log(`[prune] ${JSON.stringify(plan)}`);
  return plan;
}

/**
 * Cross-check file rows from a restored database dump against a run
 * manifest: every live row must have a backed-up object, and a tenant-
 * prefixed object must belong to the row's organization. Rows are read from
 * `psql -At -F,` output: id,organization_id,file_url,file_size.
 */
export async function checkDatabaseFiles({ dest, root, masterKey, run, rows, log = console.log }) {
  const byName = new Map();
  for await (const entry of readManifestEntries({ dest, root, runId: run.runId, masterKey })) {
    byName.set(entry.name, { organizationId: entry.organizationId, size: entry.size });
  }
  const result = { rowsChecked: 0, present: 0, missing: 0, organizationMismatch: 0, sizeDiffers: 0, unprefixedLegacy: 0, invalidUrl: 0 };
  for (const row of rows) {
    result.rowsChecked += 1;
    const match = /^\/uploads\/(.+)$/.exec(row.fileUrl ?? "");
    if (!match || match[1].split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      result.invalidUrl += 1;
      continue;
    }
    const objectName = `slabplan/uploads/${match[1]}`;
    const entry = byName.get(objectName);
    if (!entry) {
      result.missing += 1;
      continue;
    }
    result.present += 1;
    if (entry.organizationId === null) result.unprefixedLegacy += 1;
    else if (entry.organizationId !== (row.organizationId || null)) result.organizationMismatch += 1;
    // Legacy multipart rows point at a small manifest object, so a size
    // difference is reported for review rather than treated as corruption.
    if (row.fileSize !== null && Number(row.fileSize) !== entry.size) result.sizeDiffers += 1;
  }
  // Failure counts only: total rows would disclose customer volume in public CI logs.
  log(`[check-db-files] missing=${result.missing} organizationMismatch=${result.organizationMismatch} invalidUrl=${result.invalidUrl} sizeDiffers=${result.sizeDiffers}`);
  return { ...result, failed: result.missing + result.organizationMismatch + result.invalidUrl };
}

export function parseFileRowsCsv(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [id, organizationId, ...rest] = line.split(",");
      const fileSize = rest.pop();
      return { id, organizationId: organizationId || null, fileUrl: rest.join(","), fileSize: fileSize === "" ? null : fileSize };
    });
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument ${arg}`);
    const key = arg.slice(2);
    if (["all", "compare-source", "to-supabase", "allow-primary-target", "apply"].includes(key)) {
      options[key] = true;
    } else {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value`);
      options[key] = value;
      i += 1;
    }
  }
  return { command, options };
}

function destinationFor(config) {
  return createGcsBackupStore({
    bucket: config.gcsBucket,
    getAccessToken: createGcloudTokenProvider({ impersonateServiceAccount: config.impersonateServiceAccount }),
  });
}

export async function runCommand({ command, options, config, dest, env = process.env, log = console.log, createStorage = createSupabaseStorage }) {
  const { masterKey, root } = config;
  if (command === "prune") {
    return await pruneBackups({
      dest,
      root,
      masterKey,
      keepDays: Number(options["keep-days"] ?? 90),
      keepRuns: Number(options["keep-runs"] ?? 14),
      apply: Boolean(options.apply),
      log,
    });
  }
  const run = await resolveRun(dest, root, options.run ?? "latest");
  if (!run) throw new Error("No backup run with a manifest was found.");
  if (command === "summary") {
    // Operator use only: the private summary includes counts and sizes.
    log(JSON.stringify(run, null, 2));
    return { runId: run.runId, failed: 0 };
  }
  if (run.keyId !== config.keyId) throw new Error(`Run ${run.runId} used key id ${run.keyId}; configured key id is ${config.keyId}.`);
  log(`[run] ${run.runId} status=${run.status}`);
  const organizationId = options.organization ?? null;

  if (command === "verify") {
    const scoped = await selectEntries({ dest, root, masterKey, run, organizationId, all: organizationId === null });
    const sample = options.sample ? Number(options.sample) : 0;
    const chosen = sampleEntries(scoped, sample);
    const source = options["compare-source"] ? createStorage(env) : null;
    const result = await verifyEntries({ dest, root, masterKey, entries: chosen, source, log });
    return { runId: run.runId, scope: organizationId ? "organization" : "all", ...result };
  }
  if (command === "restore") {
    const entries = await selectEntries({ dest, root, masterKey, run, organizationId, all: Boolean(options.all) });
    if (options["to-dir"]) {
      return { runId: run.runId, ...(await restoreToDirectory({ dest, root, masterKey, entries, outDir: options["to-dir"], log })) };
    }
    if (options["to-supabase"]) {
      const targetEnv = {
        SUPABASE_URL: getRequiredEnv("RESTORE_TARGET_SUPABASE_URL", env),
        SUPABASE_STORAGE_BUCKET: getRequiredEnv("RESTORE_TARGET_SUPABASE_STORAGE_BUCKET", env),
        SUPABASE_SERVICE_ROLE_KEY: getRequiredEnv("RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY", env),
      };
      assertRestoreTargetAllowed({ sourceEnv: env, targetEnv, allowPrimaryTarget: Boolean(options["allow-primary-target"]) });
      const target = createStorage(targetEnv);
      return { runId: run.runId, ...(await restoreToStorage({ dest, root, masterKey, entries, target, log })) };
    }
    throw new Error("Choose --to-dir <path> or --to-supabase.");
  }
  if (command === "db-dump") {
    if (!options.to) throw new Error("db-dump requires --to <path>.");
    const destination = path.resolve(options.to);
    if (await exists(destination)) throw new Error("db-dump --to path already exists; refusing to overwrite.");
    const entries = await selectEntries({ dest, root, masterKey, run, category: "database" });
    if (entries.length !== 1) throw new Error(`Run ${run.runId} has ${entries.length} database dumps.`);
    const staging = path.join(path.dirname(destination), `.db-dump-${randomBytes(6).toString("hex")}`);
    try {
      const result = await restoreToDirectory({ dest, root, masterKey, entries, outDir: staging, log });
      if (result.restored !== 1) throw new Error("Database dump restore failed verification.");
      await link(safeRestorePath(staging, entries[0].name), destination);
      return { runId: run.runId, dbDumpDate: /(\d{4}-\d{2}-\d{2})\.sql\.gz$/.exec(entries[0].name)?.[1] ?? null, sha256: entries[0].sha256, ...result };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  if (command === "check-db-files") {
    if (!options["files-csv"]) throw new Error("check-db-files requires --files-csv <path>.");
    const rows = parseFileRowsCsv(await readFile(options["files-csv"], "utf8"));
    return { runId: run.runId, ...(await checkDatabaseFiles({ dest, root, masterKey, run, rows, log })) };
  }
  throw new Error(`Unknown command ${command}. Use verify, restore, db-dump, check-db-files, summary or prune.`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const config = readRestoreConfig();
  const dest = destinationFor(config);
  const result = await runCommand({ command, options, config, dest });
  if (result.failed > 0 || result.deleteFailures > 0) process.exitCode = 1;
  if (result.checked === 0 && command === "verify") {
    console.error("[verify] no entries were selected");
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`FILE BACKUP RESTORE FAILED: ${String(error?.message ?? error).slice(0, 500)}`);
    process.exit(1);
  });
}
