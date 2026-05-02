import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  ensureTempUploadDir,
  getTempUploadDir,
  uploadSingle,
} from "../src/lib/uploads.ts";
import { HttpError } from "../src/lib/http.ts";
import {
  PROBLEM_TYPE_BASE,
  sendProblem,
  sendUnknownErrorProblem,
} from "../src/lib/problem-json.ts";
import { validateMagicBytesForFile } from "../src/lib/upload-magic-bytes.ts";

let server: Server;
let baseUrl: string;
const tempFiles: string[] = [];

// Minimal but legitimate fixtures whose magic bytes file-type can sniff.
//
// Real, valid headers — not random bytes. We deliberately keep them tiny so
// the test suite stays fast; magic-byte sniffing only inspects the first few
// KB regardless of file size.

// PDF: minimal header + EOF marker. file-type only needs the %PDF- prefix.
const PDF_BYTES = Buffer.from("%PDF-1.4\n%\xC4\xE5\xF2\xE5\xEB\xA7\n%%EOF\n");

// PDF with a leading UTF-8 BOM. Per the PDF spec the `%PDF-` header may
// appear anywhere in the first 1024 bytes, and many real PDFs in the
// wild have a BOM written by older Office or scan-to-PDF pipelines.
const PDF_WITH_BOM_BYTES = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  PDF_BYTES,
]);

// PDF with a few bytes of leading whitespace / blank lines before the
// header — also legal per the spec.
const PDF_WITH_WHITESPACE_BYTES = Buffer.concat([
  Buffer.from("   \r\n\n"),
  PDF_BYTES,
]);

// Minimal "encrypted" PDF: a real %PDF- header with an /Encrypt entry
// in the trailer dictionary. We don't need a full xref / object table —
// the magic-byte layer only inspects the header and looks for the
// `/Encrypt` keyword to flag password-protected files.
const ENCRYPTED_PDF_BYTES = Buffer.from(
  "%PDF-1.6\n" +
    "1 0 obj << /Type /Catalog >> endobj\n" +
    "trailer << /Size 1 /Root 1 0 R /Encrypt 2 0 R >>\n" +
    "%%EOF\n",
);

// PNG: 8-byte signature + IHDR chunk + IEND. Smallest viable PNG sniffer
// will recognise.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// JPEG: SOI + minimal APP0/JFIF + EOI. file-type recognises by SOI alone
// (FF D8 FF).
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

// GIF: GIF89a header + minimal logical screen descriptor + trailer.
const GIF_BYTES = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

// WebP: RIFF container with WEBP fourCC + a minimal VP8L block.
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
  0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x08,
  0x00, 0x00,
]);

// MP4: ftyp box with isom brand. Detected via offset-4 'ftyp' marker.
const MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31,
]);

// MOV: same ftyp box layout but qt brand → file-type returns video/quicktime.
const MOV_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70,
  0x71, 0x74, 0x20, 0x20, 0x00, 0x00, 0x02, 0x00,
  0x71, 0x74, 0x20, 0x20,
]);

// WebM: EBML header → DocType "webm".
const WEBM_BYTES = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81,
  0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
  0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84,
  0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x02,
  0x42, 0x85, 0x81, 0x02,
]);

// "Renamed HTML" payload: a real HTML document a user tried to slip past
// the upload form by claiming it's a JPEG.
const HTML_BYTES = Buffer.from(
  "<!doctype html><html><body><script>alert(1)</script></body></html>",
);

// Truncated/garbage PDF — starts with the right magic but file-type may or
// may not recognise it; we use this to assert "looks like nothing" gets a
// clean rejection rather than a 500.
const CORRUPT_BYTES = Buffer.from([
  0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00,
  0xfa, 0xce, 0xfe, 0xed, 0x12, 0x34, 0x56, 0x78,
]);

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  await ensureTempUploadDir();

  const app = express();

  app.post("/upload", uploadSingle("file"), (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof HttpError) {
        sendProblem(res, req, err);
        return;
      }
      sendUnknownErrorProblem(res, req, err);
    },
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  // Clean up any direct-on-disk fixtures we created for the unit tests.
  await Promise.all(
    tempFiles.map((p) =>
      fs.unlink(p).catch((err: NodeJS.ErrnoException) => {
        if (err?.code !== "ENOENT") throw err;
      }),
    ),
  );
});

