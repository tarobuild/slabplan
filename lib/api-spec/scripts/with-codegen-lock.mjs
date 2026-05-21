#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSpecDir = path.resolve(here, "..");
const lockFile = path.join(apiSpecDir, ".codegen.lock");
const incompleteLockGraceMs = 5_000;
const lockWaitTimeoutMs = Number.parseInt(
  process.env.API_CODEGEN_LOCK_WAIT_MS ?? `${5 * 60_000}`,
  10,
);
const lockWaitPollMs = 250;

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

function acquireLock() {
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockFile, "wx");
      writeFileSync(fd, `${process.pid}\n`, "utf8");
      return fd;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
    }

    let existingContents = "";
    let existingPid = NaN;
    let lockAgeMs = 0;
    try {
      lockAgeMs = Date.now() - statSync(lockFile).mtimeMs;
      existingContents = readFileSync(lockFile, "utf8");
      existingPid = Number.parseInt(existingContents, 10);
    } catch {
      existingPid = NaN;
    }

    if (!Number.isInteger(existingPid) && lockAgeMs < incompleteLockGraceMs) {
      if (Date.now() - startedAt > lockWaitTimeoutMs) {
        throw new Error("Timed out waiting for the API codegen lock to initialize.");
      }
      sleepSync(lockWaitPollMs);
      continue;
    }

    if (isProcessAlive(existingPid)) {
      if (Date.now() - startedAt > lockWaitTimeoutMs) {
        throw new Error(
          `Timed out waiting for API generated files lock held by pid ${existingPid}.`,
        );
      }
      sleepSync(lockWaitPollMs);
      continue;
    }

    const claimedStaleLock = `${lockFile}.stale-${process.pid}-${Date.now()}`;
    try {
      linkSync(lockFile, claimedStaleLock);
      const claimedContents = readFileSync(claimedStaleLock, "utf8");
      const claimedPid = Number.parseInt(claimedContents, 10);
      if (claimedContents !== existingContents || isProcessAlive(claimedPid)) {
        rmSync(claimedStaleLock, { force: true });
        continue;
      }
      unlinkSync(lockFile);
      rmSync(claimedStaleLock, { force: true });
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
  }
}

function releaseLock(fd) {
  try {
    closeSync(fd);
  } catch {
    // best effort
  }

  try {
    const existingPid = Number.parseInt(readFileSync(lockFile, "utf8"), 10);
    if (existingPid === process.pid) {
      rmSync(lockFile, { force: true });
    }
  } catch {
    // best effort
  }
}

const separatorIndex = process.argv.indexOf("--");
const commandArgs =
  separatorIndex === -1 ? process.argv.slice(2) : process.argv.slice(separatorIndex + 1);

if (commandArgs.length === 0) {
  console.error("Usage: node lib/api-spec/scripts/with-codegen-lock.mjs -- <command> [args...]");
  process.exit(1);
}

const [cmd, ...args] = commandArgs;
let fd = null;

try {
  if (process.env.API_CODEGEN_LOCK_HELD !== "1") {
    fd = acquireLock();
  }
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    env: { ...process.env, API_CODEGEN_LOCK_HELD: "1" },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exitCode = result.status ?? 1;
} catch (err) {
  console.error("[codegen-lock] Failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  if (fd != null) releaseLock(fd);
}
