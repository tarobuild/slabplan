import assert from "node:assert/strict";
import { describe, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES } from "@workspace/api-zod";
import { ApiError, type ApiClient } from "./api-client";
import { TOOL_DEFINITIONS } from "./tools";

const attachFile = TOOL_DEFINITIONS.find((tool) => tool.name === "attach_file");
assert.ok(attachFile, "attach_file tool must be registered");
const attachLeadFile = TOOL_DEFINITIONS.find((tool) => tool.name === "attach_lead_file");
assert.ok(attachLeadFile, "attach_lead_file tool must be registered");

function baseArgs(contentBase64: string) {
  return {
    folderId: "folder-1",
    filename: "note.txt",
    mimeType: "text/plain",
    contentBase64,
  };
}

describe("attach_file contentBase64 validation", () => {
  test("rejects malformed base64 before multipart upload", async () => {
    let multipartCalls = 0;
    const client = {
      requestMultipart: async () => {
        multipartCalls += 1;
        return { status: 200, data: { ok: true }, contentType: "application/json" };
      },
    } as unknown as ApiClient;

    await assert.rejects(
      attachFile.handler(client, baseArgs("not base64")),
      (err) => err instanceof ApiError && err.status === 400,
    );
    assert.equal(multipartCalls, 0);
  });

  test("accepts canonical padded base64", async () => {
    let uploadedPath: string | undefined;
    const client = {
      requestMultipart: async (req: { path: string }) => {
        uploadedPath = req.path;
        return { status: 200, data: { ok: true }, contentType: "application/json" };
      },
    } as unknown as ApiClient;

    await attachFile.handler(client, baseArgs(Buffer.from("hello").toString("base64")));

    assert.equal(uploadedPath, "/folders/folder-1/files");
  });

  test("enforces encoded and decoded size before Buffer allocation", async () => {
    const source = await fs.readFile(path.resolve(import.meta.dirname, "tools.ts"), "utf8");

    assert.match(source, /const MAX_ATTACH_FILE_BYTES = 1024 \* 1024 \* 500/);
    assert.match(source, /const MAX_ATTACH_FILE_BASE64_CHARS = Math\.ceil\(MAX_ATTACH_FILE_BYTES \/ 3\) \* 4/);
    assert.match(
      source,
      /contentBase64: z\.string\(\)\.min\(1\)\.max\(MAX_ATTACH_FILE_BASE64_CHARS\)/,
      "input schema must reject oversized encoded payloads",
    );

    const lengthCheckAt = source.indexOf("if (value.length > MAX_ATTACH_FILE_BASE64_CHARS)");
    const decodedEstimateAt = source.indexOf("const estimatedBytes = estimateBase64DecodedBytes(value)");
    const bufferFromAt = source.indexOf('Buffer.from(value, "base64")');

    assert.ok(lengthCheckAt >= 0, "handler must check encoded length");
    assert.ok(decodedEstimateAt > lengthCheckAt, "handler must estimate decoded size after encoded length check");
    assert.ok(bufferFromAt > decodedEstimateAt, "handler must enforce size limits before Buffer.from");
  });
});

describe("attach_lead_file upload routing", () => {
  test("uses direct multipart for small lead attachments", async () => {
    let uploadedPath: string | undefined;
    const client = {
      requestMultipart: async (req: { path: string }) => {
        uploadedPath = req.path;
        return { status: 201, data: { attachments: [] }, contentType: "application/json" };
      },
    } as unknown as ApiClient;

    await attachLeadFile.handler(client, {
      leadId: "lead-1",
      filename: "small.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("small").toString("base64"),
    });

    assert.equal(uploadedPath, "/leads/lead-1/attachments");
  });

  test("uses base64 chunked upload for large lead attachments", async () => {
    const requests: Array<{
      method?: string;
      path: string;
      body?: unknown;
      contentType?: string;
    }> = [];
    const large = Buffer.alloc(DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES + 1, 7);
    const client = {
      request: async (req: { method: string; path: string; body?: unknown }) => {
        requests.push(req);
        if (req.path.endsWith("/attachments/chunked")) {
          return {
            status: 201,
            data: { session: { uploadId: "upload-1" } },
            contentType: "application/json",
          };
        }
        return {
          status: 201,
          data: { attachments: [{ originalName: "large.pdf" }] },
          contentType: "application/json",
        };
      },
      requestRaw: async (req: {
        method: string;
        path: string;
        body: unknown;
        contentType: string;
      }) => {
        requests.push(req);
        return { status: 200, data: { ok: true }, contentType: "application/json" };
      },
      requestMultipart: async () => {
        throw new Error("large lead attachments must not use direct multipart");
      },
    } as unknown as ApiClient;

    await attachLeadFile.handler(client, {
      leadId: "lead-1",
      filename: "large.pdf",
      mimeType: "application/pdf",
      contentBase64: large.toString("base64"),
    });

    assert.equal(requests[0]?.path, "/leads/lead-1/attachments/chunked");
    assert.deepEqual(requests[0]?.body, {
      originalName: "large.pdf",
      mimeType: "application/pdf",
      totalSize: large.length,
      totalChunks: 2,
      contentHash: crypto.createHash("sha256").update(large).digest("hex"),
    });
    assert.equal(requests[1]?.method, "PUT");
    assert.equal(requests[1]?.path, "/leads/lead-1/attachments/chunked/upload-1/chunks/0");
    assert.equal(requests[1]?.contentType, "text/plain");
    assert.equal(requests[2]?.path, "/leads/lead-1/attachments/chunked/upload-1/chunks/1");
    assert.equal(requests[3]?.path, "/leads/lead-1/attachments/chunked/upload-1/complete");
  });
});
