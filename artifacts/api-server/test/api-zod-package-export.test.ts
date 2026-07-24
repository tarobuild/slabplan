import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("@workspace/api-zod package export resolves to built JavaScript for Node consumers", () => {
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      [
        "import('@workspace/api-zod').then((m) => {",
        "  if (!m.MAX_UPLOAD_FILE_BYTES || !m.ClientErrorsPostClientErrorBody) throw new Error('missing export');",
        "  console.log('ok');",
        "})",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(output.trim(), "ok");
});
