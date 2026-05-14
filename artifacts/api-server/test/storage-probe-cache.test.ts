import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, test } from "node:test";

before(() => {
  // The probe cache is plain in-process state; no DB or app required, but
  // silence any pino warnings the lib might emit on import.
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // Provide placeholders so storage.ts can be imported even though the tests
  // below stub the probe and never actually hit Supabase Storage.
  process.env.SUPABASE_URL ??= "https://storage.example.invalid";
  process.env.SUPABASE_STORAGE_BUCKET ??= "cadstone-files";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
});

describe("probeStorageStatus cache", () => {
  let calls: string[] = [];

  beforeEach(async () => {
    const storage = await import("../src/lib/storage.ts");
    calls = [];
    storage.__probeCacheTesting.clearCache();
    storage.__probeCacheTesting.setProbeImpl(async (fileUrl) => {
      calls.push(fileUrl);
      return "ok";
    });
  });

  afterEach(async () => {
    const storage = await import("../src/lib/storage.ts");
    storage.__probeCacheTesting.resetProbeImpl();
    storage.__probeCacheTesting.clearCache();
    delete process.env.STORAGE_PROBE_OK_CACHE_TTL_MS;
    delete process.env.STORAGE_PROBE_MISSING_CACHE_TTL_MS;
  });

  test("repeated probes for the same URL within the TTL hit storage only once", async () => {
    const { probeStorageStatus } = await import("../src/lib/storage.ts");
    const url = "/uploads/job-a/document/file-1.pdf";

    assert.equal(await probeStorageStatus(url), "ok");
    assert.equal(await probeStorageStatus(url), "ok");
    assert.equal(await probeStorageStatus(url), "ok");

    assert.equal(
      calls.length,
      1,
      "subsequent probes within the TTL must come from the cache",
    );
  });

  test("missing results are also cached so a deleted file isn't re-probed every listing", async () => {
    const storage = await import("../src/lib/storage.ts");
    storage.__probeCacheTesting.setProbeImpl(async (fileUrl) => {
      calls.push(fileUrl);
      return "missing";
    });

    const url = "/uploads/job-a/document/file-2.pdf";
    assert.equal(await storage.probeStorageStatus(url), "missing");
    assert.equal(await storage.probeStorageStatus(url), "missing");

    assert.equal(calls.length, 1);
  });

  test("transient errors fail-open to 'ok' but are NOT cached", async () => {
    // Caching a fail-open "ok" would freeze every URL into a stale healthy
    // state for the entire TTL whenever storage hiccups. The next request
    // must get a real probe instead.
    const storage = await import("../src/lib/storage.ts");
    storage.__probeCacheTesting.setProbeImpl(async (fileUrl) => {
      calls.push(fileUrl);
      return "error";
    });

    const url = "/uploads/job-a/document/file-3.pdf";
    assert.equal(await storage.probeStorageStatus(url), "ok");
    assert.equal(await storage.probeStorageStatus(url), "ok");

    assert.equal(
      calls.length,
      2,
      "transient errors must trigger a fresh probe on every call",
    );
    assert.equal(
      storage.__probeCacheTesting.cacheSize(),
      0,
      "errors must not leave entries in the cache",
    );
  });

  test("probeStorageStatuses dedupes within a batch and reuses the cache across batches", async () => {
    const { probeStorageStatuses } = await import("../src/lib/storage.ts");
    const urlA = "/uploads/job-a/document/a.pdf";
    const urlB = "/uploads/job-a/document/b.pdf";

    const first = await probeStorageStatuses([urlA, urlB, urlA, urlB, urlA]);
    assert.equal(first.get(urlA), "ok");
    assert.equal(first.get(urlB), "ok");
    assert.equal(calls.length, 2, "duplicates within a batch must be deduped");

    const second = await probeStorageStatuses([urlA, urlB]);
    assert.equal(second.get(urlA), "ok");
    assert.equal(second.get(urlB), "ok");
    assert.equal(
      calls.length,
      2,
      "second batch must be served entirely from the cache",
    );
  });

  test("concurrent probes for the same URL coalesce to a single round-trip", async () => {
    const storage = await import("../src/lib/storage.ts");
    let resolveProbe: ((value: "ok") => void) | null = null;
    storage.__probeCacheTesting.setProbeImpl(async (fileUrl) => {
      calls.push(fileUrl);
      return new Promise<"ok">((resolve) => {
        resolveProbe = resolve;
      });
    });

    const url = "/uploads/job-a/document/concurrent.pdf";
    const p1 = storage.probeStorageStatus(url);
    const p2 = storage.probeStorageStatus(url);
    const p3 = storage.probeStorageStatus(url);

    // Yield so the inflight slot is definitely populated before we settle it.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(resolveProbe, "probe impl must have been invoked exactly once");
    resolveProbe!("ok");

    assert.deepEqual(await Promise.all([p1, p2, p3]), ["ok", "ok", "ok"]);
    assert.equal(
      calls.length,
      1,
      "concurrent probes must share a single inflight request",
    );
  });

  test("entries are re-probed once the TTL expires", async () => {
    process.env.STORAGE_PROBE_OK_CACHE_TTL_MS = "5";
    const { probeStorageStatus } = await import("../src/lib/storage.ts");

    const url = "/uploads/job-a/document/expiry.pdf";
    assert.equal(await probeStorageStatus(url), "ok");
    assert.equal(calls.length, 1);

    // Wait long enough that the entry's expiresAt has elapsed.
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(await probeStorageStatus(url), "ok");
    assert.equal(
      calls.length,
      2,
      "an expired entry must trigger a fresh probe",
    );
  });

  test("a TTL of 0 disables caching for that result class", async () => {
    process.env.STORAGE_PROBE_OK_CACHE_TTL_MS = "0";
    const storage = await import("../src/lib/storage.ts");

    const url = "/uploads/job-a/document/no-cache.pdf";
    assert.equal(await storage.probeStorageStatus(url), "ok");
    assert.equal(await storage.probeStorageStatus(url), "ok");

    assert.equal(calls.length, 2);
    assert.equal(
      storage.__probeCacheTesting.cacheSize(),
      0,
      "TTL of 0 must skip the cache entirely",
    );
  });

  test("missing-only TTL is independent from ok-only TTL", async () => {
    process.env.STORAGE_PROBE_MISSING_CACHE_TTL_MS = "0";
    const storage = await import("../src/lib/storage.ts");
    storage.__probeCacheTesting.setProbeImpl(async (fileUrl) => {
      calls.push(fileUrl);
      return "missing";
    });

    const url = "/uploads/job-a/document/missing-no-cache.pdf";
    assert.equal(await storage.probeStorageStatus(url), "missing");
    assert.equal(await storage.probeStorageStatus(url), "missing");

    assert.equal(
      calls.length,
      2,
      "MISSING TTL of 0 must re-probe each time so cleanup elsewhere flips the badge promptly",
    );
  });

  test("a falsy fileUrl always returns 'missing' without consulting the cache or storage", async () => {
    const storage = await import("../src/lib/storage.ts");

    assert.equal(await storage.probeStorageStatus(null), "missing");
    assert.equal(await storage.probeStorageStatus(undefined), "missing");
    assert.equal(await storage.probeStorageStatus(""), "missing");

    assert.equal(calls.length, 0);
    assert.equal(storage.__probeCacheTesting.cacheSize(), 0);
  });
});