async function uploadFile(
  name: string,
  mime: string,
  bytes: Buffer,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
  return fetch(`${baseUrl}/upload`, { method: "POST", body: form });
}

async function readJson(response: Response): Promise<{
  type: string;
  status: number;
  detail: string;
  errors?: { code?: string; sniffedMimeType?: string | null };
}> {
  return (await response.json()) as {
    type: string;
    status: number;
    detail: string;
    errors?: { code?: string; sniffedMimeType?: string | null };
  };
}

// ---------------------------------------------------------------------------
// End-to-end through multer: legit fixtures pass, mismatches return 415.
// ---------------------------------------------------------------------------

test("legitimate PDF upload passes magic-byte validation", async () => {
  const response = await uploadFile("doc.pdf", "application/pdf", PDF_BYTES);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("PDF with a leading UTF-8 BOM passes magic-byte validation", async () => {
  // Many real PDFs (especially older Office exports and scan-to-PDF
  // pipelines) emit a BOM before the %PDF- header. The PDF spec allows
  // up to ~1 KB of preamble, so this must be accepted.
  const response = await uploadFile(
    "bom.pdf",
    "application/pdf",
    PDF_WITH_BOM_BYTES,
  );
  assert.equal(response.status, 200);
});

test("PDF with leading whitespace before the header passes magic-byte validation", async () => {
  const response = await uploadFile(
    "padded.pdf",
    "application/pdf",
    PDF_WITH_WHITESPACE_BYTES,
  );
  assert.equal(response.status, 200);
});

test("encrypted PDF returns an actionable 415 about removing the password", async () => {
  const response = await uploadFile(
    "secret.pdf",
    "application/pdf",
    ENCRYPTED_PDF_BYTES,
  );
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "MAGIC_BYTE_MISMATCH");
  assert.match(body.detail, /password/i);
});

test("legitimate JPEG upload passes magic-byte validation", async () => {
  const response = await uploadFile("photo.jpg", "image/jpeg", JPEG_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate PNG upload passes magic-byte validation", async () => {
  const response = await uploadFile("photo.png", "image/png", PNG_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate GIF upload passes magic-byte validation", async () => {
  const response = await uploadFile("photo.gif", "image/gif", GIF_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate WebP upload passes magic-byte validation", async () => {
  const response = await uploadFile("photo.webp", "image/webp", WEBP_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate MP4 upload passes magic-byte validation", async () => {
  const response = await uploadFile("clip.mp4", "video/mp4", MP4_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate WebM upload passes magic-byte validation", async () => {
  const response = await uploadFile("clip.webm", "video/webm", WEBM_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate MOV upload passes magic-byte validation", async () => {
  const response = await uploadFile("clip.mov", "video/quicktime", MOV_BYTES);
  assert.equal(response.status, 200);
});

test("renamed HTML masquerading as a JPEG is rejected with 415 problem+json", async () => {
  const response = await uploadFile("photo.jpg", "image/jpeg", HTML_BYTES);
  assert.equal(response.status, 415);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/problem\+json/,
  );

  const body = await readJson(response);
  assert.equal(body.status, 415);
  assert.equal(body.type, `${PROBLEM_TYPE_BASE}/unsupported-media-type`);
  assert.equal(body.errors?.code, "MAGIC_BYTE_MISMATCH");
  assert.match(body.detail, /JPEG/);
});

test("PNG bytes uploaded with a .pdf extension are rejected as not-a-PDF", async () => {
  // Client claims it's a PDF (extension + MIME) but the bytes are PNG.
  // PDFs use a tolerant header scan (no `file-type` lookup) so the
  // sniffedMimeType is null — what matters is that we still reject the
  // file with a PDF-specific message instead of accepting it.
  const response = await uploadFile("invoice.pdf", "application/pdf", PNG_BYTES);
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "MAGIC_BYTE_MISMATCH");
  assert.equal(body.errors?.sniffedMimeType, null);
  assert.match(body.detail, /PDF/);
});

test("video file extension with non-video bytes is rejected", async () => {
  const response = await uploadFile("clip.mp4", "video/mp4", HTML_BYTES);
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "MAGIC_BYTE_MISMATCH");
});

test("corrupt/garbage bytes claimed as a PDF are rejected with a clean 415", async () => {
  const response = await uploadFile("doc.pdf", "application/pdf", CORRUPT_BYTES);
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.status, 415);
  assert.equal(body.errors?.code, "MAGIC_BYTE_MISMATCH");
  // No sniffable type recognised — surface that as null rather than a 500.
  assert.equal(body.errors?.sniffedMimeType, null);
});

test("MIME claims a sniffable type even when extension is foreign — sniffer still runs", async () => {
  // Documents the intended precedence: this layer treats a request as
  // sniffable if EITHER the MIME or the extension falls in a watched
  // category. So a client claiming `image/png` with a `.bin` extension
  // is still subject to magic-byte verification — they cannot bypass
  // sniffing by lying about the extension. The companion
  // `validateUploadForMediaType` extension/MIME pairing check is what
  // enforces the broader contract on each route.
  const response = await uploadFile("payload.bin", "image/png", HTML_BYTES);
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "MAGIC_BYTE_MISMATCH");
});

test("extension claims a sniffable type even when MIME is octet-stream — sniffer still runs", async () => {
  // Mirror of the above: a client uploading raw bytes with a
  // generic application/octet-stream MIME but a .png extension
  // still gets sniffed. Renaming-attack defence does not depend
  // on the client setting a specific Content-Type.
  const response = await uploadFile(
    "fake.png",
    "application/octet-stream",
    HTML_BYTES,
  );
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "MAGIC_BYTE_MISMATCH");
});

test("non-sniffable types (csv/txt/docx) are not blocked by magic-byte sniff", async () => {
  // .csv has no reliable magic bytes; the magic-byte layer must let it
  // through so the existing extension+MIME validator can decide. The
  // upload route here doesn't run that secondary validator, so a
  // straight 200 confirms magic-byte sniffing didn't reject it.
  const csvBytes = Buffer.from("name,age\nalice,30\nbob,25\n");
  const response = await uploadFile("data.csv", "text/csv", csvBytes);
  assert.equal(response.status, 200);
});

// ---------------------------------------------------------------------------
// Direct unit checks on the validator — easier to reason about edge cases
// without going through HTTP.
// ---------------------------------------------------------------------------

async function writeTemp(name: string, bytes: Buffer): Promise<string> {
  const dir = getTempUploadDir();
  await fs.mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, `magic-test-${Date.now()}-${name}`);
  await fs.writeFile(fullPath, bytes);
  tempFiles.push(fullPath);
  return fullPath;
}

