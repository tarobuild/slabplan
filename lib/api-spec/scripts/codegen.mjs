#!/usr/bin/env node
// Atomic codegen wrapper.
//
// Why this exists: orval emits a tree of generated files one-by-one into the
// real `lib/api-{client-react,zod}/src/generated/` directories. While codegen
// is in flight, any concurrent reader (vite build, esbuild bundle, tsc) can
// observe a half-written file and fail with confusing errors like
// "ApiError is not exported by ../../lib/api-client-react/src/index.ts".
//
// To eliminate that race we:
//   1. Tell orval (via CODEGEN_OUTPUT_DIR) to emit into a unique staging
//      directory next to `generated/` (e.g. `generated.staging-<pid>/`).
//   2. Run post-codegen against that staging dir.
//   3. Atomically swap each staging dir into place using two consecutive
//      renames per location: `rename(real, real.old)` then
//      `rename(staging, real)`. The window where `real` doesn't exist is
//      sub-millisecond — orders of magnitude smaller than the multi-second
//      window of the previous in-place codegen.
//
// On failure we attempt to restore the previous `generated/` dir and clean up
// any leftover staging dirs so the tree isn't left in a weird state.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
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
// Avoid dots in the staging/old dir names: orval's `clean: true` setting
// expands the output target through a glob matcher, and a dot in the path
// makes it match (and delete) sibling files like `custom-fetch.ts` or
// `index.ts` under the workspace dir.
const STAGING_PREFIX = "__codegen_staging_";
const OLD_PREFIX = "__codegen_old_";

const stagingDirName = `${STAGING_PREFIX}${process.pid}`;

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
  // the generated client, using whatever output dir we passed it. After the
  // swap, those imports must point to `./generated/` again. We also dedupe
  // identical export lines that orval may have appended on top of pre-existing
  // ones from a prior run.
  const indexFile = path.join(parent, "index.ts");
  if (!existsSync(indexFile)) return;
  const original = readFileSync(indexFile, "utf8");
  const rewritten = original.replaceAll(
    `./${stagingDirName}/`,
    `./${REAL_DIR_NAME}/`,
  );
  // Dedupe only `export *` lines (the kind orval auto-appends). Arbitrary
  // duplicate-looking lines like `} from "./custom-fetch";` (closing brace of
  // an `export type {…}` block that also appears for an `export {…}` block)
  // must NOT be dropped.
  const seenWildcardExports = new Set();
  const isWildcardExport = (line) => /^\s*export\s+\*\s+from\s+["'][^"']+["']\s*;?\s*$/.test(line);
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
    writeFileSync(indexFile, deduped, "utf8");
  }
}

function atomicSwap(parent) {
  const real = path.join(parent, REAL_DIR_NAME);
  const staging = path.join(parent, stagingDirName);
  const old = path.join(parent, `${OLD_PREFIX}${process.pid}`);

  if (!existsSync(staging)) {
    throw new Error(
      `Codegen did not produce expected staging dir: ${staging}`,
    );
  }

  // Move existing real dir aside (if any), then move staging into place.
  // This is the smallest possible window where `real` doesn't exist.
  let movedReal = false;
  if (existsSync(real)) {
    renameSync(real, old);
    movedReal = true;
  }
  try {
    renameSync(staging, real);
  } catch (err) {
    // Restore the previous real dir if the second rename failed.
    if (movedReal && existsSync(old) && !existsSync(real)) {
      try {
        renameSync(old, real);
      } catch {
        // best-effort; surface the original error below
      }
    }
    throw err;
  }
  // Clean up the displaced previous dir.
  if (existsSync(old)) {
    rmSync(old, { recursive: true, force: true });
  }
}

// Best-effort cleanup before we start so a previous crashed run doesn't leave
// a stale staging dir under the same pid (very unlikely, but cheap to do).
cleanupStrayDirs();

try {
  // `orval` is resolved via the local node_modules/.bin (pnpm puts it on PATH
  // when this script is invoked through `pnpm run`).
  run("orval", ["--config", "./orval.config.ts"]);
  run("node", ["./scripts/post-codegen.mjs"]);

  for (const parent of TARGET_PARENTS) {
    atomicSwap(parent);
    normalizeIndexTs(parent);
  }
} catch (err) {
  console.error("[codegen] Failed:", err instanceof Error ? err.message : err);
  // Remove any leftover staging/old dirs so the tree isn't dirty.
  cleanupStrayDirs();
  process.exit(1);
}
