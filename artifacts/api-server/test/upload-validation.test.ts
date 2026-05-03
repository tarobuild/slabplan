import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUploadForMediaType } from "../src/lib/file-manager.ts";
import { HttpError } from "../src/lib/http.ts";

test("document uploads reject executable html", () => {
  assert.throws(
    () =>
      validateUploadForMediaType("document", {
        originalname: "payload.html",
        mimetype: "text/html",
      }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("photo uploads accept svg at the allowlist layer (content safety enforced by magic-byte sniffer)", () => {
  // We now accept SVG by extension/MIME because the magic-byte sniffer
  // is the authoritative content gate (it rejects SVGs containing
  // <script>, on*= handlers, or javascript: URLs). Blocking SVG here
  // would have prevented users from uploading legitimate vector logos
  // and diagrams.
  assert.doesNotThrow(() =>
    validateUploadForMediaType("photo", {
      originalname: "logo.svg",
      mimetype: "image/svg+xml",
    }),
  );
});

test("photo uploads reject mismatched mime types", () => {
  assert.throws(
    () =>
      validateUploadForMediaType("photo", {
        originalname: "payload.jpg",
        mimetype: "text/html",
      }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("document uploads reject mismatched extensions", () => {
  assert.throws(
    () =>
      validateUploadForMediaType("document", {
        originalname: "payload.html",
        mimetype: "application/pdf",
      }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("document uploads still allow office and text files", () => {
  assert.doesNotThrow(() =>
    validateUploadForMediaType("document", {
      originalname: "report.docx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );

  assert.doesNotThrow(() =>
    validateUploadForMediaType("document", {
      originalname: "report.csv",
      mimetype: "text/csv",
    }),
  );
});

test("document uploads accept .docx with application/octet-stream MIME", () => {
  // Some Windows file pickers report a generic MIME for legitimate
  // .docx files. The server-side magic-byte sniffer (and the PDF
  // header check) is the authoritative content gate, so a recognised
  // document extension must not be blocked here just because the
  // browser failed to label it.
  assert.doesNotThrow(() =>
    validateUploadForMediaType("document", {
      originalname: "spec.docx",
      mimetype: "application/octet-stream",
    }),
  );
});

test("document uploads accept .csv with an empty MIME (Safari)", () => {
  assert.doesNotThrow(() =>
    validateUploadForMediaType("document", {
      originalname: "data.csv",
      mimetype: "",
    }),
  );
});

test("document uploads accept .pdf with application/octet-stream MIME", () => {
  assert.doesNotThrow(() =>
    validateUploadForMediaType("document", {
      originalname: "plan.pdf",
      mimetype: "application/octet-stream",
    }),
  );
});

test("document uploads still reject .exe even with application/octet-stream MIME", () => {
  // Loosening the MIME check must not loosen the extension check —
  // a renamed executable still has a non-document extension and must
  // be refused.
  assert.throws(
    () =>
      validateUploadForMediaType("document", {
        originalname: "payload.exe",
        mimetype: "application/octet-stream",
      }),
    (error) => error instanceof HttpError && error.statusCode === 400,
  );
});
