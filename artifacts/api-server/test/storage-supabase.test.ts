import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, test } from "node:test";
import { MAX_UPLOAD_FILE_BYTES } from "@workspace/api-zod";

const originalFetch = globalThis.fetch;

function installSupabaseEnv() {
  process.env.CADSTONE_STORAGE_BACKEND = "supabase";
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

class CaptureResponse extends Writable {
  readonly chunks: Buffer[] = [];
  readonly headers = new Map<string, string>();
  headersSent = false;
  statusCode = 200;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string | number): this {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }

  body(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
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
    storage.__storageReadTesting.reset();
    storage.__probeCacheTesting.resetProbeImpl();
    storage.__probeCacheTesting.clearCache();
    storage.__streamStoredFileTesting.reset();
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_STORAGE_BUCKET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CADSTONE_STORAGE_BACKEND;
    delete process.env.CADSTONE_CHUNKED_UPLOAD_MAX_BYTES;
    delete process.env.CADSTONE_STORAGE_BUCKET_FILE_SIZE_LIMIT_BYTES;
    delete process.env.CADSTONE_STORAGE_BUCKET_LIMIT_VERIFY_TIMEOUT_MS;
    delete process.env.SUPABASE_STORAGE_DIRECT_URL;
    delete process.env.CADSTONE_SUPABASE_LEGACY_MULTIPART_UPLOAD;
  });

  test("startup raises the Supabase bucket size cap to the active app upload limit", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((input, init) => {
      requests.push({ url: String(input), init });
      if (init?.method === "GET") {
        return new Response(
          JSON.stringify({
            id: "cadstone-files",
            name: "cadstone-files",
            public: false,
            file_size_limit: 50 * 1024 * 1024,
            allowed_mime_types: null,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: "cadstone-files" }), { status: 200 });
    });

    const { ensureUploadRoot } = await import("../src/lib/storage.ts");
    await ensureUploadRoot();

    assert.deepEqual(
      requests.map((request) => request.init?.method),
      ["GET", "PUT"],
    );
    assert.deepEqual(
      requests.map((request) => new URL(request.url).pathname),
      ["/storage/v1/bucket/cadstone-files", "/storage/v1/bucket/cadstone-files"],
    );
    const updateBody = JSON.parse(String(requests[1].init?.body)) as {
      id: string;
      name: string;
      public: boolean;
      file_size_limit: number;
      allowed_mime_types: null;
    };
    assert.equal(updateBody.id, "cadstone-files");
    assert.equal(updateBody.name, "cadstone-files");
    assert.equal(updateBody.public, false);
    assert.equal(updateBody.file_size_limit, MAX_UPLOAD_FILE_BYTES);
    assert.equal(updateBody.allowed_mime_types, null);
    const headers = new Headers(requests[1].init?.headers);
    assert.equal(headers.get("Content-Type"), "application/json");
  });

  test("startup leaves a sufficiently large Supabase bucket limit unchanged", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          id: "cadstone-files",
          name: "cadstone-files",
          public: false,
          file_size_limit: MAX_UPLOAD_FILE_BYTES,
        }),
        { status: 200 },
      );
    });

    const { ensureUploadRoot } = await import("../src/lib/storage.ts");
    await ensureUploadRoot();

    assert.deepEqual(
      requests.map((request) => request.init?.method),
      ["GET"],
    );
  });

  test("startup does not fail when Supabase bucket limit verification is unavailable", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((input, init) => {
      requests.push({ url: String(input), init });
      return new Response("storage metadata unavailable", { status: 500 });
    });

    const { ensureUploadRoot } = await import("../src/lib/storage.ts");
    await ensureUploadRoot();

    assert.deepEqual(
      requests.map((request) => request.init?.method),
      ["GET"],
    );
  });

  test("startup still fails loudly when required Supabase storage env is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    mockFetch(() => {
      throw new Error("fetch should not be called");
    });

    const { ensureUploadRoot } = await import("../src/lib/storage.ts");
    await assert.rejects(() => ensureUploadRoot(), /SUPABASE_SERVICE_ROLE_KEY is not set/);
  });

  test("Supabase object-size rejects surface as structured payload-too-large errors", async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          statusCode: "413",
          error: "Payload Too Large",
          message: "The object exceeded the maximum allowed size.",
        }),
        { status: 413 },
      ),
    );

    const { writeUploadedBuffer } = await import("../src/lib/storage.ts");
    const { HttpError } = await import("../src/lib/http.ts");

    await assert.rejects(
      () => writeUploadedBuffer("/uploads/job-a/document/too-large.pdf", Buffer.from("x")),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 413);
        assert.equal(error.type, "payload-too-large");
        assert.deepEqual(error.details, {
          code: "STORAGE_FILE_TOO_LARGE",
          upstreamStatus: 413,
          storageLimitBytes: MAX_UPLOAD_FILE_BYTES,
        });
        return true;
      },
    );
  });

  test("large file-path uploads above the old multipart threshold use Supabase resumable storage chunks", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "cadstone-storage-tus-"));
    const sourcePath = path.join(tempDir, "large.pdf");
    const fileBytes = Buffer.alloc(24 * 1024 * 1024 + 13, 0x61);
    await writeFile(sourcePath, fileBytes);
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    try {
      mockFetch((input, init) => {
        requests.push({ url: String(input), init });
        const url = new URL(String(input));

        if (url.pathname === "/storage/v1/bucket/cadstone-files") {
          return new Response(
            JSON.stringify({
              id: "cadstone-files",
              name: "cadstone-files",
              public: false,
              file_size_limit: MAX_UPLOAD_FILE_BYTES,
            }),
            { status: 200 },
          );
        }

        if (
          init?.method === "POST" &&
          url.pathname === "/storage/v1/upload/resumable"
        ) {
          return new Response(null, {
            status: 201,
            headers: {
              location: "/storage/v1/upload/resumable/upload-1",
            },
          });
        }

        if (
          init?.method === "PATCH" &&
          url.pathname === "/storage/v1/upload/resumable/upload-1"
        ) {
          const headers = new Headers(init.headers);
          const offset = Number(headers.get("Upload-Offset"));
          const body = init.body;
          assert.ok(Buffer.isBuffer(body));
          return new Response(null, {
            status: 204,
            headers: {
              "upload-offset": String(offset + body.length),
            },
          });
        }

        throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
      });

      const { writeUploadedFromPath } = await import("../src/lib/storage.ts");
      await writeUploadedFromPath(
        "/uploads/job-a/document/large.pdf",
        sourcePath,
        { contentType: "application/pdf" },
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    assert.deepEqual(
      requests.map((request) => request.init?.method),
      ["GET", "POST", "PATCH", "PATCH", "PATCH", "PATCH", "PATCH"],
    );
    assert.equal(
      requests[1].url,
      "https://example.storage.supabase.co/storage/v1/upload/resumable",
    );
    const createHeaders = new Headers(requests[1].init?.headers);
    assert.equal(createHeaders.get("Tus-Resumable"), "1.0.0");
    assert.equal(createHeaders.get("Upload-Length"), String(fileBytes.length));
    assert.equal(createHeaders.get("x-upsert"), "true");
    assert.match(createHeaders.get("Upload-Metadata") ?? "", /bucketName /);
    assert.match(createHeaders.get("Upload-Metadata") ?? "", /objectName /);
    assert.match(createHeaders.get("Upload-Metadata") ?? "", /contentType /);

    const patchOffsets = requests
      .filter((request) => request.init?.method === "PATCH")
      .map((request) => new Headers(request.init?.headers).get("Upload-Offset"));
    assert.deepEqual(patchOffsets, [
      "0",
      String(6 * 1024 * 1024),
      String(12 * 1024 * 1024),
      String(18 * 1024 * 1024),
      String(24 * 1024 * 1024),
    ]);
  });

  test("legacy oversized Supabase multipart uploads still stream back as one file", async () => {
    process.env.CADSTONE_SUPABASE_LEGACY_MULTIPART_UPLOAD = "true";
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "cadstone-storage-parts-"));
    const sourcePath = path.join(tempDir, "loxone.zip");
    const fileBytes = Buffer.alloc(24 * 1024 * 1024 + 321);
    for (let index = 0; index < fileBytes.length; index += 1) {
      fileBytes[index] = index % 251;
    }
    await writeFile(sourcePath, fileBytes);
    const objects = new Map<string, { body: Buffer; contentType: string }>();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const objectPrefix = "/storage/v1/object/cadstone-files/";

    const objectKey = (url: URL) => decodeURIComponent(url.pathname.slice(objectPrefix.length));

    try {
      mockFetch((input, init) => {
        requests.push({ url: String(input), init });
        const url = new URL(String(input));

        if (url.pathname === "/storage/v1/bucket/cadstone-files") {
          return new Response(
            JSON.stringify({
              id: "cadstone-files",
              name: "cadstone-files",
              public: false,
              file_size_limit: 50 * 1024 * 1024,
            }),
            { status: 200 },
          );
        }

        if (url.pathname.startsWith(objectPrefix)) {
          const key = objectKey(url);
          if (init?.method === "POST") {
            const body = init.body;
            assert.ok(Buffer.isBuffer(body));
            objects.set(key, {
              body,
              contentType: new Headers(init.headers).get("Content-Type") ?? "application/octet-stream",
            });
            return new Response("{}", { status: 200 });
          }

          if (init?.method === "GET") {
            const object = objects.get(key);
            if (!object) {
              return new Response(null, { status: 404 });
            }
            return new Response(object.body, {
              status: 200,
              headers: {
                "content-length": String(object.body.length),
                "content-type": object.contentType,
              },
            });
          }

          if (init?.method === "DELETE") {
            objects.delete(key);
            return new Response(null, { status: 200 });
          }
        }

        throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
      });

      const { deletePhysicalFile, openStoredFileReadStream, writeUploadedFromPath } =
        await import("../src/lib/storage.ts");
      const fileUrl = "/uploads/job-a/document/Loxone-Stone-Package.zip";
      await writeUploadedFromPath(fileUrl, sourcePath, {
        contentType: "application/zip",
      });

      const storedKeys = Array.from(objects.keys()).sort();
      assert.deepEqual(storedKeys, [
        "stone-track/uploads/job-a/document/Loxone-Stone-Package.zip",
        "stone-track/uploads/job-a/document/Loxone-Stone-Package.zip.parts/000000",
        "stone-track/uploads/job-a/document/Loxone-Stone-Package.zip.parts/000001",
        "stone-track/uploads/job-a/document/Loxone-Stone-Package.zip.parts/000002",
        "stone-track/uploads/job-a/document/Loxone-Stone-Package.zip.parts/000003",
      ]);
      const manifest = JSON.parse(
        objects.get("stone-track/uploads/job-a/document/Loxone-Stone-Package.zip")!.body.toString("utf8"),
      ) as {
        totalBytes: number;
        contentType: string;
        parts: Array<{ index: number; size: number; fileUrl: string }>;
      };
      assert.equal(manifest.totalBytes, fileBytes.length);
      assert.equal(manifest.contentType, "application/zip");
      assert.deepEqual(
        manifest.parts.map((part) => part.size),
        [8 * 1024 * 1024, 8 * 1024 * 1024, 8 * 1024 * 1024, 321],
      );

      const stream = await openStoredFileReadStream(fileUrl);
      assert.deepEqual(await readStream(stream), fileBytes);

      await deletePhysicalFile(fileUrl);
      assert.equal(objects.size, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    assert.equal(
      requests.filter((request) => request.init?.method === "POST").length,
      5,
      "four parts plus one manifest should be stored",
    );
  });

  test("multipart Supabase downloads tolerate storage metadata that reports the manifest as a zip", async () => {
    const fileUrl = "/uploads/lead-a/document/OneDrive_2026-06-10.zip";
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: 9,
      contentType: "application/zip",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: 4,
        },
        {
          index: 1,
          fileUrl: `${fileUrl}.parts/000001`,
          size: 5,
        },
      ],
    };
    const manifestBody = Buffer.from(JSON.stringify(manifest), "utf8");
    const objectPrefix = "/storage/v1/object/cadstone-files/";

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/lead-a/document/OneDrive_2026-06-10.zip") {
          return new Response(manifestBody, {
            status: 200,
            headers: {
              "content-length": String(manifestBody.length),
              "content-type": "application/zip",
            },
          });
        }
        if (key === "stone-track/uploads/lead-a/document/OneDrive_2026-06-10.zip.parts/000000") {
          return new Response(Buffer.from("one-"), {
            status: 200,
            headers: {
              "content-length": "4",
              "content-type": "application/zip",
            },
          });
        }
        if (key === "stone-track/uploads/lead-a/document/OneDrive_2026-06-10.zip.parts/000001") {
          return new Response(Buffer.from("piece"), {
            status: 200,
            headers: {
              "content-length": "5",
              "content-type": "application/zip",
            },
          });
        }
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { openStoredFileReadStream } = await import("../src/lib/storage.ts");
    const stream = await openStoredFileReadStream(fileUrl);

    assert.equal((await readStream(stream)).toString("utf8"), "one-piece");
  });

  test("multipart Supabase PDF responses support byte ranges", async () => {
    const fileUrl = "/uploads/job-a/document/Masa-design-booklet.pdf";
    const first = Buffer.from("0123456789");
    const second = Buffer.from("abcdefghij");
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: first.length + second.length,
      contentType: "application/pdf",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: first.length,
        },
        {
          index: 1,
          fileUrl: `${fileUrl}.parts/000001`,
          size: second.length,
        },
      ],
    };
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    let materialized = false;
    const requests: Array<{ method: string; path: string }> = [];

    mockFetch((input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      requests.push({ method, path: decodeURIComponent(url.pathname) });
      if (
        method === "GET" &&
        url.pathname === "/storage/v1/bucket/cadstone-files"
      ) {
        return new Response(
          JSON.stringify({
            id: "cadstone-files",
            name: "cadstone-files",
            public: false,
            file_size_limit: MAX_UPLOAD_FILE_BYTES,
          }),
          { status: 200 },
        );
      }
      if (url.pathname.startsWith(objectPrefix) && method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/job-a/document/Masa-design-booklet.pdf") {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: {
              "content-type":
                "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
            },
          });
        }
        if (
          key ===
          "stone-track/uploads/job-a/document/Masa-design-booklet.pdf.parts/000000"
        ) {
          return new Response(first, {
            status: 200,
            headers: {
              "content-length": String(first.length),
              "content-type": "application/pdf",
            },
          });
        }
        if (
          key ===
          "stone-track/uploads/job-a/document/Masa-design-booklet.pdf.parts/000001"
        ) {
          return new Response(second, {
            status: 200,
            headers: {
              "content-length": String(second.length),
              "content-type": "application/pdf",
            },
          });
        }
        if (key.endsWith("Masa-design-booklet.pdf.cadstone-native")) {
          if (!materialized) return new Response(null, { status: 404 });
          return new Response(Buffer.from("0"), {
            status: 206,
            headers: {
              "content-length": "1",
              "content-range": `bytes 0-0/${manifest.totalBytes}`,
            },
          });
        }
      }
      if (
        method === "POST" &&
        url.pathname === "/storage/v1/upload/resumable"
      ) {
        return new Response(null, {
          status: 201,
          headers: { location: "/storage/v1/upload/resumable/masa" },
        });
      }
      if (method === "PATCH" && url.pathname.endsWith("/resumable/masa")) {
        materialized = true;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(manifest.totalBytes) },
        });
      }

      throw new Error(`Unexpected Supabase request: ${method} ${url.href}`);
    });

    const storage = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();
    const result = await storage.streamPreparedStoredFileToResponse(
      res as Parameters<typeof storage.streamPreparedStoredFileToResponse>[0],
      fileUrl,
      {
        disposition: "inline",
        filename: "Masa-design-booklet.pdf",
        cacheControl: "private, no-store",
        rangeHeader: "bytes=8-13",
      },
    );

    assert.equal(res.statusCode, 206);
    assert.equal(res.getHeader("accept-ranges"), "bytes");
    assert.equal(res.getHeader("content-range"), "bytes 8-13/20");
    assert.equal(res.getHeader("content-length"), "6");
    assert.equal(res.body(), "89abcd");
    assert.equal(result.bytesStreamed, 6);
    await storage.__storageWriteTesting.waitForNativeMaterialization(fileUrl);
    assert.equal(
      requests.filter((request) => request.method === "DELETE").length,
      0,
    );
  });

  test("direct Supabase PDF responses pass byte ranges through to storage", async () => {
    const fileUrl = "/uploads/job-a/document/direct-large.pdf";
    const payload = Buffer.from("%PDF direct large body");
    const rangedPayload = payload.subarray(5, 11);
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    const rangeHeaders: Array<string | null> = [];

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/job-a/document/direct-large.pdf") {
          const range = new Headers(init.headers).get("range");
          rangeHeaders.push(range);
          if (range) {
            assert.equal(range, "bytes=5-10");
            return new Response(rangedPayload, {
              status: 206,
              headers: {
                "content-length": String(rangedPayload.length),
                "content-range": `bytes 5-10/${payload.length}`,
                "content-type": "application/pdf",
              },
            });
          }
          return new Response(payload, {
            status: 200,
            headers: {
              "content-length": String(payload.length),
              "content-type": "application/pdf",
            },
          });
        }
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { streamStoredFileToResponse } = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();
    await streamStoredFileToResponse(
      res as Parameters<typeof streamStoredFileToResponse>[0],
      fileUrl,
      {
        disposition: "inline",
        filename: "direct-large.pdf",
        cacheControl: "private, no-store",
        rangeHeader: "bytes=5-10",
      },
    );

    assert.deepEqual(rangeHeaders, [null, "bytes=5-10"]);
    assert.equal(res.statusCode, 206);
    assert.equal(res.getHeader("content-range"), `bytes 5-10/${payload.length}`);
    assert.equal(res.body(), rangedPayload.toString("utf8"));
  });

  test("large first-party ranges use chunked transfer below Cloud Run's cap", async () => {
    const fileUrl = "/uploads/lead-fiske/document/large-range.zip";
    const rangePayload = Buffer.alloc(24 * 1024 * 1024 + 1, 0x5a);
    const totalBytes = rangePayload.length + 1024;
    const rangeEnd = rangePayload.length - 1;
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    let fullReads = 0;

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const range = new Headers(init.headers).get("range");
        if (!range) {
          fullReads += 1;
          return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            controller.close();
          } }), {
            status: 200,
            headers: {
              "content-length": String(totalBytes),
              "content-type": "application/zip",
            },
          });
        }

        assert.equal(range, `bytes=0-${rangeEnd}`);
        return new Response(rangePayload, {
          status: 206,
          headers: {
            "content-length": String(rangePayload.length),
            "content-range": `bytes 0-${rangeEnd}/${totalBytes}`,
            "content-type": "application/zip",
          },
        });
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const storage = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();
    const result = await storage.streamPreparedStoredFileToResponse(
      res as Parameters<typeof storage.streamPreparedStoredFileToResponse>[0],
      fileUrl,
      {
        disposition: "attachment",
        filename: "large-range.zip",
        rangeHeader: `bytes=0-${rangeEnd}`,
      },
    );

    assert.equal(res.statusCode, 206);
    assert.equal(res.getHeader("content-range"), `bytes 0-${rangeEnd}/${totalBytes}`);
    assert.equal(res.getHeader("content-length"), undefined);
    assert.equal(res.getHeader("transfer-encoding"), "chunked");
    assert.deepEqual(Buffer.concat(res.chunks), rangePayload);
    assert.equal(result.bytesStreamed, rangePayload.length);
    assert.equal(fullReads, 2);
  });

  test("direct Supabase ranges reject a provider response with mismatched bytes", async () => {
    const fileUrl = "/uploads/job-a/document/invalid-range.pdf";
    const payload = Buffer.from("%PDF invalid range response");
    const objectPrefix = "/storage/v1/object/cadstone-files/";

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const range = new Headers(init.headers).get("range");
        if (!range) {
          return new Response(payload, {
            status: 200,
            headers: { "content-length": String(payload.length) },
          });
        }
        return new Response(payload, {
          status: 200,
          headers: { "content-length": String(payload.length) },
        });
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { streamStoredFileToResponse } = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();

    await assert.rejects(
      () =>
        streamStoredFileToResponse(
          res as Parameters<typeof streamStoredFileToResponse>[0],
          fileUrl,
          {
            disposition: "inline",
            filename: "invalid-range.pdf",
            rangeHeader: "bytes=5-10",
          },
        ),
      /invalid byte-range response/,
    );
    assert.equal(res.headersSent, false);
    assert.equal(res.chunks.length, 0);
  });

  test("chunked first-party delivery rejects a truncated native object", async () => {
    const fileUrl = "/uploads/job-a/document/truncated-native.pdf";
    const payload = Buffer.from("%PDF truncated");
    mockFetch(
      () =>
        new Response(payload, {
          status: 200,
          headers: {
            "content-length": String(payload.length + 10),
            "content-type": "application/pdf",
          },
        }),
    );

    const storage = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();
    res.on("error", () => undefined);

    await assert.rejects(
      () =>
        storage.streamPreparedStoredFileToResponse(
          res as Parameters<typeof storage.streamPreparedStoredFileToResponse>[0],
          fileUrl,
          {
            disposition: "attachment",
            filename: "truncated-native.pdf",
            rangeHeader: null,
          },
        ),
      /unexpected byte count/,
    );
    assert.equal(res.getHeader("content-length"), undefined);
    assert.equal(res.getHeader("transfer-encoding"), "chunked");
    assert.equal(res.destroyed, true);
  });

  test("first-party streaming materializes a legacy file without deleting source data", async () => {
    const fileUrl = "/uploads/lead-fiske/document/legacy-Fiske.zip";
    const firstPart = Buffer.alloc(4 * 1024 * 1024, 0x31);
    const secondPart = Buffer.alloc(3 * 1024 * 1024 + 17, 0x32);
    const completeFile = Buffer.concat([firstPart, secondPart]);
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: completeFile.length,
      contentType: "application/zip",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: firstPart.length,
        },
        {
          index: 1,
          fileUrl: `${fileUrl}.parts/000001`,
          size: secondPart.length,
        },
      ],
    };
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    const uploadedChunks: Buffer[] = [];
    const requests: Array<{ method: string; url: URL; range: string | null }> =
      [];
    const rangeStart = firstPart.length - 4;
    const rangeEnd = firstPart.length + 11;
    const expectedRange = completeFile.subarray(rangeStart, rangeEnd + 1);
    let materializedComplete = false;
    let nativeProbeFailures = 0;

    mockFetch((input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const range = new Headers(init?.headers).get("range");
      requests.push({ method, url, range });

      if (
        method === "GET" &&
        url.pathname === "/storage/v1/bucket/cadstone-files"
      ) {
        return new Response(
          JSON.stringify({
            id: "cadstone-files",
            name: "cadstone-files",
            public: false,
            file_size_limit: MAX_UPLOAD_FILE_BYTES,
          }),
          { status: 200 },
        );
      }

      if (url.pathname.startsWith(objectPrefix)) {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (
          method === "GET" &&
          key === "stone-track/uploads/lead-fiske/document/legacy-Fiske.zip"
        ) {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: {
              "content-type":
                "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
            },
          });
        }
        if (
          method === "GET" &&
          key ===
            "stone-track/uploads/lead-fiske/document/legacy-Fiske.zip.parts/000000"
        ) {
          return new Response(firstPart, {
            status: 200,
            headers: { "content-length": String(firstPart.length) },
          });
        }
        if (
          method === "GET" &&
          key ===
            "stone-track/uploads/lead-fiske/document/legacy-Fiske.zip.parts/000001"
        ) {
          return new Response(secondPart, {
            status: 200,
            headers: { "content-length": String(secondPart.length) },
          });
        }
        if (
          method === "GET" &&
          key ===
            "stone-track/uploads/lead-fiske/document/legacy-Fiske.zip.cadstone-native"
        ) {
          if (!materializedComplete) {
            if (range === "bytes=0-0" && nativeProbeFailures < 3) {
              nativeProbeFailures += 1;
              return new Response("native probe unavailable", { status: 503 });
            }
            return new Response(null, { status: 404 });
          }
          if (range === "bytes=0-0") {
            return new Response(completeFile.subarray(0, 1), {
              status: 206,
              headers: {
                "content-length": "1",
                "content-range": `bytes 0-0/${completeFile.length}`,
                "content-type": "application/zip",
              },
            });
          }
          if (range === null) {
            return new Response(completeFile, {
              status: 200,
              headers: {
                "content-length": String(completeFile.length),
                "content-type": "application/zip",
              },
            });
          }
          if (range === `bytes=${rangeStart}-${rangeEnd}`) {
            return new Response(expectedRange, {
              status: 206,
              headers: {
                "content-length": String(expectedRange.length),
                "content-range": `bytes ${rangeStart}-${rangeEnd}/${completeFile.length}`,
                "content-type": "application/zip",
              },
            });
          }
        }
      }

      if (
        method === "POST" &&
        url.pathname === "/storage/v1/upload/resumable"
      ) {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Upload-Length"), String(completeFile.length));
        assert.ok(
          init?.signal,
          "resumable creation must have a timeout signal",
        );
        const metadata = Object.fromEntries(
          (headers.get("Upload-Metadata") ?? "")
            .split(",")
            .map((entry) => entry.split(" ", 2))
            .map(([key, value]) => [
              key,
              Buffer.from(value ?? "", "base64").toString("utf8"),
            ]),
        );
        assert.equal(
          metadata.objectName,
          "stone-track/uploads/lead-fiske/document/legacy-Fiske.zip.cadstone-native",
          "materialization must target the derived native object",
        );
        return new Response(null, {
          status: 201,
          headers: { location: "/storage/v1/upload/resumable/legacy-fiske" },
        });
      }

      if (
        method === "PATCH" &&
        url.pathname === "/storage/v1/upload/resumable/legacy-fiske"
      ) {
        assert.ok(Buffer.isBuffer(init?.body));
        assert.ok(init?.signal, "resumable chunks must have a timeout signal");
        const chunk = init.body as Buffer;
        const offset = Number(new Headers(init.headers).get("Upload-Offset"));
        assert.equal(
          offset,
          uploadedChunks.reduce((total, item) => total + item.length, 0),
        );
        uploadedChunks.push(Buffer.from(chunk));
        materializedComplete = offset + chunk.length === completeFile.length;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(offset + chunk.length) },
        });
      }

      throw new Error(`Unexpected Supabase request: ${method} ${url.href}`);
    });

    const storage = await import("../src/lib/storage.ts");
    const fullResponse = new CaptureResponse();
    const fullResult = await storage.streamPreparedStoredFileToResponse(
      fullResponse as Parameters<
        typeof storage.streamPreparedStoredFileToResponse
      >[0],
      fileUrl,
      {
        filename: "legacy-Fiske.zip",
        disposition: "attachment",
        contentType: "application/zip",
        cacheControl: "private, no-store",
        rangeHeader: null,
      },
    );

    assert.equal(fullResponse.statusCode, 200);
    assert.deepEqual(Buffer.concat(fullResponse.chunks), completeFile);
    assert.equal(fullResponse.getHeader("content-length"), undefined);
    assert.equal(fullResponse.getHeader("transfer-encoding"), "chunked");
    assert.equal(fullResponse.getHeader("content-type"), "application/zip");
    assert.match(
      fullResponse.getHeader("content-disposition") ?? "",
      /^attachment;/,
    );
    assert.match(
      fullResponse.getHeader("content-disposition") ?? "",
      /legacy-Fiske\.zip/,
    );
    assert.equal(fullResponse.getHeader("accept-ranges"), "bytes");
    assert.equal(fullResponse.getHeader("cache-control"), "private, no-store");
    assert.equal(fullResult.bytesStreamed, completeFile.length);
    assert.equal(
      nativeProbeFailures,
      3,
      "native-copy probe failure must degrade to part delivery",
    );

    await storage.__storageWriteTesting.waitForNativeMaterialization(fileUrl);
    assert.equal(
      storage.__storageWriteTesting.cachedNativeObject(fileUrl),
      `${fileUrl}.cadstone-native`,
    );
    const rangeResponse = new CaptureResponse();
    const rangeResult = await storage.streamPreparedStoredFileToResponse(
      rangeResponse as Parameters<
        typeof storage.streamPreparedStoredFileToResponse
      >[0],
      fileUrl,
      {
        filename: "legacy-Fiske.zip",
        disposition: "attachment",
        contentType: "application/zip",
        cacheControl: "private, no-store",
        rangeHeader: `bytes=${rangeStart}-${rangeEnd}`,
      },
    );

    assert.deepEqual(Buffer.concat(uploadedChunks), completeFile);
    assert.equal(rangeResponse.statusCode, 206);
    assert.deepEqual(Buffer.concat(rangeResponse.chunks), expectedRange);
    assert.equal(rangeResponse.getHeader("accept-ranges"), "bytes");
    assert.equal(
      rangeResponse.getHeader("content-range"),
      `bytes ${rangeStart}-${rangeEnd}/${completeFile.length}`,
    );
    assert.equal(
      rangeResponse.getHeader("content-length"),
      String(expectedRange.length),
    );
    assert.equal(rangeResponse.getHeader("transfer-encoding"), undefined);
    assert.equal(rangeResult.bytesStreamed, expectedRange.length);
    assert.equal(
      requests.filter((request) => request.method === "DELETE").length,
      0,
      "delivery repair must not delete the source manifest or any original part",
    );
    assert.equal(
      requests.filter(
        (request) =>
          request.method === "POST" &&
          request.url.pathname === "/storage/v1/upload/resumable",
      ).length,
      1,
      "the derived native copy should be materialized only once",
    );
    assert.equal(
      requests.filter((request) => request.url.pathname.includes(".parts/"))
        .length,
      4,
      "the first customer response and one-time background materialization each read every part once",
    );
    assert.ok(
      requests.some(
        (request) =>
          request.method === "GET" &&
          request.range === `bytes=${rangeStart}-${rangeEnd}` &&
          decodeURIComponent(request.url.pathname).endsWith(
            "/legacy-Fiske.zip.cadstone-native",
          ),
      ),
      "the browser range must be served from the native object",
    );
  });

  test("resumable upload creation retries a transient provider failure", async () => {
    let createAttempts = 0;
    mockFetch((input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (
        method === "GET" &&
        url.pathname === "/storage/v1/bucket/cadstone-files"
      ) {
        return new Response(
          JSON.stringify({
            id: "cadstone-files",
            name: "cadstone-files",
            public: false,
            file_size_limit: MAX_UPLOAD_FILE_BYTES,
          }),
          { status: 200 },
        );
      }
      if (
        method === "POST" &&
        url.pathname === "/storage/v1/upload/resumable"
      ) {
        createAttempts += 1;
        if (createAttempts === 1) {
          return new Response("temporary create failure", { status: 503 });
        }
        return new Response(null, {
          status: 201,
          headers: { location: "/storage/v1/upload/resumable/retried" },
        });
      }
      throw new Error(`Unexpected Supabase request: ${method} ${url.href}`);
    });

    const storage = await import("../src/lib/storage.ts");
    const location = await storage.__storageWriteTesting.createResumableUpload({
      fileUrl: "/uploads/lead/document/retry-create.zip.cadstone-native",
      totalBytes: 8,
      contentType: "application/zip",
    });

    assert.equal(createAttempts, 2);
    assert.equal(
      new URL(location).pathname,
      "/storage/v1/upload/resumable/retried",
    );
  });

  test("TUS retry resumes from the provider's partial committed offset", async () => {
    const uploadUrl =
      "https://example.storage.supabase.co/storage/v1/upload/resumable/partial?token=secret";
    const chunk = Buffer.from("abcdefgh");
    let patchAttempts = 0;
    let headAttempts = 0;

    mockFetch((input, init) => {
      assert.equal(String(input), uploadUrl);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      if (method === "PATCH") {
        patchAttempts += 1;
        if (patchAttempts === 1) {
          assert.equal(headers.get("Upload-Offset"), "0");
          assert.deepEqual(init?.body, chunk);
          return new Response("temporary patch failure", { status: 503 });
        }
        assert.equal(headers.get("Upload-Offset"), "3");
        assert.deepEqual(init?.body, chunk.subarray(3));
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(chunk.length) },
        });
      }
      if (method === "HEAD") {
        headAttempts += 1;
        return new Response(null, {
          status: 200,
          headers: { "upload-offset": "3" },
        });
      }
      throw new Error(`Unexpected TUS request: ${method}`);
    });

    const storage = await import("../src/lib/storage.ts");
    const nextOffset = await storage.__storageWriteTesting.patchResumableUpload(
      uploadUrl,
      0,
      chunk,
    );

    assert.equal(nextOffset, chunk.length);
    assert.equal(patchAttempts, 2);
    assert.equal(headAttempts, 1);
  });

  test("TUS retry accepts a chunk committed despite the failed response", async () => {
    const uploadUrl =
      "https://example.storage.supabase.co/storage/v1/upload/resumable/committed?token=secret";
    const chunk = Buffer.from("committed");
    let patchAttempts = 0;
    let headAttempts = 0;

    mockFetch((_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        patchAttempts += 1;
        return new Response("connection dropped after commit", { status: 503 });
      }
      if (method === "HEAD") {
        headAttempts += 1;
        return new Response(null, {
          status: 200,
          headers: { "upload-offset": String(chunk.length) },
        });
      }
      throw new Error(`Unexpected TUS request: ${method}`);
    });

    const storage = await import("../src/lib/storage.ts");
    assert.equal(
      await storage.__storageWriteTesting.patchResumableUpload(
        uploadUrl,
        0,
        chunk,
      ),
      chunk.length,
    );
    assert.equal(patchAttempts, 1);
    assert.equal(headAttempts, 1);
  });

  test("TUS retry stops when the upload session is gone", async () => {
    const uploadUrl =
      "https://example.storage.supabase.co/storage/v1/upload/resumable/gone?token=secret";
    let headAttempts = 0;
    mockFetch((_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        return new Response("temporary patch failure", { status: 503 });
      }
      if (method === "HEAD") {
        headAttempts += 1;
        return new Response(null, { status: 410 });
      }
      throw new Error(`Unexpected TUS request: ${method}`);
    });

    const storage = await import("../src/lib/storage.ts");
    await assert.rejects(
      () =>
        storage.__storageWriteTesting.patchResumableUpload(
          uploadUrl,
          0,
          Buffer.from("gone"),
        ),
      (error: unknown) => {
        assert.match(String(error), /503/);
        assert.equal(String(error).includes("token=secret"), false);
        return true;
      },
    );
    assert.equal(headAttempts, 1);
  });

  test("TUS retry stops on offset regression", async () => {
    const uploadUrl =
      "https://example.storage.supabase.co/storage/v1/upload/resumable/regressed?token=secret";
    const chunk = Buffer.from("abcdefgh");
    let patchAttempts = 0;
    let headAttempts = 0;
    mockFetch((_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        patchAttempts += 1;
        return new Response("temporary patch failure", { status: 503 });
      }
      if (method === "HEAD") {
        headAttempts += 1;
        return new Response(null, {
          status: 200,
          headers: { "upload-offset": headAttempts === 1 ? "3" : "2" },
        });
      }
      throw new Error(`Unexpected TUS request: ${method}`);
    });

    const storage = await import("../src/lib/storage.ts");
    await assert.rejects(
      () =>
        storage.__storageWriteTesting.patchResumableUpload(uploadUrl, 0, chunk),
      /503/,
    );
    assert.equal(patchAttempts, 2);
    assert.equal(headAttempts, 2);
  });

  test("TUS retry does not retry a non-transient provider rejection", async () => {
    const uploadUrl =
      "https://example.storage.supabase.co/storage/v1/upload/resumable/rejected?token=secret";
    let patchAttempts = 0;
    let headAttempts = 0;
    mockFetch((_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        patchAttempts += 1;
        return new Response("invalid upload", { status: 400 });
      }
      if (method === "HEAD") headAttempts += 1;
      throw new Error(`Unexpected TUS request: ${method}`);
    });

    const storage = await import("../src/lib/storage.ts");
    await assert.rejects(
      () =>
        storage.__storageWriteTesting.patchResumableUpload(
          uploadUrl,
          0,
          Buffer.from("bad"),
        ),
      /400/,
    );
    assert.equal(patchAttempts, 1);
    assert.equal(headAttempts, 0);
  });

  test("a failed manifest optimization probe degrades to the delivery GET without caching", async () => {
    const fileUrl = "/uploads/lead/document/probe-degrades.zip";
    const payload = Buffer.from("probe-degradation-payload");
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: payload.length,
      contentType: "application/zip",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: payload.length,
        },
      ],
    };
    let sourceReads = 0;
    let writes = 0;

    mockFetch((input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const key = decodeURIComponent(
        url.pathname.replace("/storage/v1/object/cadstone-files/", ""),
      );
      if (
        method === "GET" &&
        key === "stone-track/uploads/lead/document/probe-degrades.zip"
      ) {
        sourceReads += 1;
        if (sourceReads <= 3) {
          return new Response("probe unavailable", { status: 503 });
        }
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: {
            "content-type":
              "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
          },
        });
      }
      if (
        method === "GET" &&
        key === "stone-track/uploads/lead/document/probe-degrades.zip.parts/000000"
      ) {
        return new Response(payload, {
          status: 200,
          headers: { "content-length": String(payload.length) },
        });
      }
      if (["POST", "PATCH", "DELETE"].includes(method)) writes += 1;
      throw new Error(`Unexpected Supabase request: ${method} ${url.href}`);
    });

    const storage = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();
    const result = await storage.streamPreparedStoredFileToResponse(
      res as Parameters<typeof storage.streamPreparedStoredFileToResponse>[0],
      fileUrl,
      { disposition: "attachment", filename: "probe-degrades.zip" },
    );

    assert.deepEqual(Buffer.concat(res.chunks), payload);
    assert.equal(result.bytesStreamed, payload.length);
    assert.equal(sourceReads, 4);
    assert.equal(writes, 0);
    assert.equal(
      storage.__storageWriteTesting.cachedNativeObject(fileUrl),
      undefined,
    );
  });

  test("background materialization failure never breaks the first click and a later resolve retries", async () => {
    const fileUrl = "/uploads/lead/document/background-retry.zip";
    const payload = Buffer.from("background-retry-payload");
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: payload.length,
      contentType: "application/zip",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: payload.length,
        },
      ],
    };
    let createAttempts = 0;
    let materialized = false;
    const requests: Array<{ method: string; path: string }> = [];

    mockFetch((input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      requests.push({ method, path: decodeURIComponent(url.pathname) });
      if (
        method === "GET" &&
        url.pathname === "/storage/v1/bucket/cadstone-files"
      ) {
        return new Response(
          JSON.stringify({
            id: "cadstone-files",
            name: "cadstone-files",
            public: false,
            file_size_limit: MAX_UPLOAD_FILE_BYTES,
          }),
          { status: 200 },
        );
      }
      const objectPrefix = "/storage/v1/object/cadstone-files/";
      if (url.pathname.startsWith(objectPrefix) && method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/lead/document/background-retry.zip") {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: {
              "content-type":
                "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
            },
          });
        }
        if (key.endsWith("background-retry.zip.parts/000000")) {
          return new Response(payload, {
            status: 200,
            headers: { "content-length": String(payload.length) },
          });
        }
        if (key.endsWith("background-retry.zip.cadstone-native")) {
          if (!materialized) return new Response(null, { status: 404 });
          return new Response(payload.subarray(0, 1), {
            status: 206,
            headers: {
              "content-length": "1",
              "content-range": `bytes 0-0/${payload.length}`,
            },
          });
        }
      }
      if (
        method === "POST" &&
        url.pathname === "/storage/v1/upload/resumable"
      ) {
        createAttempts += 1;
        return new Response(null, {
          status: 201,
          headers: {
            location: `/storage/v1/upload/resumable/background-${createAttempts}`,
          },
        });
      }
      if (url.pathname.endsWith("/background-1")) {
        if (method === "PATCH") {
          return new Response("temporary patch failure", { status: 503 });
        }
        if (method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "upload-offset": "0" },
          });
        }
      }
      if (url.pathname.endsWith("/background-2") && method === "PATCH") {
        materialized = true;
        return new Response(null, {
          status: 204,
          headers: { "upload-offset": String(payload.length) },
        });
      }
      throw new Error(`Unexpected Supabase request: ${method} ${url.href}`);
    });

    const storage = await import("../src/lib/storage.ts");
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const res = new CaptureResponse();
      const first = await storage.streamPreparedStoredFileToResponse(
        res as Parameters<typeof storage.streamPreparedStoredFileToResponse>[0],
        fileUrl,
        { disposition: "attachment", filename: "background-retry.zip" },
      );
      assert.deepEqual(Buffer.concat(res.chunks), payload);
      assert.equal(first.bytesStreamed, payload.length);
      assert.equal(
        storage.__storageWriteTesting.cachedNativeObject(fileUrl),
        undefined,
      );

      await assert.rejects(() =>
        storage.__storageWriteTesting.waitForNativeMaterialization(fileUrl),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
      assert.equal(
        storage.__storageWriteTesting.cachedNativeObject(fileUrl),
        undefined,
      );

      assert.equal(
        await storage.prepareStoredFileForDelivery(fileUrl),
        fileUrl,
      );
      await storage.__storageWriteTesting.waitForNativeMaterialization(fileUrl);
      assert.equal(createAttempts, 2);
      assert.equal(
        storage.__storageWriteTesting.cachedNativeObject(fileUrl),
        `${fileUrl}.cadstone-native`,
      );
      assert.equal(
        requests.filter((request) => request.method === "DELETE").length,
        0,
      );
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  test("cache stores only confirmed native and verified materialized targets", async () => {
    const nativeFileUrl = "/uploads/lead/document/native.pdf";
    const nativePayload = Buffer.from("%PDF native");
    let nativeReads = 0;
    mockFetch((_input, init) => {
      nativeReads += 1;
      assert.equal(init?.method, "GET");
      return new Response(nativePayload, {
        status: 200,
        headers: {
          "content-length": String(nativePayload.length),
          "content-type": "application/pdf",
        },
      });
    });

    const storage = await import("../src/lib/storage.ts");
    assert.equal(
      await storage.prepareStoredFileForDelivery(nativeFileUrl),
      nativeFileUrl,
    );
    assert.equal(
      storage.__storageWriteTesting.cachedNativeObject(nativeFileUrl),
      nativeFileUrl,
    );
    assert.equal(
      await storage.prepareStoredFileForDelivery(nativeFileUrl),
      nativeFileUrl,
    );
    assert.equal(
      nativeReads,
      1,
      "confirmed native objects should use the cache",
    );
  });

  test("small direct zip downloads are not mistaken for multipart manifests", async () => {
    const fileUrl = "/uploads/lead-a/document/small.zip";
    const payload = Buffer.from("PK\u0003\u0004small-zip-body", "binary");
    const requests: string[] = [];
    const objectPrefix = "/storage/v1/object/cadstone-files/";

    mockFetch((input, init) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/lead-a/document/small.zip") {
          return new Response(payload, {
            status: 200,
            headers: {
              "content-length": String(payload.length),
              "content-type": "application/zip",
            },
          });
        }
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { openStoredFileReadStream } = await import("../src/lib/storage.ts");
    const stream = await openStoredFileReadStream(fileUrl);

    assert.deepEqual(await readStream(stream), payload);
    assert.equal(requests.length, 1);
  });

  test("a stalled Supabase response prefix fails instead of looking like clean EOF", async () => {
    const fileUrl = "/uploads/job-a/document/stalled-prefix.pdf";
    mockFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Intentionally never enqueue or close.
            },
          }),
          { status: 200 },
        ),
    );

    const storage = await import("../src/lib/storage.ts");
    storage.__storageReadTesting.setTimeouts({ idleMs: 10 });

    await assert.rejects(
      () => storage.openStoredFileReadStream(fileUrl),
      /response stalled/,
    );
  });

  test("openStoredFileReadStream times out a stalled large native object", async () => {
    const fileUrl = "/uploads/job-a/document/stalled-large.pdf";
    mockFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // Intentionally never enqueue or close.
            },
          }),
          {
            status: 200,
            headers: { "content-length": String(2 * 1024 * 1024) },
          },
        ),
    );

    const storage = await import("../src/lib/storage.ts");
    storage.__storageReadTesting.setTimeouts({ idleMs: 10 });
    const stream = await storage.openStoredFileReadStream(fileUrl);

    await assert.rejects(() => readStream(stream), /read stream stalled/);
  });

  test("a Supabase object open retries and stops at the configured timeout", async () => {
    const fileUrl = "/uploads/job-a/document/stalled-open.pdf";
    let attempts = 0;
    mockFetch((_input, init) => {
      attempts += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });

    const storage = await import("../src/lib/storage.ts");
    storage.__storageReadTesting.setTimeouts({ openMs: 10 });

    await assert.rejects(
      () => storage.openStoredFileReadStream(fileUrl),
      /timed out before opening/,
    );
    assert.equal(attempts, 3);
  });

  test("Supabase object reads retry transient storage failures before streaming", async () => {
    const fileUrl = "/uploads/job-a/document/retry-me.pdf";
    const payload = Buffer.from("%PDF retry body");
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    let attempts = 0;

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        assert.equal(key, "stone-track/uploads/job-a/document/retry-me.pdf");
        attempts += 1;
        if (attempts < 3) {
          return new Response("temporary storage issue", { status: 500 });
        }
        return new Response(payload, {
          status: 200,
          headers: {
            "content-length": String(payload.length),
            "content-type": "application/pdf",
          },
        });
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { openStoredFileReadStream } = await import("../src/lib/storage.ts");
    const stream = await openStoredFileReadStream(fileUrl);

    assert.deepEqual(await readStream(stream), payload);
    assert.equal(attempts, 3);
  });

  test("streamed Supabase object responses retry transient storage failures before streaming", async () => {
    const fileUrl = "/uploads/job-a/document/retry-stream.pdf";
    const payload = Buffer.from("%PDF streamed retry body");
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    let attempts = 0;

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        assert.equal(key, "stone-track/uploads/job-a/document/retry-stream.pdf");
        attempts += 1;
        if (attempts < 3) {
          return new Response("temporary storage issue", { status: 500 });
        }
        return new Response(payload, {
          status: 200,
          headers: {
            "content-length": String(payload.length),
            "content-type": "application/pdf",
          },
        });
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { streamStoredFileToResponse } = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();

    const result = await streamStoredFileToResponse(
      res as Parameters<typeof streamStoredFileToResponse>[0],
      fileUrl,
      {
        disposition: "inline",
        filename: "retry-stream.pdf",
        cacheControl: "private, no-store",
      },
    );

    assert.equal(attempts, 3);
    assert.equal(result.bytesStreamed, payload.length);
    assert.equal(result.aborted, false);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Buffer.concat(res.chunks), payload);
  });

  test("streamed Supabase object responses return a readable page when the initial read never opens", async () => {
    const fileUrl = "/uploads/job-a/document/fails-at-object-open.pdf";
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    let attempts = 0;

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        assert.equal(
          key,
          "stone-track/uploads/job-a/document/fails-at-object-open.pdf",
        );
        attempts += 1;
        return new Response("storage down", { status: 500 });
      }

      throw new Error(
        `Unexpected Supabase request: ${init?.method} ${url.href}`,
      );
    });

    const { streamStoredFileToResponse } =
      await import("../src/lib/storage.ts");
    const res = new CaptureResponse();
    (res as CaptureResponse & { req?: { id: string } }).req = {
      id: "request-123<script>",
    };

    await assert.rejects(() =>
      streamStoredFileToResponse(
        res as Parameters<typeof streamStoredFileToResponse>[0],
        fileUrl,
        {
          disposition: "inline",
          filename: "fails-at-object-open.pdf",
          cacheControl: "private, no-store",
        },
      ),
    );

    const body = res.body();
    assert.equal(attempts, 3);
    assert.equal(res.statusCode, 500);
    assert.match(res.getHeader("content-type") ?? "", /^text\/html/);
    assert.match(body, /File temporarily unavailable/);
    assert.match(body, /Please refresh and try again/);
    assert.match(body, /Reference:\s*<code>request-123script<\/code>/);
  });

  test("Supabase multipart part reads retry transient storage failures", async () => {
    const fileUrl = "/uploads/job-a/document/retry-parts.pdf";
    const partBody = Buffer.from("part-body");
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: partBody.length,
      contentType: "application/pdf",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: partBody.length,
        },
      ],
    };
    const objectPrefix = "/storage/v1/object/cadstone-files/";
    let partAttempts = 0;

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/job-a/document/retry-parts.pdf") {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: {
              "content-type": "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
            },
          });
        }
        if (key === "stone-track/uploads/job-a/document/retry-parts.pdf.parts/000000") {
          partAttempts += 1;
          if (partAttempts < 2) {
            return new Response("temporary storage issue", { status: 503 });
          }
          return new Response(partBody, {
            status: 200,
            headers: {
              "content-length": String(partBody.length),
              "content-type": "application/pdf",
            },
          });
        }
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { openStoredFileReadStream } = await import("../src/lib/storage.ts");
    const stream = await openStoredFileReadStream(fileUrl);

    assert.deepEqual(await readStream(stream), partBody);
    assert.equal(partAttempts, 2);
  });

  test("streamed file responses return a readable error page instead of an empty 500", async () => {
    const fileUrl = "/uploads/job-a/document/fails-before-first-byte.pdf";
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: 99,
      contentType: "application/pdf",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: 99,
        },
      ],
    };
    const objectPrefix = "/storage/v1/object/cadstone-files/";

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/job-a/document/fails-before-first-byte.pdf") {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: {
              "content-type": "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
            },
          });
        }
        if (key === "stone-track/uploads/job-a/document/fails-before-first-byte.pdf.parts/000000") {
          return new Response("storage down", { status: 500 });
        }
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { streamStoredFileToResponse } = await import("../src/lib/storage.ts");
    const res = new CaptureResponse();

    await assert.rejects(() =>
      streamStoredFileToResponse(
        res as Parameters<typeof streamStoredFileToResponse>[0],
        fileUrl,
        {
          disposition: "inline",
          filename: "fails-before-first-byte.pdf",
          cacheControl: "private, no-store",
        },
      ),
    );

    const body = res.body();
    assert.equal(res.statusCode, 500);
    assert.match(res.getHeader("content-type") ?? "", /^text\/html/);
    assert.match(body, /File temporarily unavailable/);
    assert.match(body, /Please refresh and try again/);
  });

  test("multipart Supabase downloads reject truncated storage parts", async () => {
    const fileUrl = "/uploads/job-a/document/Loxone-Stone-Package.zip";
    const manifest = {
      version: 1,
      kind: "cadstone-supabase-multipart",
      totalBytes: 5,
      contentType: "application/zip",
      parts: [
        {
          index: 0,
          fileUrl: `${fileUrl}.parts/000000`,
          size: 5,
        },
      ],
    };
    const objectPrefix = "/storage/v1/object/cadstone-files/";

    mockFetch((input, init) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith(objectPrefix) && init?.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice(objectPrefix.length));
        if (key === "stone-track/uploads/job-a/document/Loxone-Stone-Package.zip") {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: {
              "content-type": "application/vnd.cadstone.multipart-upload+json; charset=utf-8",
            },
          });
        }
        if (key === "stone-track/uploads/job-a/document/Loxone-Stone-Package.zip.parts/000000") {
          return new Response(Buffer.from("abc"), {
            status: 200,
            headers: {
              "content-length": "3",
              "content-type": "application/zip",
            },
          });
        }
      }

      throw new Error(`Unexpected Supabase request: ${init?.method} ${url.href}`);
    });

    const { openStoredFileReadStream } = await import("../src/lib/storage.ts");
    const stream = await openStoredFileReadStream(fileUrl);

    await assert.rejects(
      () => readStream(stream),
      /Supabase multipart part size does not match its manifest/,
    );
  });

  test("uploads buffers through the Supabase Storage API", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/storage/v1/bucket/")) {
        return new Response(
          JSON.stringify({
            id: "cadstone-files",
            name: "cadstone-files",
            public: false,
            file_size_limit: MAX_UPLOAD_FILE_BYTES,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ Key: "stone-track/uploads/job-a/document/file.pdf" }), {
        status: 200,
      });
    });

    const { writeUploadedBuffer } = await import("../src/lib/storage.ts");
    await writeUploadedBuffer(
      "/uploads/job-a/document/file.pdf",
      Buffer.from("pdf-bytes"),
      { contentType: "application/pdf" },
    );

    assert.equal(requests.length, 2);
    assert.equal(
      requests[1].url,
      "https://example.supabase.co/storage/v1/object/cadstone-files/stone-track/uploads/job-a/document/file.pdf",
    );
    assert.equal(requests[1].init?.method, "POST");
    const headers = new Headers(requests[1].init?.headers);
    assert.equal(headers.get("Content-Type"), "application/pdf");
    assert.equal(headers.get("x-upsert"), "true");
    assert.equal(headers.get("apikey"), "test-service-role-key");
    assert.equal(headers.get("Authorization"), "Bearer test-service-role-key");
  });

  test("generated filenames with consecutive dots are accepted by storage URL validation", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch((input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).includes("/storage/v1/bucket/")) {
        return new Response(
          JSON.stringify({
            id: "cadstone-files",
            name: "cadstone-files",
            public: false,
            file_size_limit: MAX_UPLOAD_FILE_BYTES,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const { buildStoredFileName, buildUploadPath, writeUploadedBuffer } =
      await import("../src/lib/storage.ts");
    const storedFileName = buildStoredFileName("invoice..pdf");
    const uploadPath = buildUploadPath({
      jobId: "job-a",
      mediaType: "document",
      storedFileName,
    });

    assert.match(storedFileName, /invoice\.\.pdf$/);
    await writeUploadedBuffer(uploadPath.fileUrl, Buffer.from("pdf-bytes"));

    assert.equal(requests.length, 2);
    assert.ok(
      requests[1].url.includes(`/stone-track/uploads/job-a/document/${storedFileName}`),
      requests[1].url,
    );
  });

  test("storage URL validation still rejects traversal path segments", async () => {
    let called = false;
    mockFetch(() => {
      called = true;
      return new Response("{}", { status: 200 });
    });

    const { writeUploadedBuffer } = await import("../src/lib/storage.ts");

    await assert.rejects(
      () => writeUploadedBuffer("/uploads/job-a/../secret.pdf", Buffer.from("x")),
      /Invalid stored file URL/,
    );
    assert.equal(called, false);
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
      ["HEAD", "GET", "DELETE", "DELETE"],
    );
    assert.ok(requests.every((request) => request.url.includes("/stone-track/uploads/")));
    assert.match(requests.at(-1)?.url ?? "", /missing\.jpg\.cadstone-native$/);
  });

  test("opens Supabase objects as Node read streams", async () => {
    mockFetch(() => new Response("hello from storage", { status: 200 }));

    const { openStoredFileReadStream } = await import("../src/lib/storage.ts");
    const stream = await openStoredFileReadStream("/uploads/job-a/document/readme.txt");

    assert.equal((await readStream(stream)).toString("utf8"), "hello from storage");
  });
});
