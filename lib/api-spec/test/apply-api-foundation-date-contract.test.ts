import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, "../scripts/apply-api-foundation.mjs");

test("apply-api-foundation emits calendar query dates as strings with YYYY-MM-DD pattern", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.match(source, /function calendarDateQuerySchema\(\) \{[\s\S]*?type: "string"[\s\S]*?pattern: "\^\\\\d\{4\}-\\\\d\{2\}-\\\\d\{2\}\$"/);

  for (const name of ["from", "to", "start", "end"]) {
    assert.match(
      source,
      new RegExp(`name: "${name}", schema: calendarDateQuerySchema\\(\\)`),
    );
  }

  assert.doesNotMatch(source, /name: "(?:from|to|start|end)", schema: \{ type: "string", format: "date" \}/);
});
