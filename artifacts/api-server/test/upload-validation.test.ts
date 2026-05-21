import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUploadForMediaType } from "../src/lib/file-manager.ts";
import { HttpError } from "../src/lib/http.ts";

// ---------------------------------------------------------------------------
// `validateUploadForMediaType` is now a *blocklist* gate: everything is
// accepted unless the file's extension is on the shared dangerous list
// (executables, shell scripts, web files that can run in a browser).
// MIME types are not consulted here — the magic-byte sniffer that runs
// before us is the authoritative content gate (see upload-magic-bytes).
// ---------------------------------------------------------------------------

function expectBlocked(file: { originalname: string; mimetype?: string }) {
  assert.throws(
    () => validateUploadForMediaType("document", file),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 415);
      const details = error.details as { code?: string; extension?: string } | null;
      assert.equal(details?.code, "UPLOAD_TYPE_BLOCKED");
      assert.match(error.message, /aren't allowed for safety/);
      return true;
    },
  );
}

test("document uploads block .html (browser-runnable web file)", () => {
  expectBlocked({ originalname: "payload.html", mimetype: "text/html" });
});

test("document uploads block .exe even when MIME claims something benign", () => {
  expectBlocked({ originalname: "payload.exe", mimetype: "application/octet-stream" });
});

test("document uploads block dangerous extensions with trailing dots or spaces", () => {
  for (const name of ["payload.exe.", "payload.exe ", "deploy.sh ", "evil.html."]) {
    expectBlocked({ originalname: name, mimetype: "application/octet-stream" });
  }
});

test("document uploads block .bat / .sh / .ps1 / .js shell scripts", () => {
  for (const name of ["run.bat", "deploy.sh", "boot.ps1", "evil.js"]) {
    expectBlocked({ originalname: name, mimetype: "" });
  }
});

test("document uploads block Android .apk and Java .jar", () => {
  expectBlocked({ originalname: "app.apk", mimetype: "" });
  expectBlocked({ originalname: "lib.jar", mimetype: "" });
});

test("photo uploads accept svg at this layer (script payload caught by magic-byte sniffer)", () => {
  // We accept SVG by extension here; the magic-byte sniffer rejects
  // SVGs with <script>/on*=/javascript: payloads before storage. Both
  // gates together are how SVG stays usable for legitimate logos
  // without becoming a script-XSS vector.
  assert.doesNotThrow(() =>
    validateUploadForMediaType("photo", {
      originalname: "logo.svg",
      mimetype: "image/svg+xml",
    }),
  );
});

test("photo uploads accept .jpg even with a wrong-looking MIME (server sniffer is authoritative)", () => {
  // MIME isn't a content check — the magic-byte sniffer above this
  // layer will reject a renamed `.jpg` whose bytes are HTML, with a
  // MAGIC_BYTE_MISMATCH. Blocking on MIME here used to dead-end real
  // uploads from Windows pickers that report `application/octet-stream`.
  assert.doesNotThrow(() =>
    validateUploadForMediaType("photo", {
      originalname: "photo.jpg",
      mimetype: "application/octet-stream",
    }),
  );
});

test("document uploads accept the broad legitimate set (office, text, csv, pdf)", () => {
  for (const f of [
    { originalname: "report.docx", mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { originalname: "report.csv", mimetype: "text/csv" },
    { originalname: "plan.pdf", mimetype: "application/pdf" },
    { originalname: "spec.docx", mimetype: "application/octet-stream" },
    { originalname: "data.csv", mimetype: "" },
  ]) {
    assert.doesNotThrow(() => validateUploadForMediaType("document", f), `${f.originalname} should be accepted`);
  }
});

test("uploads accept HEIC, DWG, ZIP, MP3, and CR2 (per task #363 acceptance)", () => {
  for (const f of [
    { originalname: "burst.heic", mimetype: "image/heic" },
    { originalname: "site.dwg", mimetype: "" }, // browser typically reports no MIME for CAD
    { originalname: "plans.zip", mimetype: "application/zip" },
    { originalname: "voicememo.mp3", mimetype: "audio/mpeg" },
    { originalname: "raw.cr2", mimetype: "" },
  ]) {
    assert.doesNotThrow(() => validateUploadForMediaType("document", f), `${f.originalname} should be accepted`);
    assert.doesNotThrow(() => validateUploadForMediaType("photo", f), `${f.originalname} should be accepted (photo)`);
  }
});

test("blocked rejection messages name the offending extension", () => {
  try {
    validateUploadForMediaType("document", {
      originalname: "payload.exe",
      mimetype: "application/octet-stream",
    });
    assert.fail("expected blocked rejection");
  } catch (err) {
    assert.ok(err instanceof HttpError);
    assert.match(err.message, /\.exe/);
    assert.match(err.message, /ZIP/);
  }
});
