import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sweepTempUploads } from "../src/lib/uploads.ts";

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "temp-upload-sweeper-"));
}

async function writeFileAged(
  dir: string,
  name: string,
  ageMs: number,
  now: number,
): Promise<string> {
  const fullPath = path.join(dir, name);
  await fs.writeFile(fullPath, "stub");
  const mtime = new Date(now - ageMs);
  await fs.utimes(fullPath, mtime, mtime);
  return fullPath;
}

test("sweepTempUploads deletes files older than maxAgeMs", async () => {
  const dir = await makeTempDir();
  try {
    const now = Date.now();
    const oldFile = await writeFileAged(dir, "old.bin", 7 * 60 * 60 * 1000, now);
    const youngFile = await writeFileAged(dir, "young.bin", 60 * 1000, now);

    const result = await sweepTempUploads({
      maxAgeMs: 6 * 60 * 60 * 1000,
      directory: dir,
      now,
    });

    assert.equal(result.scanned, 2);
    assert.equal(result.deleted, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.skipped, 1);

    await assert.rejects(fs.access(oldFile));
    await assert.doesNotReject(fs.access(youngFile));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("sweepTempUploads never deletes recent in-flight files", async () => {
  const dir = await makeTempDir();
  try {
    const now = Date.now();
    // Simulate three uploads that started just moments ago — these are
    // exactly the kind of files that must NOT be removed out from under a
    // request that is still streaming bytes to disk.
    const recent = [
      await writeFileAged(dir, "in-flight-1.bin", 0, now),
      await writeFileAged(dir, "in-flight-2.bin", 5 * 1000, now),
      await writeFileAged(dir, "in-flight-3.bin", 30 * 60 * 1000, now),
    ];

    const result = await sweepTempUploads({
      maxAgeMs: 6 * 60 * 60 * 1000,
      directory: dir,
      now,
    });

    assert.equal(result.deleted, 0);
    assert.equal(result.scanned, recent.length);
    assert.equal(result.skipped, recent.length);

    for (const file of recent) {
      await assert.doesNotReject(
        fs.access(file),
        `Recent file ${path.basename(file)} should still exist`,
      );
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("sweepTempUploads ignores subdirectories", async () => {
  const dir = await makeTempDir();
  try {
    const now = Date.now();
    const nested = path.join(dir, "nested");
    await fs.mkdir(nested);
    const oldNestedFile = path.join(nested, "old.bin");
    await fs.writeFile(oldNestedFile, "stub");
    const oldMtime = new Date(now - 7 * 60 * 60 * 1000);
    await fs.utimes(nested, oldMtime, oldMtime);
    await fs.utimes(oldNestedFile, oldMtime, oldMtime);

    const result = await sweepTempUploads({
      maxAgeMs: 6 * 60 * 60 * 1000,
      directory: dir,
      now,
    });

    assert.equal(result.deleted, 0);
    assert.equal(result.skipped, 1);
    await assert.doesNotReject(fs.access(nested));
    await assert.doesNotReject(fs.access(oldNestedFile));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("sweepTempUploads returns an empty result when the directory is missing", async () => {
  const dir = await makeTempDir();
  await fs.rm(dir, { recursive: true, force: true });

  const result = await sweepTempUploads({
    maxAgeMs: 6 * 60 * 60 * 1000,
    directory: dir,
  });

  assert.deepEqual(result, {
    scanned: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
  });
});
