import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Readable } from "node:stream";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installScriptStorageEnv() {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_STORAGE_BUCKET: "cadstone-files",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  };
}

test("script storage object info falls back to list metadata when HEAD has no body length", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).includes("/object/info/")) {
      return new Response(null, { status: 200 });
    }
    if (String(input).includes("/object/list/")) {
      return new Response(
        JSON.stringify([
          {
            name: "2026-05-19.sql.gz",
            id: "object-id",
            metadata: { size: 41522, mimetype: "application/gzip" },
            updated_at: "2026-05-19T14:11:23.979Z",
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected request: ${input}`);
  }) as typeof fetch;

  const { createSupabaseStorage } = await import(
    "../scripts/lib/supabase-storage.mjs"
  );
  const storage = createSupabaseStorage(installScriptStorageEnv());

  const info = await storage.getObjectInfo("backups/db/2026-05-19.sql.gz");

  assert.equal(info?.sizeBytes, 41522);
  assert.equal(info?.contentType, "application/gzip");
  assert.equal(info?.updated, "2026-05-19T14:11:23.979Z");
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/object\/info\/cadstone-files\/backups\/db\/2026-05-19\.sql\.gz$/);
  assert.match(requests[1].url, /\/object\/list\/cadstone-files$/);
  assert.equal(JSON.parse(String(requests[1].init?.body)).prefix, "backups/db");
});

test("script storage upload stream sends service-role authenticated object writes", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const { createSupabaseStorage } = await import(
    "../scripts/lib/supabase-storage.mjs"
  );
  const storage = createSupabaseStorage(installScriptStorageEnv());

  await storage.uploadStream(
    "backups/db/.tmp/test.sql.gz",
    Readable.from(Buffer.from("backup")),
    { contentType: "application/gzip", cacheControl: "private, max-age=0" },
  );

  assert.equal(requests.length, 1);
  assert.match(
    requests[0].url,
    /\/storage\/v1\/object\/cadstone-files\/backups\/db\/\.tmp\/test\.sql\.gz$/,
  );
  assert.equal(requests[0].init?.method, "POST");
  const headers = new Headers(requests[0].init?.headers);
  assert.equal(headers.get("apikey"), "test-service-role-key");
  assert.equal(headers.get("Authorization"), "Bearer test-service-role-key");
  assert.equal(headers.get("Content-Type"), "application/gzip");
  assert.equal(headers.get("Cache-Control"), "private, max-age=0");
  assert.equal(headers.get("x-upsert"), "true");
});
