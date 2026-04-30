import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import type { Request } from "express";

import { hashMultipartRequest } from "../src/middleware/idempotency.ts";

// Build a minimal Request-shaped object that exposes the fields the
// fingerprint helper actually reads (body + files). Casting through
// `unknown` keeps the test honest about not pretending to be the full
// Express Request surface.
function makeReq(args: {
  body?: Record<string, unknown>;
  files?: Array<Partial<Express.Multer.File>>;
  file?: Partial<Express.Multer.File>;
}): Request {
  return {
    body: args.body ?? {},
    files: args.files as unknown as Express.Multer.File[] | undefined,
    file: args.file as Express.Multer.File | undefined,
  } as unknown as Request;
}

test("hashMultipartRequest carries the mp: prefix so it cannot collide with JSON-body hashes", () => {
  const fp = hashMultipartRequest(makeReq({}));
  assert.match(fp, /^mp:[0-9a-f]{64}$/);
});

test("hashMultipartRequest is deterministic for equivalent inputs", () => {
  const req = makeReq({
    body: { caption: "hello", visibility: "private" },
    files: [
      {
        fieldname: "files",
        originalname: "doc.pdf",
        mimetype: "application/pdf",
        size: 1234,
        contentHash: "a".repeat(64),
      },
    ],
  });
  assert.equal(hashMultipartRequest(req), hashMultipartRequest(req));
});

test("changing a file's contentHash changes the fingerprint (the data-loss bug Task #165 fixes)", () => {
  const baseFile: Partial<Express.Multer.File> = {
    fieldname: "files",
    originalname: "doc.pdf",
    mimetype: "application/pdf",
    size: 1234,
    contentHash: "a".repeat(64),
  };
  const original = hashMultipartRequest(makeReq({ files: [baseFile] }));
  const replaced = hashMultipartRequest(
    makeReq({ files: [{ ...baseFile, contentHash: "b".repeat(64) }] }),
  );
  assert.notEqual(
    original,
    replaced,
    "Same key, different file content MUST produce a different fingerprint — otherwise idempotency replay silently drops the new upload.",
  );
});

test("file ordering across the same field name does not change the fingerprint", () => {
  // Two files in field `files`, in two orders. The fingerprint must be
  // stable across reorderings so an out-of-order retry still matches
  // the original.
  const files = [
    {
      fieldname: "files",
      originalname: "a.txt",
      mimetype: "text/plain",
      size: 1,
      contentHash: "1".repeat(64),
    },
    {
      fieldname: "files",
      originalname: "b.txt",
      mimetype: "text/plain",
      size: 1,
      contentHash: "2".repeat(64),
    },
  ];
  const a = hashMultipartRequest(makeReq({ files }));
  const b = hashMultipartRequest(makeReq({ files: [...files].reverse() }));
  assert.equal(a, b, "fingerprint must not depend on the input order");
});

test("changing a non-file form field changes the fingerprint", () => {
  const file: Partial<Express.Multer.File> = {
    fieldname: "files",
    originalname: "doc.pdf",
    mimetype: "application/pdf",
    size: 10,
    contentHash: "0".repeat(64),
  };
  const a = hashMultipartRequest(
    makeReq({ body: { caption: "v1" }, files: [file] }),
  );
  const b = hashMultipartRequest(
    makeReq({ body: { caption: "v2" }, files: [file] }),
  );
  assert.notEqual(a, b, "form fields must participate in the fingerprint");
});

test("a file with no contentHash does NOT match a file with a real hash", () => {
  // If a non-hashing storage engine ever leaks back in, the fingerprint
  // must still distinguish "we have no idea what was uploaded" from "we
  // know exactly what was uploaded" — otherwise we'd silently treat
  // every unknown upload as identical.
  const known = hashMultipartRequest(
    makeReq({
      files: [
        {
          fieldname: "f",
          originalname: "x",
          mimetype: "application/octet-stream",
          size: 1,
          contentHash: "c".repeat(64),
        },
      ],
    }),
  );
  const unknown = hashMultipartRequest(
    makeReq({
      files: [
        {
          fieldname: "f",
          originalname: "x",
          mimetype: "application/octet-stream",
          size: 1,
          // no contentHash on purpose
        },
      ],
    }),
  );
  assert.notEqual(known, unknown);
});

test("hashing storage engine attaches a SHA-256 contentHash matching the bytes", async () => {
  // We exercise the storage engine directly via multer's plumbing so
  // this test does not need a running server or database. The engine
  // streams the part to disk while hashing in the same pass.
  const multer = (await import("multer")).default;
  const { Readable } = await import("node:stream");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");

  // Force the temp dir to a per-test scratch location so we don't leak
  // files into the project's tmp/uploads.
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "multipart-fingerprint-"),
  );
  process.env.TMPDIR = scratch;

  // Build a tiny multipart payload manually so we can pipe it through
  // multer.
  const boundary = "----TestBoundary" + crypto.randomUUID();
  const content = Buffer.from("hash me precisely");
  const expected = crypto.createHash("sha256").update(content).digest("hex");
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(
      `Content-Disposition: form-data; name="files"; filename="t.bin"\r\n`,
    ),
    Buffer.from(`Content-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  // Use the real exported uploadArray so this test exercises the actual
  // hashingDiskStorage wired into the production middleware.
  const { uploadArray, ensureTempUploadDir } = await import(
    "../src/lib/uploads.ts"
  );
  await ensureTempUploadDir();

  const handler = uploadArray("files", 5);

  const fakeReq: Record<string, unknown> = Object.assign(
    Readable.from([payload]),
    {
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(payload.length),
      },
      method: "POST",
      url: "/test",
    },
  );
  // multer's `wrapMulter` calls multipartIdempotencyMiddleware, which in
  // turn does `req.headers["idempotency-key"]`. With no key present the
  // middleware short-circuits and lets the chain finish — exactly what
  // we want here, since this test is purely about the storage engine.
  const fakeRes: Record<string, unknown> = {
    on() {
      return fakeRes;
    },
    once() {
      return fakeRes;
    },
    removeListener() {
      return fakeRes;
    },
    setHeader() {},
    getHeader() {},
  };

  await new Promise<void>((resolve, reject) => {
    handler(
      fakeReq as unknown as import("express").Request,
      fakeRes as unknown as import("express").Response,
      (err?: unknown) => {
        if (err) reject(err as Error);
        else resolve();
      },
    );
  });

  const files = (fakeReq as { files?: Express.Multer.File[] }).files ?? [];
  assert.equal(files.length, 1, "expected one parsed file");
  const saved = files[0]!;
  assert.equal(
    saved.contentHash,
    expected,
    "contentHash must match SHA-256 of the streamed bytes",
  );
  assert.equal(saved.size, content.length, "size must reflect bytes written");

  // Reading back the saved file must yield the same bytes (no
  // double-read for the hash; the file on disk IS the source of truth).
  const onDisk = await fs.readFile(saved.path);
  assert.deepEqual(onDisk, content);

  await fs.unlink(saved.path).catch(() => {});
});
