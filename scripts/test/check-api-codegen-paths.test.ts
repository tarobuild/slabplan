import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, "../src/check-api-codegen.ts");

test("check-api-codegen watches generated package entrypoints as well as generated dirs", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /"lib\/api-client-react\/src\/generated"/);
  assert.match(source, /"lib\/api-client-react\/src\/index\.ts"/);
  assert.match(source, /"lib\/api-zod\/src\/generated"/);
  assert.match(source, /"lib\/api-zod\/src\/index\.ts"/);
  assert.match(source, /captureGitStatus\(GENERATED_PATHS\)/);
});
