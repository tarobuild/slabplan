import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILE_RESPONSE_CSP,
  getServedContentType,
  isSafeInlineContentType,
  resolveSafeFileServingHeaders,
} from "../src/lib/file-serving.ts";

// ---------------------------------------------------------------------------
// getServedContentType: served Content-Type comes from the extension,
// never from caller-supplied/uploader-claimed MIME. Anything outside the
// allowlist (svg, html, exe, …) falls back to application/octet-stream so
// browsers cannot be tricked into rendering executable content inline.
// ---------------------------------------------------------------------------

test("getServedContentType: known image extensions map to image/* types", () => {
  assert.equal(getServedContentType("photo.jpg"), "image/jpeg");
  assert.equal(getServedContentType("photo.JPEG"), "image/jpeg");
  assert.equal(getServedContentType("photo.png"), "image/png");
  assert.equal(getServedContentType("animation.gif"), "image/gif");
  assert.equal(getServedContentType("photo.webp"), "image/webp");
});

test("getServedContentType: known video extensions map to video/* types", () => {
  assert.equal(getServedContentType("clip.mp4"), "video/mp4");
  assert.equal(getServedContentType("clip.m4v"), "video/mp4");
  assert.equal(getServedContentType("clip.webm"), "video/webm");
  assert.equal(getServedContentType("clip.mov"), "video/quicktime");
});

