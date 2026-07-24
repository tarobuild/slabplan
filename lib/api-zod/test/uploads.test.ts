import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DANGEROUS_UPLOAD_EXTENSIONS,
  DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES,
  DIRECT_UPLOAD_EDGE_LIMIT_BYTES,
  WIDE_UPLOAD_ACCEPT_EXTENSIONS,
  isDangerousUploadFileName,
} from "../src/uploads.ts";

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
