import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { acquireCodegenLock, cleanupStrayDirs, replaceFilesAtomically } from "./codegen.mjs";

const tempRoots = [];
const stagingDirName = `__codegen_staging_${process.pid}`;

function makeParent() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codegen-concurrency-"));
  const parent = path.join(root, "src");
  mkdirSync(parent, { recursive: true });
  tempRoots.push(root);
  return parent;
}

function writeFile(abs, contents = "export const value = 1;\n") {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup keeps recent foreign staging dirs for concurrent codegen", () => {
  const parent = makeParent();
  const nowMs = 1_700_000_000_000;
  const recentForeign = path.join(parent, "__codegen_staging_12345");
  const oldForeign = path.join(parent, "__codegen_staging_67890");
  const current = path.join(parent, stagingDirName);

  mkdirSync(recentForeign);
  mkdirSync(oldForeign);
  mkdirSync(current);
  utimesSync(recentForeign, new Date(nowMs - 10_000), new Date(nowMs - 10_000));
  utimesSync(oldForeign, new Date(nowMs - 120_000), new Date(nowMs - 120_000));
  utimesSync(current, new Date(nowMs - 120_000), new Date(nowMs - 120_000));

  cleanupStrayDirs({ parents: [parent], minAgeMs: 60_000, nowMs });

  assert.equal(existsSync(recentForeign), true, "recent foreign staging must survive cleanup");
  assert.equal(existsSync(oldForeign), false, "old foreign staging should be cleaned up");
  assert.equal(existsSync(current), true, "the current process staging is not removed by stray cleanup");
});

test("cleanup keeps staging dirs owned by a live process even with zero age grace", async () => {
  const parent = makeParent();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
    stdio: "ignore",
  });
  assert.ok(child.pid, "child process must have a pid");
  const liveForeign = path.join(parent, `__codegen_staging_${child.pid}`);

  try {
    mkdirSync(liveForeign);
    cleanupStrayDirs({ parents: [parent], minAgeMs: 0 });
    assert.equal(existsSync(liveForeign), true, "live foreign staging must survive cleanup");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

test("codegen lock serializes concurrent runs", () => {
  const parent = makeParent();
  const lockDir = path.join(parent, ".codegen.lock");
  const release = acquireCodegenLock({
    lockDir,
    waitMs: 0,
    staleMs: 60_000,
    nowMs: () => 1_000,
  });

  try {
    assert.equal(existsSync(lockDir), true, "lock directory should exist while held");
    assert.throws(
      () =>
        acquireCodegenLock({
          lockDir,
          waitMs: 0,
          staleMs: 60_000,
          retryDelayMs: 0,
          nowMs: () => 1_000,
        }),
      /Another API codegen run is still active/,
    );
  } finally {
    release();
  }

  assert.equal(existsSync(lockDir), false, "lock directory should be removed after release");
});

test("stale generated files remain readable until the grace period expires", () => {
  const parent = makeParent();
  const real = path.join(parent, "generated");
  const oldFile = path.join(real, "old-only.ts");
  const newFile = path.join(real, "new-only.ts");
  const manifest = path.join(parent, ".codegen-stale-files.json");

  writeFile(oldFile, "export const oldOnly = true;\n");
  writeFile(path.join(parent, stagingDirName, "new-only.ts"), "export const newOnly = true;\n");

  replaceFilesAtomically(parent, { nowMs: 1_000, staleGraceMs: 60_000 });

  assert.equal(existsSync(oldFile), true, "stale file should remain during grace period");
  assert.equal(readFileSync(oldFile, "utf8"), "export const oldOnly = true;\n");
  assert.equal(existsSync(newFile), true, "new generated file should be moved into place");
  assert.deepEqual(JSON.parse(readFileSync(manifest, "utf8")), {
    files: {
      "old-only.ts": 1_000,
    },
  });

  writeFile(path.join(parent, stagingDirName, "new-only.ts"), "export const newOnly = true;\n");
  replaceFilesAtomically(parent, { nowMs: 61_001, staleGraceMs: 60_000 });

  assert.equal(existsSync(oldFile), false, "stale file should be removed after grace period");
  assert.equal(existsSync(manifest), false, "stale manifest should be removed once it is empty");
});
