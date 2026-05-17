import assert from "node:assert/strict";
import { test } from "node:test";

const SCRIPT_PATH = "../scripts/audit-storage-drift.mjs";

async function loadScript() {
  // Cache-bust so each test sees a fresh module instance.
  return await import(`${SCRIPT_PATH}?t=${Date.now()}-${Math.random()}`);
}

test("parseArgs: aborts when --db flag is missing", async () => {
  const mod = await loadScript();
  assert.throws(() => mod.parseArgs([]), /Missing required --db flag/);
});

test("parseArgs: aborts on unknown --db value", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.parseArgs(["--db=staging"]),
    /Unknown --db value/,
  );
});

test("parseArgs: --db=local is accepted with default options", async () => {
  const mod = await loadScript();
  const result = mod.parseArgs(["--db=local"]);
  assert.equal(result.db, "local");
  assert.equal(result.format, "human");
  assert.equal(typeof result.maxBucketObjects, "number");
  assert.ok(result.maxBucketObjects > 0);
});

test("parseArgs: --db=production with --json switches output mode", async () => {
  const mod = await loadScript();
  const result = mod.parseArgs(["--db=production", "--json"]);
  assert.equal(result.db, "production");
  assert.equal(result.format, "json");
});

test("parseArgs: --db=production does NOT require --i-know-what-im-doing", async () => {
  // The audit is read-only; gating it on the destructive flag would
  // be misleading and would discourage running it on a schedule.
  const mod = await loadScript();
  const result = mod.parseArgs(["--db=production"]);
  assert.equal(result.db, "production");
});

test("parseArgs: rejects unknown arguments", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.parseArgs(["--db=local", "--delete-orphans"]),
    /Unrecognized argument: --delete-orphans/,
  );
});

test("parseArgs: --max-bucket-objects accepts positive integers", async () => {
  const mod = await loadScript();
  const result = mod.parseArgs(["--db=local", "--max-bucket-objects=10"]);
  assert.equal(result.maxBucketObjects, 10);
});

test("parseArgs: --max-bucket-objects rejects junk values", async () => {
  const mod = await loadScript();
  for (const bad of ["abc", "0", "-5", "1.5", ""]) {
    assert.throws(
      () => mod.parseArgs(["--db=local", `--max-bucket-objects=${bad}`]),
      /Invalid --max-bucket-objects value/,
      `expected reject: ${JSON.stringify(bad)}`,
    );
  }
});

test("uploadsObjectPrefix: includes trailing slash and stone-track/uploads/", async () => {
  const mod = await loadScript();
  const prefix = mod.uploadsObjectPrefix();
  assert.equal(prefix, "stone-track/uploads/");
});

test("fileUrlToObjectName: round-trips with objectNameToFileUrl", async () => {
  const mod = await loadScript();
  const fileUrl = "/uploads/job-1/photo/1700000000000-uuid-foo.jpg";
  const objectName = mod.fileUrlToObjectName({ fileUrl });
  assert.equal(
    objectName,
    "stone-track/uploads/job-1/photo/1700000000000-uuid-foo.jpg",
  );
  const back = mod.objectNameToFileUrl({ objectName });
  assert.equal(back, fileUrl);
});

test("fileUrlToObjectName: rejects malformed urls", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.fileUrlToObjectName({ fileUrl: "" }),
    /Stored file URL is missing/,
  );
  assert.throws(
    () =>
      mod.fileUrlToObjectName({
        fileUrl: "/not-uploads/foo.jpg",
      }),
    /Invalid stored file URL/,
  );
  for (const bad of [
    "/uploads/../etc/passwd",
    "/uploads//absolute",
    "/uploads/ok\0nul",
  ]) {
    assert.throws(
      () => mod.fileUrlToObjectName({ fileUrl: bad }),
      /Invalid stored file URL/,
      `expected reject: ${JSON.stringify(bad)}`,
    );
  }
});

test("objectNameToFileUrl: returns null for objects outside the Stone Track uploads prefix", async () => {
  const mod = await loadScript();
  // Sibling prefixes — restore-drill, public placeholders — must be
  // ignored so they don't show up as "bucket_only" false positives.
  assert.equal(
    mod.objectNameToFileUrl({
      objectName: "stone-track/restore-drill/roundtrip-1.bin",
    }),
    null,
  );
  assert.equal(
    mod.objectNameToFileUrl({
      objectName: "public/placeholder.txt",
    }),
    null,
  );
  // Empty / non-string defenses.
  assert.equal(
    mod.objectNameToFileUrl({ objectName: "" }),
    null,
  );
  // Exact prefix match with no relative tail is also not a real
  // upload, so it must not be classified as such.
  assert.equal(
    mod.objectNameToFileUrl({
      objectName: "stone-track/uploads/",
    }),
    null,
  );
});

test("diffSides: identifies one-sided urls and returns sorted arrays", async () => {
  const mod = await loadScript();
  const dbFileUrls = [
    "/uploads/a.jpg",
    "/uploads/b.jpg",
    "/uploads/c.jpg",
    "/uploads/c.jpg", // duplicate in DB list — must dedupe
  ];
  const bucketFileUrls = [
    "/uploads/b.jpg",
    "/uploads/c.jpg",
    "/uploads/d.jpg",
    "/uploads/e.jpg",
  ];
  const { dbOnly, bucketOnly } = mod.diffSides({ dbFileUrls, bucketFileUrls });
  assert.deepEqual(dbOnly, ["/uploads/a.jpg"]);
  assert.deepEqual(bucketOnly, ["/uploads/d.jpg", "/uploads/e.jpg"]);
});

test("diffSides: empty inputs produce empty drift sets", async () => {
  const mod = await loadScript();
  const r1 = mod.diffSides({ dbFileUrls: [], bucketFileUrls: [] });
  assert.deepEqual(r1, { dbOnly: [], bucketOnly: [] });
  const r2 = mod.diffSides({
    dbFileUrls: ["/uploads/x.jpg"],
    bucketFileUrls: ["/uploads/x.jpg"],
  });
  assert.deepEqual(r2, { dbOnly: [], bucketOnly: [] });
});
