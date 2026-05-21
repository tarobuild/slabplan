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
// To eliminate that race we serialize codegen with the local build/typecheck
// scripts that read generated API files, and then publish fully-written files:
//   1. Tell orval (via CODEGEN_OUTPUT_DIR) to emit into a unique staging
//      directory next to `generated/` (e.g. `__codegen_staging_<pid>/`).
//   2. Run post-codegen against that staging dir.
//   3. Normalize the workspace's `index.ts` so it points at `./generated/`
//      (orval auto-appends `export *` lines that reference whatever
//      CODEGEN_OUTPUT_DIR was set to). Done before the file moves, so the
//      index.ts always points at a directory that exists with valid files
//      (the previous `generated/` contents until the swap completes).
//   4. While holding the same lock used by local build/typecheck scripts,
//      replace each file in `generated/` with its staging counterpart using
//      atomic per-file `rename`s. Each individual file replacement is atomic
//      on POSIX, and the shared lock keeps normal concurrent readers from
//      observing a mixed generated tree.
//   5. Delete any files that exist in the previous `generated/` but not in
//      the new staging output (stale removal).
//   6. Remove the now-empty staging dir.
//
// On failure we attempt to clean up any leftover staging dirs so the tree
// isn't left in a weird state. Files already moved into `generated/` are
// left in place (they are by definition fully-written, valid generated
// files; rolling them back individually would risk a worse state).

import { spawnSync } from "node:child_process";
import {
  existsSync,
  closeSync,
  mkdirSync,
  linkSync,
  openSync,
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

const REAL_DIR_NAME = "generated";
const LOCK_FILE = path.join(apiSpecDir, ".codegen.lock");
// Avoid dots in the staging dir names: orval's `clean: true` setting expands
// the output target through a glob matcher, and a dot in the path makes it
// match (and delete) sibling files like `custom-fetch.ts` or `index.ts` under
// the workspace dir.
const STAGING_PREFIX = "__codegen_staging_";
// Legacy prefix we used to use for the displaced previous `generated/` dir
// during the old swap-the-whole-directory approach. Kept here so we still
// clean any stale leftovers from prior runs (or downgraded checkouts).
const OLD_PREFIX = "__codegen_old_";
const INCOMPLETE_LOCK_GRACE_MS = 5_000;
const LOCK_WAIT_TIMEOUT_MS = 5 * 60_000;
const LOCK_WAIT_POLL_MS = 250;

const stagingDirName = `${STAGING_PREFIX}${process.pid}`;
let lockFd = null;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireCodegenLock() {
  const startedAt = Date.now();
  for (;;) {
    try {
      lockFd = openSync(LOCK_FILE, "wx");
      writeFileSync(lockFd, `${process.pid}\n`, "utf8");
      return;
    } catch (err) {
      if (!err || err.code !== "EEXIST") {
        throw err;
      }
    }

    let existingContents = "";
    let existingPid = NaN;
    let lockAgeMs = 0;
    try {
      lockAgeMs = Date.now() - statSync(LOCK_FILE).mtimeMs;
      existingContents = readFileSync(LOCK_FILE, "utf8");
      existingPid = Number.parseInt(existingContents, 10);
    } catch {
      existingPid = NaN;
    }

    if (!Number.isInteger(existingPid) && lockAgeMs < INCOMPLETE_LOCK_GRACE_MS) {
      if (Date.now() - startedAt > LOCK_WAIT_TIMEOUT_MS) {
        throw new Error("Timed out waiting for the API codegen lock to initialize.");
      }
      sleepSync(LOCK_WAIT_POLL_MS);
      continue;
    }

    if (isProcessAlive(existingPid)) {
      if (Date.now() - startedAt > LOCK_WAIT_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for API generated files lock held by pid ${existingPid}.`,
        );
      }
      sleepSync(LOCK_WAIT_POLL_MS);
      continue;
    }

    const claimedStaleLock = `${LOCK_FILE}.stale-${process.pid}-${Date.now()}`;
    try {
      linkSync(LOCK_FILE, claimedStaleLock);
      const claimedContents = readFileSync(claimedStaleLock, "utf8");
      const claimedPid = Number.parseInt(claimedContents, 10);
      if (claimedContents !== existingContents || isProcessAlive(claimedPid)) {
        rmSync(claimedStaleLock, { force: true });
        continue;
      }
      unlinkSync(LOCK_FILE);
      rmSync(claimedStaleLock, { force: true });
    } catch (err) {
      if (err && err.code === "ENOENT") {
        continue;
      }
      throw err;
    }
  }
}

function releaseCodegenLock() {
  if (lockFd != null) {
    try {
      closeSync(lockFd);
    } catch {
      // best effort
    }
    lockFd = null;
  }

  try {
    const existingPid = Number.parseInt(readFileSync(LOCK_FILE, "utf8"), 10);
    if (existingPid === process.pid) {
      rmSync(LOCK_FILE, { force: true });
    }
  } catch {
    // best effort
  }
}

function cleanupStrayDirs() {
  // Remove any leftover staging/old dirs from prior failed runs (or this run).
  for (const parent of TARGET_PARENTS) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (
        entry.name.startsWith(STAGING_PREFIX) ||
        entry.name.startsWith(OLD_PREFIX)
      ) {
        rmSync(path.join(parent, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }
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
  const stagingRefPattern = new RegExp(`\\./${STAGING_PREFIX}\\d+/`, "g");
  const rewritten = original.replace(stagingRefPattern, `./${REAL_DIR_NAME}/`);
  // Dedupe only `export *` lines (the kind orval auto-appends). Arbitrary
  // duplicate-looking lines like `} from "./custom-fetch";` (closing brace of
  // an `export type {…}` block that also appears for an `export {…}` block)
  // must NOT be dropped.
  const seenWildcardExports = new Set();
  const isWildcardExport = (line) =>
    /^\s*export\s+\*\s+from\s+["'][^"']+["']\s*;?\s*$/.test(line);
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

function replaceFilesAtomically(parent) {
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
    throw new Error(`Codegen did not produce expected staging dir: ${staging}`);
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

  // Remove stale files (present in the previous `generated/` but not in the
  // newly generated set). Done after all moves so we never temporarily
  // remove a file that the new set also produces.
  for (const relPath of realFilesBefore) {
    if (movedRelPaths.has(relPath)) continue;
    const stale = path.join(real, relPath);
    try {
      unlinkSync(stale);
    } catch {
      // Best-effort: file may have been removed by another process.
    }
    removeEmptyDirs(path.dirname(stale), real);
  }

  // Clean up the (now empty) staging dir tree.
  rmSync(staging, { recursive: true, force: true });
}

try {
  acquireCodegenLock();
  // Best-effort cleanup before we start so a previous crashed run doesn't leave
  // a stale staging dir under the same pid (very unlikely, but cheap to do).
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
  // Remove any leftover staging dirs so the tree isn't dirty.
  if (lockFd != null) {
    cleanupStrayDirs();
  }
  process.exit(1);
} finally {
  releaseCodegenLock();
}
