import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { batchProcessWithSSE } from "../src/batch/utils.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const utilsPath = path.resolve(here, "../src/batch/utils.ts");

test("batchProcessWithSSE returns explicit success and failure results", async () => {
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  const results = await batchProcessWithSSE(
    [1, 2, 3],
    async (item) => {
      if (item === 2) {
        throw new Error("item failed");
      }
      return item * 10;
    },
    (event) => events.push(event),
    { retries: 0 },
  );

  assert.deepEqual(results, [
    { ok: true, value: 10 },
    { ok: false, error: "item failed" },
    { ok: true, value: 30 },
  ]);
  assert.deepEqual(
    events.filter((event) => event.type === "progress").map((event) => ({
      result: event.result,
      error: event.error,
    })),
    [
      { result: 10, error: undefined },
      { result: undefined, error: "item failed" },
      { result: 30, error: undefined },
    ],
  );
  assert.deepEqual(events.at(-1), { type: "complete", processed: 3, errors: 1 });
});

test("batchProcessWithSSE processing events do not leak raw items", async () => {
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  await batchProcessWithSSE(
    [{ secret: "client-note" }],
    async () => "ok",
    (event) => events.push(event),
    { retries: 0 },
  );

  assert.deepEqual(
    events.filter((event) => event.type === "processing"),
    [{ type: "processing", index: 0 }],
  );
});

test("batchProcessWithSSE retries rate-limit failures before returning success", async () => {
  let attempts = 0;
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  const results = await batchProcessWithSSE(
    ["job"],
    async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("429 rate limit");
      }
      return "ok";
    },
    (event) => events.push(event),
    { retries: 1, minTimeout: 1, maxTimeout: 1 },
  );

  assert.equal(attempts, 2);
  assert.deepEqual(results, [{ ok: true, value: "ok" }]);
  assert.deepEqual(events.at(-1), { type: "complete", processed: 1, errors: 0 });
});

test("batchProcessWithSSE source does not coerce failures into R", async () => {
  const source = await readFile(utilsPath, "utf8");

  assert.match(source, /Promise<Array<BatchSseResult<R>>>/);
  assert.doesNotMatch(source, /undefined as R/);
});