test("getServedContentType: pdf and office document extensions map to safe types", () => {
  assert.equal(getServedContentType("plan.pdf"), "application/pdf");
  assert.equal(
    getServedContentType("contract.docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(
    getServedContentType("budget.xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(getServedContentType("notes.txt"), "text/plain; charset=utf-8");
  assert.equal(getServedContentType("rows.csv"), "text/csv; charset=utf-8");
});

test("getServedContentType: unknown extensions fall back to octet-stream", () => {
  // SVG would carry inline <script>; we never want to serve it as
  // image/svg+xml. The fallback type combined with the disposition
  // override below is the second line of defence (the first is rejection
  // at upload — `.svg` is not in `photoExtensions`).
  assert.equal(getServedContentType("payload.svg"), "application/octet-stream");
  assert.equal(getServedContentType("payload.html"), "application/octet-stream");
  assert.equal(getServedContentType("payload.htm"), "application/octet-stream");
  assert.equal(getServedContentType("payload.js"), "application/octet-stream");
  assert.equal(getServedContentType("payload.exe"), "application/octet-stream");
  assert.equal(getServedContentType("nameless"), "application/octet-stream");
  assert.equal(getServedContentType(""), "application/octet-stream");
});

// ---------------------------------------------------------------------------
// isSafeInlineContentType: only a small allowlist may be served inline.
// Everything else is forced to attachment regardless of caller intent.
// ---------------------------------------------------------------------------

test("isSafeInlineContentType: allowlists images, video, and pdf", () => {
  for (const t of [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "application/pdf",
  ]) {
    assert.equal(isSafeInlineContentType(t), true, `${t} should be safe-inline`);
  }
});

test("isSafeInlineContentType: rejects everything else", () => {
  for (const t of [
    "image/svg+xml",
    "text/html",
    "text/plain",
    "text/csv",
    "application/octet-stream",
    "application/javascript",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]) {
    assert.equal(isSafeInlineContentType(t), false, `${t} should NOT be safe-inline`);
  }
});

// ---------------------------------------------------------------------------
// resolveSafeFileServingHeaders: end-to-end of the policy.
// ---------------------------------------------------------------------------

test("inline jpeg is honoured (legitimate image preview keeps working)", () => {
  const headers = resolveSafeFileServingHeaders({
    originalName: "photo.jpg",
    requestedDisposition: "inline",
  });

  assert.equal(headers.contentType, "image/jpeg");
  assert.equal(headers.disposition, "inline");
  assert.match(headers.contentDispositionHeader, /^inline; filename="photo\.jpg"/);
});

test("inline pdf is honoured (legitimate pdf preview keeps working)", () => {
  const headers = resolveSafeFileServingHeaders({
    originalName: "plan.pdf",
    requestedDisposition: "inline",
  });

  assert.equal(headers.contentType, "application/pdf");
  assert.equal(headers.disposition, "inline");
});

test("inline mp4 is honoured (legitimate video preview keeps working)", () => {
  const headers = resolveSafeFileServingHeaders({
    originalName: "clip.mp4",
    requestedDisposition: "inline",
  });

  assert.equal(headers.contentType, "video/mp4");
  assert.equal(headers.disposition, "inline");
});

test("docx forces attachment even if caller asked for inline", () => {
  const headers = resolveSafeFileServingHeaders({
    originalName: "contract.docx",
    requestedDisposition: "inline",
  });

  assert.equal(
    headers.contentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(headers.disposition, "attachment");
  assert.match(
    headers.contentDispositionHeader,
    /^attachment; filename="contract\.docx"/,
  );
});

test("svg is forced to attachment with octet-stream type (script-XSS guard)", () => {
  // Even if an svg ever slips through upload validation (it shouldn't —
  // `.svg` isn't in any allowed-extension list), the read path has to
  // strip it of any chance to execute by serving as octet-stream and
  // forcing the browser to download it.
  const headers = resolveSafeFileServingHeaders({
    originalName: "payload.svg",
    requestedDisposition: "inline",
  });

  assert.equal(headers.contentType, "application/octet-stream");
  assert.equal(headers.disposition, "attachment");
});

test("renamed html (.jpg extension would have been blocked at upload, but if not...)", () => {
  // `.html` is unknown to the allowlist — the served type is octet-stream,
  // disposition is forced to attachment, and the nosniff header (set on
  // the response by `streamStoredFileToResponse`) prevents the browser
  // from rendering it as text/html.
  const headers = resolveSafeFileServingHeaders({
    originalName: "evil.html",
    requestedDisposition: "inline",
  });

  assert.equal(headers.contentType, "application/octet-stream");
  assert.equal(headers.disposition, "attachment");
});

test("attachment disposition is preserved for safe inline types when caller asked for it", () => {
  const headers = resolveSafeFileServingHeaders({
    originalName: "photo.jpg",
    requestedDisposition: "attachment",
  });

  // The downgrade only ever goes inline → attachment. Caller-requested
  // attachment is always honoured — the download endpoint relies on this.
  assert.equal(headers.contentType, "image/jpeg");
  assert.equal(headers.disposition, "attachment");
  assert.match(
    headers.contentDispositionHeader,
    /^attachment; filename="photo\.jpg"/,
  );
});

test("Content-Disposition strips quote/backslash to keep header well-formed", () => {
  // Filenames with quotes or backslashes could otherwise terminate the
  // quoted-string and inject extra header parameters. The percent-encoded
  // RFC 5987 form preserves the original exactly.
  const headers = resolveSafeFileServingHeaders({
    originalName: 'evil"name\\here.pdf',
    requestedDisposition: "inline",
  });

  assert.match(headers.contentDispositionHeader, /filename="evilnamehere\.pdf"/);
  assert.match(headers.contentDispositionHeader, /filename\*=UTF-8''/);
  assert.ok(
    !headers.contentDispositionHeader.includes('"name\\'),
    "quotes/backslashes must not appear in the legacy filename param",
  );
});

test("missing original name still produces a valid header bundle", () => {
  const headers = resolveSafeFileServingHeaders({
    originalName: "",
    requestedDisposition: "inline",
  });

  assert.equal(headers.contentType, "application/octet-stream");
  assert.equal(headers.disposition, "attachment");
  assert.match(headers.contentDispositionHeader, /^attachment; filename="file"/);
});

// ---------------------------------------------------------------------------
// CSP shape: the constant is exposed to other modules (folder ZIPs use it
// directly), so guard the policy is at least as restrictive as expected.
// ---------------------------------------------------------------------------

test("FILE_RESPONSE_CSP blocks scripts/frames and only allows self-served images/media", () => {
  assert.match(FILE_RESPONSE_CSP, /default-src 'none'/);
  assert.match(FILE_RESPONSE_CSP, /script-src 'none'/);
  assert.match(FILE_RESPONSE_CSP, /frame-ancestors 'none'/);
  assert.match(FILE_RESPONSE_CSP, /img-src 'self'/);
  assert.match(FILE_RESPONSE_CSP, /media-src 'self'/);
  // Sandbox keyword strips the response of script execution, plugins,
  // form submission, and same-origin privileges even if a future browser
  // ignores the disposition + nosniff combination.
  assert.match(FILE_RESPONSE_CSP, /sandbox/);
});
