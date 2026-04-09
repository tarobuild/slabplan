import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeDownloadFilename } from "../src/lib/downloads.ts";

test("sanitizeDownloadFilename replaces unsafe characters", () => {
  assert.equal(
    sanitizeDownloadFilename('quoted"\nsemi;colon?.pdf'),
    "quoted__semi_colon_.pdf",
  );
});
