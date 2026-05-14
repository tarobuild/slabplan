import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

const originalFetch = globalThis.fetch;

function installSupabaseEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_STORAGE_BUCKET = "cadstone-files";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
}

function mockFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = handler as typeof fetch;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("Supabase storage provider", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    installSupabaseEnv();
  });

  afterEach(async () => {
    const storage = await import("../src/lib/storage.ts");
    storage.__storageWriteTesting.reset();
    storage.__probeCacheTesting.resetProbeImpl();
    storage.__probeCacheTesting.clearCache();
    storage.__streamStoredFileTesting.reset();
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_STORAGE_BUCKET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test("uploads buffers through the Supabase Storage API", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ Key: "cadstone/uploads/job-a/document/file.pdf" }), {
        status: 200,
      });
    });

    const { writeUploadedBuffer } = await import("../src/lib/storage.ts");
    await writeUploadedBuffer(
      "/uploads/job-a/document/file.pdf",
      Buffer.from("pdf-bytes"),
      { contentType: "application/pdf" },
    );

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://example.supabase.co/storage/v1/object/cadstone-files/cadstone/uploads/job-a/document/file.pdf",
    );
    assert.equal(requests[0].init?.method, "POST");
    const headers = new Headers(requests[0].init?.headers);
    assert.equal(headers.get("Content-Type"), "application/pdf");
    assert.equal(headers.get("x-upsert"), "true");
    assert.equal(headers.get("apikey"), "test-service-role-key");
    assert.equal(headers.get("Authorization"), "Bearer test-service-role-key");
  });

  test("probes and deletes files through Supabase Storage", async () => {
    const requests: Array<{ url: string; method: string | undefined }> = [];
    mockFetch((input, init) => {
      requests.push({ url: String(input), method: init?.method });
      const status = init?.method === "HEAD" ? 400 : 200;
      return new Response(null, { status });
    });

    const { deletePhysicalFile, storedFileExists } = await import("../src/lib/storage.ts");

    assert.equal(await storedFileExists("/uploads/job-a/photos/missing.jpg"), false);
    await deletePhysicalFile("/uploads/job-a/photos/missing.jpg");

    assert.deepEqual(
      requests.map((request) => request.method),
      ["HEAD", "DELETE"],
    );
    assert.ok(requests.every((request) => request.url.includes("/cadstone/uploads/")));
  });

  test("opens Supabase objects as Node read streams", async () => {
    mockFetch(() => new Response("hello from storage", { status: 200 }));

    const { openStoredFileReadStream } = await import("../src/lib/storage.ts");
    const stream = await openStoredFileReadStream("/uploads/job-a/document/readme.txt");

    assert.equal((await readStream(stream)).toString("utf8"), "hello from storage");
  });
});
