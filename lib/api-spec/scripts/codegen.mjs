#!/usr/bin/env node
// Atomic codegen wrapper.
//
// Why this exists: orval emits a tree of generated files one-by-one into the
// real `lib/api-{client-react,zod}/src/generated/` directories. While codegen
// is in flight, any concurrent reader (vite build, esbuild bundle, tsc) can
// observe a half-written file or a momentarily-missing file and fail with
// confusing errors like "ApiError is not exported by
// ../../lib/api-client-react/src/index.ts" or TS6053
// ("File 'lib/.../generated/api.ts' not found").
//
// To eliminate that race we:
//   1. Tell orval (via CODEGEN_OUTPUT_DIR) to emit into a unique staging
//      directory next to `generated/` (e.g. `__codegen_staging_<pid>/`).
//   2. Run post-codegen against that staging dir.
//   3. Normalize the workspace's `index.ts` so it points at `./generated/`
//      (orval auto-appends `export *` lines that reference whatever
//      CODEGEN_OUTPUT_DIR was set to). Done before the file moves, so the
//      index.ts always points at a directory that exists with valid files
//      (the previous `generated/` contents until the swap completes).
//   4. Replace each file in `generated/` with its staging counterpart using
//      atomic per-file `rename`s. Each individual file replacement is atomic
//      on POSIX, so a concurrent reader can always open
//      `generated/<file>` and get *some* fully-written valid version
//      (either the previous one or the freshly generated one). The window
//      where the directory entry doesn't exist — the previous failure mode
//      with the rename-the-whole-directory approach — is gone entirely.
//   5. Mark files that exist in the previous `generated/` but not in the new
//      staging output as stale. We keep them in place for a grace period before
//      deleting them, so a concurrent reader that resolved an old export graph
//      can still open every referenced file.
//   6. Remove the now-empty staging dir.
//
// On failure we attempt to clean up any leftover staging dirs so the tree
// isn't left in a weird state. Files already moved into `generated/` are
// left in place (they are by definition fully-written, valid generated
// files; rolling them back individually would risk a worse state).

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSpecDir = path.resolve(here, "..");
const root = path.resolve(apiSpecDir, "..", "..");

const TARGET_PARENTS = [
  path.resolve(root, "lib", "api-client-react", "src"),
  path.resolve(root, "lib", "api-zod", "src"),
];

const CODEGEN_LOCK_DIR = path.join(apiSpecDir, ".codegen.lock");
const REAL_DIR_NAME = "generated";
const STALE_MANIFEST_NAME = ".codegen-stale-files.json";
// Avoid dots in the staging dir names: orval's `clean: true` setting expands
// the output target through a glob matcher, and a dot in the path makes it
// match (and delete) sibling files like `custom-fetch.ts` or `index.ts` under
// the workspace dir.
const STAGING_PREFIX = "__codegen_staging_";
// Legacy prefix we used to use for the displaced previous `generated/` dir
// during the old swap-the-whole-directory approach. Kept here so we still
// clean any stale leftovers from prior runs (or downgraded checkouts).
const OLD_PREFIX = "__codegen_old_";

const stagingDirName = `${STAGING_PREFIX}${process.pid}`;

