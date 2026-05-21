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

// BMP: BITMAPFILEHEADER (BM + size + reserved + offset) is enough for
// file-type to confidently report image/bmp.
const BMP_BYTES = Buffer.concat([
  Buffer.from([0x42, 0x4d]),
  Buffer.from([0x46, 0x00, 0x00, 0x00]),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x36, 0x00, 0x00, 0x00]),
  Buffer.alloc(40, 0),
  Buffer.alloc(16, 0xff),
]);

// TIFF: little-endian II*\0 + minimal IFD pointer. file-type only inspects
// the leading 4 bytes for TIFF identification.
const TIFF_BYTES = Buffer.concat([
  Buffer.from([0x49, 0x49, 0x2a, 0x00]),
  Buffer.from([0x08, 0x00, 0x00, 0x00]),
  Buffer.alloc(32, 0),
]);

// DOCX / ZIP fixtures use fflate's zipSync so they have valid CRCs and
// central directories — i.e. they survive a real unzip. The OOXML
// validator parses these archives in full, so anything less would fail
// for the wrong reason.
import { zipSync, strToU8 } from "fflate";

const DOCX_BYTES = Buffer.from(
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="R1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    ),
    "word/document.xml": strToU8(
      '<?xml version="1.0"?><document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    ),
  }),
);

const BARE_ZIP_BYTES = Buffer.from(
  zipSync({ "hello.txt": strToU8("hi") }),
);

// A zip whose [Content_Types].xml carries ONLY the generic OPC
// content-types namespace (no per-part Override naming
// wordprocessingml/spreadsheetml/presentationml). Every well-formed
// OPC package — ODF, EPUB, oTherwise — can carry this namespace, so
// matching on it alone would let any well-formed OPC zip pose as a
// .docx. The validator must reject this.
const OPC_ONLY_ZIP_BYTES = Buffer.from(
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        "</Types>",
    ),
    "payload.xml": strToU8("<x/>"),
  }),
);

const ODT_BYTES = Buffer.from(
  zipSync({
    // ODF spec: `mimetype` must be the first entry, stored
    // (uncompressed). fflate auto-stores this entry because we mark it
    // with level: 0.
    mimetype: [
      strToU8("application/vnd.oasis.opendocument.text"),
      { level: 0 },
    ] as unknown as Uint8Array,
    "content.xml": strToU8('<?xml version="1.0"?><document/>'),
  }),
);

// OLE2 compound document magic — enough for our header check to pass.
const OLE2_BYTES = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(64, 0),
]);

// SVG with an inline <script> — must be rejected even though it has a
// well-formed <svg> root element.
const SVG_UNSAFE_BYTES = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

const SVG_SAFE_BYTES = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
);

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
  assert.equal(body.errors?.code, "UPLOAD_PDF_ENCRYPTED");
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

test("legitimate BMP upload passes magic-byte validation", async () => {
  const response = await uploadFile("photo.bmp", "image/bmp", BMP_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate TIFF upload passes magic-byte validation", async () => {
  const response = await uploadFile("scan.tiff", "image/tiff", TIFF_BYTES);
  assert.equal(response.status, 200);
});

test("legitimate DOCX upload passes magic-byte validation", async () => {
  const response = await uploadFile(
    "estimate.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    DOCX_BYTES,
  );
  assert.equal(response.status, 200);
});

test("legitimate ODT upload passes magic-byte validation", async () => {
  const response = await uploadFile(
    "estimate.odt",
    "application/vnd.oasis.opendocument.text",
    ODT_BYTES,
  );
  assert.equal(response.status, 200);
});

test("bare .zip masquerading as ODT is rejected as not-an-OpenDocument-file", async () => {
  const response = await uploadFile(
    "fake.odt",
    "application/vnd.oasis.opendocument.text",
    BARE_ZIP_BYTES,
  );
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "UPLOAD_TYPE_NOT_ALLOWED");
});

test("legitimate legacy DOC (OLE2) upload passes magic-byte validation", async () => {
  const response = await uploadFile("legacy.doc", "application/msword", OLE2_BYTES);
  assert.equal(response.status, 200);
});

test("bare .zip masquerading as DOCX is rejected as not-an-Office-document", async () => {
  const response = await uploadFile(
    "fake.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    BARE_ZIP_BYTES,
  );
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "UPLOAD_TYPE_NOT_ALLOWED");
  assert.match(body.detail, /Office|archive/i);
});

test("OPC-only zip (no Office part Override) is rejected as not-an-Office-document", async () => {
  // Regression: an earlier version matched on the generic OPC
  // content-types namespace alone, which would have let any OPC
  // package (ODF, EPUB, etc.) pose as a .docx.
  const response = await uploadFile(
    "fake.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    OPC_ONLY_ZIP_BYTES,
  );
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "UPLOAD_TYPE_NOT_ALLOWED");
});

test("DOCX bytes uploaded as .xlsx are rejected with UPLOAD_TYPE_MISMATCH", async () => {
  const response = await uploadFile(
    "wrong.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    DOCX_BYTES,
  );
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "UPLOAD_TYPE_MISMATCH");
});

test("SVG with inline <script> is rejected with UPLOAD_SVG_UNSAFE", async () => {
  const response = await uploadFile("logo.svg", "image/svg+xml", SVG_UNSAFE_BYTES);
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "UPLOAD_SVG_UNSAFE");
});

test("SVG with inline <script> after the first scan chunk is rejected", async () => {
  const paddedSvg = Buffer.concat([
    Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">'),
    Buffer.from("<!--"),
    Buffer.alloc(70 * 1024, 0x20),
    Buffer.from('--><script>alert(1)</script></svg>'),
  ]);
  const response = await uploadFile("logo.svg", "image/svg+xml", paddedSvg);
  assert.equal(response.status, 415);
  const body = await readJson(response);
  assert.equal(body.errors?.code, "UPLOAD_SVG_UNSAFE");
});

test("safe SVG passes magic-byte validation", async () => {
  const response = await uploadFile("logo.svg", "image/svg+xml", SVG_SAFE_BYTES);
  assert.equal(response.status, 200);
});

test("PDF with header at byte 4096 (within 8 KB scan window) is accepted", async () => {
  // The 1 KB scan window used to reject this; the 8 KB scan window
  // tolerates real-world PDFs with a long preamble (mail header
  // remnants, scanner postamble, etc.).
  const padded = Buffer.concat([Buffer.alloc(4096, 0x20), PDF_BYTES]);
  const response = await uploadFile("padded-far.pdf", "application/pdf", padded);
  assert.equal(response.status, 200);
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

test("validateMagicBytesForFile rejects a binary payload renamed to .txt (unit)", async () => {
  // A real ELF/PE-like binary blob (NUL bytes + control bytes throughout)
  // renamed to a .txt extension must be rejected with UPLOAD_BINARY_AS_TEXT,
  // even though .txt is not in any sniffable category. Without this
  // check, the route-level allowlist would accept the file when MIME is
  // empty / `application/octet-stream`.
  const binary = Buffer.alloc(2048);
  for (let i = 0; i < binary.length; i++) binary[i] = i % 256;
  const filePath = await writeTemp("payload.txt", binary);
  await assert.rejects(
    () =>
      validateMagicBytesForFile(
        fakeMulterFile({
          originalname: "payload.txt",
          mimetype: "text/plain",
          filePath,
          size: binary.length,
        }),
      ),
    (err: unknown) =>
      err instanceof HttpError &&
      err.statusCode === 415 &&
      (err.details as { code?: string } | undefined)?.code ===
        "UPLOAD_BINARY_AS_TEXT",
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
