import assert from "node:assert/strict";
import { test } from "node:test";

const SCRIPT_PATH = "../scripts/storage-restore-drill.mjs";

async function loadScript() {
  return await import(`${SCRIPT_PATH}?t=${Date.now()}-${Math.random()}`);
}

function makeStorage(overrides: Record<string, unknown> = {}) {
  const uploadBytes = Buffer.from("restore-drill-bytes");
  return {
    bucketName: "cadstone-files",
    listAllObjects: async () => [
      {
        name: "cadstone/uploads/job-1/file.bin",
        metadata: { size: uploadBytes.length, contentType: "application/octet-stream" },
      },
    ],
    downloadBuffer: async (name: string) => {
      if (name.startsWith("cadstone/uploads/")) return uploadBytes;
      return Buffer.from(uploadBytes);
    },
    uploadBuffer: async () => {},
    objectExists: async () => true,
    deleteObject: async () => {},
    ...overrides,
  };
}

test("runRestoreDrill deletes the uploaded drill object when verification throws", async () => {
  const mod = await loadScript();
  const now = new Date("2026-01-02T03:04:05.000Z");
  const deleted: string[] = [];
  const targetName = mod.makeRestoreDrillTargetName(now);
  const storage = makeStorage({
    objectExists: async () => {
      throw new Error("object metadata lookup failed");
    },
    deleteObject: async (name: string) => {
      deleted.push(name);
    },
  });

  await assert.rejects(
    () =>
      mod.runRestoreDrill({
        storage,
        now,
        log: () => {},
        error: () => {},
      }),
    /object metadata lookup failed/,
  );

  assert.deepEqual(deleted, [targetName]);
});

test("runRestoreDrill fails explicitly when drill object cleanup fails", async () => {
  const mod = await loadScript();
  const now = new Date("2026-01-02T03:04:05.000Z");
  const cleanupErrors: string[] = [];
  const storage = makeStorage({
    deleteObject: async (name: string) => {
      cleanupErrors.push(name);
      throw new Error("delete denied");
    },
  });

  await assert.rejects(
    () =>
      mod.runRestoreDrill({
        storage,
        now,
        log: () => {},
        error: () => {},
      }),
    (err: unknown) => {
      assert.ok(err instanceof AggregateError);
      assert.match(err.message, /cleanup also failed/);
      assert.equal(err.errors.length, 2);
      assert.match(String(err.errors[0]?.message), /delete denied/);
      assert.match(String(err.errors[1]?.message), /delete denied/);
      return true;
    },
  );

  assert.deepEqual(cleanupErrors, [
    mod.makeRestoreDrillTargetName(now),
    mod.makeRestoreDrillTargetName(now),
  ]);
});
