import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DANGEROUS_UPLOAD_EXTENSIONS,
  DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES,
  DIRECT_UPLOAD_EDGE_LIMIT_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  WIDE_UPLOAD_ACCEPT_EXTENSIONS,
  isDangerousUploadFileName,
  videoDurationLimitLabel,
} from "../src/uploads.ts";

test("hosted resumable uploads allow 500 GiB files and unlimited video length", () => {
  assert.equal(MAX_UPLOAD_FILE_BYTES, 500 * 1024 * 1024 * 1024);
  assert.equal(Number.isFinite(MAX_VIDEO_DURATION_SECONDS), false);
  assert.equal(videoDurationLimitLabel(), "unlimited");
});

test("svg uploads are blocked as executable web content", () => {
  assert.equal(isDangerousUploadFileName("payload.svg"), true);
  assert.equal(DANGEROUS_UPLOAD_EXTENSIONS.has(".svg"), true);
});

test("wide upload accept list does not advertise dangerous extensions", () => {
  const advertisedDangerousExtensions = WIDE_UPLOAD_ACCEPT_EXTENSIONS.filter((extension) =>
    DANGEROUS_UPLOAD_EXTENSIONS.has(extension),
  );

  assert.deepEqual(advertisedDangerousExtensions, []);
});

test("direct multipart threshold stays below the production edge request cap", () => {
  assert.equal(DIRECT_UPLOAD_EDGE_LIMIT_BYTES, 32 * 1024 * 1024);
  assert.equal(DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES, 24 * 1024 * 1024);
  assert.ok(DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES < DIRECT_UPLOAD_EDGE_LIMIT_BYTES);
});
