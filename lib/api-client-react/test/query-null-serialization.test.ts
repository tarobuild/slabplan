import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { getDailyLogsGetDailyLogsFeedUrl } from "../src/generated/api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedApiPath = path.resolve(here, "../src/generated/api.ts");

test("generated URL builders omit nullable query params instead of serializing null", async () => {
  assert.equal(
    getDailyLogsGetDailyLogsFeedUrl({ from: null, to: null }),
    "/api/daily-logs/feed",
  );
  assert.equal(
    getDailyLogsGetDailyLogsFeedUrl({
      from: "2026-05-01",
      to: "2026-05-18",
    }),
    "/api/daily-logs/feed?from=2026-05-01&to=2026-05-18",
  );

  const source = await readFile(generatedApiPath, "utf8");
  assert.doesNotMatch(source, /value === null \? "null"/);
  assert.match(source, /if \(value != null\)/);
});