function parseDurationEnv(name, fallbackMs) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer number of milliseconds`);
  }
  return parsed;
}

const CLEANUP_STRAY_MIN_AGE_MS = parseDurationEnv(
  "CODEGEN_CLEANUP_STRAY_MIN_AGE_MS",
  60 * 60 * 1000,
);
const STALE_DELETE_GRACE_MS = parseDurationEnv(
  "CODEGEN_STALE_DELETE_GRACE_MS",
  60 * 60 * 1000,
);
const CODEGEN_LOCK_WAIT_MS = parseDurationEnv(
  "CODEGEN_LOCK_WAIT_MS",
  10 * 60 * 1000,
);
const CODEGEN_LOCK_STALE_MS = parseDurationEnv(
  "CODEGEN_LOCK_STALE_MS",
  30 * 60 * 1000,
);

function isOldEnough(abs, minAgeMs, nowMs) {
  if (minAgeMs === 0) return true;
  try {
    return nowMs - statSync(abs).mtimeMs >= minAgeMs;
  } catch {
    return false;
  }
}

function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidFromStagingDirName(name) {
  if (!name.startsWith(STAGING_PREFIX)) return null;
  const raw = name.slice(STAGING_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  const pid = Number.parseInt(raw, 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err && typeof err === "object" && "code" in err && err.code === "EPERM");
  }
}

function stagingDirHasLiveOwner(name) {
  const pid = pidFromStagingDirName(name);
  return pid != null && isPidAlive(pid);
}

function lockHasLiveOwner(lockDir) {
  try {
    const metadata = JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    return typeof metadata.pid === "number" && isPidAlive(metadata.pid);
  } catch {
    return false;
  }
}

function lockIsStale(lockDir, staleMs, nowMs) {
  if (lockHasLiveOwner(lockDir)) return false;
  return isOldEnough(lockDir, staleMs, nowMs);
}

export function acquireCodegenLock({
  lockDir = CODEGEN_LOCK_DIR,
  waitMs = CODEGEN_LOCK_WAIT_MS,
  staleMs = CODEGEN_LOCK_STALE_MS,
  retryDelayMs = 250,
  nowMs = () => Date.now(),
} = {}) {
  const deadline = nowMs() + waitMs;

  while (true) {
    try {
      mkdirSync(lockDir);
      writeFileSync(
        path.join(lockDir, "owner.json"),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date(nowMs()).toISOString() }, null, 2)}\n`,
        "utf8",
      );
      return () => {
        rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (err) {
      if (!err || typeof err !== "object" || !("code" in err) || err.code !== "EEXIST") {
        throw err;
      }

      const currentNow = nowMs();
      if (lockIsStale(lockDir, staleMs, currentNow)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (currentNow >= deadline) {
        throw new Error(`Another API codegen run is still active at ${lockDir}`);
      }
      sleepSync(Math.min(retryDelayMs, Math.max(1, deadline - currentNow)));
    }
  }
}

export function cleanupStrayDirs({
  parents = TARGET_PARENTS,
  includeCurrent = false,
  minAgeMs = CLEANUP_STRAY_MIN_AGE_MS,
  nowMs = Date.now(),
} = {}) {
  // Remove any leftover staging/old dirs from prior failed runs (or this run).
  // Recent foreign staging dirs may belong to a concurrent codegen process, so
  // only old leftovers are eligible for cross-run cleanup.
  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (
        entry.name.startsWith(STAGING_PREFIX) ||
        entry.name.startsWith(OLD_PREFIX)
      ) {
        if (!includeCurrent && entry.name === stagingDirName) continue;
        if (entry.name.startsWith(STAGING_PREFIX) && stagingDirHasLiveOwner(entry.name)) continue;
        const abs = path.join(parent, entry.name);
        if (!isOldEnough(abs, minAgeMs, nowMs)) continue;
        rmSync(abs, {
          recursive: true,
          force: true,
        });
      }
    }
  }
}