function fakeMulterFile(opts: {
  originalname: string;
  mimetype: string;
  filePath: string;
  size: number;
}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: opts.originalname,
    encoding: "7bit",
    mimetype: opts.mimetype,
    size: opts.size,
    destination: path.dirname(opts.filePath),
    filename: path.basename(opts.filePath),
    path: opts.filePath,
    buffer: Buffer.alloc(0),
    stream: undefined as never,
  };
}

test("validateMagicBytesForFile passes for legitimate files (unit)", async () => {
  const filePath = await writeTemp("real.png", PNG_BYTES);
  await assert.doesNotReject(() =>
    validateMagicBytesForFile(
      fakeMulterFile({
        originalname: "photo.png",
        mimetype: "image/png",
        filePath,
        size: PNG_BYTES.length,
      }),
    ),
  );
});

test("validateMagicBytesForFile rejects renamed payload (unit)", async () => {
  const filePath = await writeTemp("renamed.jpg", HTML_BYTES);
  await assert.rejects(
    () =>
      validateMagicBytesForFile(
        fakeMulterFile({
          originalname: "photo.jpg",
          mimetype: "image/jpeg",
          filePath,
          size: HTML_BYTES.length,
        }),
      ),
    (err: unknown) =>
      err instanceof HttpError &&
      err.statusCode === 415 &&
      err.type === "unsupported-media-type",
  );
});

test("validateMagicBytesForFile skips non-sniffable types (unit)", async () => {
  const filePath = await writeTemp("plain.txt", Buffer.from("hello world"));
  await assert.doesNotReject(() =>
    validateMagicBytesForFile(
      fakeMulterFile({
        originalname: "notes.txt",
        mimetype: "text/plain",
        filePath,
        size: 11,
      }),
    ),
  );
});

test("validateMagicBytesForFile flags missing path as a server bug (unit)", async () => {
  await assert.rejects(
    () =>
      validateMagicBytesForFile(
        fakeMulterFile({
          originalname: "photo.png",
          mimetype: "image/png",
          filePath: "",
          size: 0,
        }),
      ),
    (err: unknown) => err instanceof HttpError && err.statusCode === 500,
  );
});
