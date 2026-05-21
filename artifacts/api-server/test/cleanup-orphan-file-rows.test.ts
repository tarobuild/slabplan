import assert from "node:assert/strict";
import { test } from "node:test";

const storageLibPath = "../scripts/lib/supabase-storage.mjs";
const cleanupScriptPath = "../scripts/cleanup-orphan-file-rows.mjs";

async function loadStorageLib() {
  return await import(`${storageLibPath}?t=${Date.now()}-${Math.random()}`);
}

async function loadCleanupScript() {
  return await import(`${cleanupScriptPath}?t=${Date.now()}-${Math.random()}`);
}

test("fileUrlToObjectName allows benign consecutive dots inside a filename", async () => {
  const mod = await loadStorageLib();

  assert.equal(
    mod.fileUrlToObjectName({ fileUrl: "/uploads/job-1/contract..final.pdf" }),
    "stone-track/uploads/job-1/contract..final.pdf",
  );
});

test("fileUrlToObjectName rejects traversal path segments", async () => {
  const mod = await loadStorageLib();

  for (const bad of [
    "/uploads/../etc/passwd",
    "/uploads/job-1/./contract.pdf",
    "/uploads/job-1//contract.pdf",
    "/uploads/job-1/ok\0nul.pdf",
  ]) {
    assert.throws(
      () => mod.fileUrlToObjectName({ fileUrl: bad }),
      /Invalid stored file URL/,
      `expected reject: ${JSON.stringify(bad)}`,
    );
  }
});

test("cleanup classification probes benign consecutive-dot filenames", async () => {
  const mod = await loadCleanupScript();
  const probed: string[] = [];

  const result = await mod.classifyRows({
    rows: [
      {
        id: "file-1",
        file_url: "/uploads/job-1/contract..final.pdf",
      },
    ],
    storage: {
      async objectExists(objectName: string) {
        probed.push(objectName);
        return true;
      },
    },
  });

  assert.deepEqual(probed, ["stone-track/uploads/job-1/contract..final.pdf"]);
  assert.equal(result.orphans.length, 0);
  assert.equal(result.present.length, 1);
  assert.equal(result.indeterminate.length, 0);
});