function cleanupCurrentStagingDirs({ parents = TARGET_PARENTS } = {}) {
  for (const parent of parents) {
    rmSync(path.join(parent, stagingDirName), {
      recursive: true,
      force: true,
    });
  }
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: apiSpecDir,
    stdio: "inherit",
    env: { ...process.env, CODEGEN_OUTPUT_DIR: stagingDirName },
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`,
    );
  }
}

function normalizeIndexTs(parent) {
  // orval auto-edits the workspace's `index.ts` to add `export *` lines for
  // the generated client, using whatever output dir we passed it. Rewrite
  // those references to point at `./generated/` again so the index.ts stays
  // valid regardless of whether `generated/` currently holds the old or the
  // new files. We also dedupe identical `export *` lines that orval may have
  // appended on top of pre-existing ones from a prior run.
  //
  // Rewrite refs to ANY `__codegen_staging_*` dir (not just the current pid's
  // dir). This way, if a prior codegen process died — or several piled up in
  // parallel and each appended their own staging refs — we still scrub all of
  // them out instead of leaving stale broken imports behind for tsc to choke
  // on.
  const indexFile = path.join(parent, "index.ts");
  if (!existsSync(indexFile)) return;
  const original = readFileSync(indexFile, "utf8");
  const stagingRefPattern = new RegExp(
    `\\./${STAGING_PREFIX}\\d+/`,
    "g",
  );
  let rewritten = original.replace(stagingRefPattern, `./${REAL_DIR_NAME}/`);
  if (parent === path.resolve(root, "lib", "api-zod", "src")) {
    rewritten = rewritten
      .replace(
        /^\s*export\s+\*\s+from\s+["']\.\/generated\/api["'];?\s*$/gm,
        `export * from "./generated/api.js";`,
      )
      .replace(
        /^\s*export\s+\*\s+from\s+["']\.\/generated\/types["'];?\s*$/gm,
        `export type * from "./generated/types/index.js";`,
      )
      .replace(
        /^\s*export\s+\*\s+from\s+["']\.\/uploads["'];?\s*$/gm,
        `export * from "./uploads.js";`,
      );
  }
  // Dedupe only `export *` lines (the kind orval auto-appends). Arbitrary
  // duplicate-looking lines like `} from "./custom-fetch";` (closing brace of
  // an `export type {…}` block that also appears for an `export {…}` block)
  // must NOT be dropped.
  const seenWildcardExports = new Set();
  const isWildcardExport = (line) => /^\s*export\s+(?:type\s+)?\*\s+from\s+["'][^"']+["']\s*;?\s*$/.test(line);
  const deduped = rewritten
    .split("\n")
    .filter((line) => {
      if (!isWildcardExport(line)) return true;
      const trimmed = line.trim();
      if (seenWildcardExports.has(trimmed)) return false;
      seenWildcardExports.add(trimmed);
      return true;
    })
    .join("\n");
  if (deduped !== original) {
    // Write atomically: write the new content to a sibling temp file and
    // rename it over `index.ts`. POSIX `rename` of a regular file over
    // another regular file is atomic — a concurrent reader (e.g. `tsc`)
    // sees either the full old content or the full new content, never an
    // intermediate zero-byte file (which `writeFileSync`'s truncate-then-
    // write behavior would briefly produce, manifesting as TS2306 "File ...
    // is not a module").
    const tmpFile = `${indexFile}.codegen-tmp-${process.pid}`;
    writeFileSync(tmpFile, deduped, "utf8");
    renameSync(tmpFile, indexFile);
  }
}

function* walkFiles(dir, baseRel = "") {
  // Yields { relPath, abs } for every regular file under `dir`, recursively.
  // `relPath` uses POSIX separators so it can be used as a key for
  // cross-tree comparisons.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walkFiles(abs, rel);
    } else if (entry.isFile()) {
      yield { relPath: rel, abs };
    }
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function removeEmptyDirs(dir, stopAt) {
  // Walk up from `dir`, removing any empty directories we created, until we
  // hit `stopAt` (exclusive) or a non-empty directory.
  let current = dir;
  while (current !== stopAt && current.startsWith(stopAt + path.sep)) {
    try {
      const entries = readdirSync(current);
      if (entries.length > 0) return;
      rmSync(current, { recursive: false, force: true });
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function readStaleManifest(parent) {
  const manifestPath = path.join(parent, STALE_MANIFEST_NAME);
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    const entries = Object.entries(parsed.files ?? {});
    return new Map(
      entries
        .filter((entry) => typeof entry[0] === "string" && typeof entry[1] === "number")
        .map(([relPath, firstSeenAt]) => [relPath, firstSeenAt]),
    );
  } catch {
    return new Map();
  }
}

function writeStaleManifest(parent, staleFiles) {
  const manifestPath = path.join(parent, STALE_MANIFEST_NAME);
  if (staleFiles.size === 0) {
    try {
      unlinkSync(manifestPath);
    } catch {
      // Missing manifest is already the desired state.
    }
    return;
  }

  const files = Object.fromEntries([...staleFiles.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const tmpFile = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(
    tmpFile,
    `${JSON.stringify({ files }, null, 2)}\n`,
    "utf8",
  );
  renameSync(tmpFile, manifestPath);
}

function retireStaleFiles(parent, real, realFilesBefore, movedRelPaths, { nowMs, staleGraceMs }) {
  const previousStaleFiles = readStaleManifest(parent);
  const nextStaleFiles = new Map();

  for (const relPath of realFilesBefore) {
    if (movedRelPaths.has(relPath)) continue;
    const firstSeenAt = previousStaleFiles.get(relPath) ?? nowMs;
    const stale = path.join(real, relPath);

    if (nowMs - firstSeenAt >= staleGraceMs) {
      try {
        unlinkSync(stale);
      } catch {
        // Best-effort: file may have been removed by another process.
      }
      removeEmptyDirs(path.dirname(stale), real);
      continue;
    }

    nextStaleFiles.set(relPath, firstSeenAt);
  }

  writeStaleManifest(parent, nextStaleFiles);
}

export function replaceFilesAtomically(
  parent,
  { nowMs = Date.now(), staleGraceMs = STALE_DELETE_GRACE_MS } = {},
) {
  // Replace files under `parent/generated/` with the freshly-generated files
  // under `parent/<stagingDirName>/`, using atomic per-file renames. Stale
  // files (present in the old `generated/` but not in the new staging output)
  // are removed at the end. The `generated/` directory entry is never
  // missing — at every instant during this function it contains a complete
  // set of valid files, either the previous version, the new version, or a
  // mix where every individual file is itself fully written.
  const real = path.join(parent, REAL_DIR_NAME);
  const staging = path.join(parent, stagingDirName);

  if (!existsSync(staging)) {
    throw new Error(
      `Codegen did not produce expected staging dir: ${staging}`,
    );
  }

  ensureDir(real);

  // Snapshot the set of files in `real` *before* we start moving things in,
  // so we can compute which files are stale (present-old, absent-new).
  const realFilesBefore = new Set();
  for (const { relPath } of walkFiles(real)) {
    realFilesBefore.add(relPath);
  }

  // Snapshot + move every staging file into `real`. We collect the list of
  // staging paths first so we don't trip over our own renames mid-iteration.
  const stagingFiles = Array.from(walkFiles(staging));
  const movedRelPaths = new Set();
  for (const { relPath, abs } of stagingFiles) {
    const targetAbs = path.join(real, relPath);
    ensureDir(path.dirname(targetAbs));
    // POSIX `rename` over an existing path is atomic: a concurrent reader
    // either sees the old inode (fully-written previous version) or the new
    // inode (fully-written new version), never a partially-written file and
    // never a missing entry.
    renameSync(abs, targetAbs);
    movedRelPaths.add(relPath);
  }

  // Stale files are retired only after a grace period. Immediate deletion can
  // break concurrent readers that resolved an old index before this codegen
  // pass completed.
  retireStaleFiles(parent, real, realFilesBefore, movedRelPaths, {
    nowMs,
    staleGraceMs,
  });

  // Clean up the (now empty) staging dir tree.
  rmSync(staging, { recursive: true, force: true });
}

export function main() {
  let releaseLock;
  let exitCode = 0;
  try {
    releaseLock = acquireCodegenLock();
    // Best-effort cleanup before we start so old crashed runs do not accumulate.
    cleanupStrayDirs();

    // `orval` is resolved via the local node_modules/.bin (pnpm puts it on PATH
    // when this script is invoked through `pnpm run`).
    run("orval", ["--config", "./orval.config.ts"]);
    run("node", ["./scripts/post-codegen.mjs"]);

    for (const parent of TARGET_PARENTS) {
      // Order matters: normalize index.ts FIRST (rewriting any
      // `./__codegen_staging_<pid>/...` lines orval added back to
      // `./generated/...`). At this point `./generated/` still holds the
      // previous run's files, which are valid TypeScript modules, so the
      // workspace remains compilable. Then atomically replace the files
      // inside `./generated/` one-by-one.
      normalizeIndexTs(parent);
      replaceFilesAtomically(parent);
    }
  } catch (err) {
    console.error("[codegen] Failed:", err instanceof Error ? err.message : err);
    // Remove only this run's staging dirs immediately. Foreign staging dirs
    // are left to the age-aware cleanup path so concurrent codegen survives.
    cleanupCurrentStagingDirs();
    cleanupStrayDirs();
    exitCode = 1;
  } finally {
    releaseLock?.();
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
