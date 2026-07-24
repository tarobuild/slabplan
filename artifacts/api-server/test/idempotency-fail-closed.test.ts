import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const sourcePath = path.resolve(import.meta.dirname, "../src/middleware/idempotency.ts");

test("idempotency store failures fail closed for keyed writes", async () => {
  const source = await fs.readFile(sourcePath, "utf8");

  assert.match(
    source,
    /function idempotencyStoreUnavailableError\(operation: string\): HttpError[\s\S]{0,260}"idempotency-store-unavailable"/,
    "middleware must expose a 503 idempotency-store error",
  );
  assert.match(
    source,
    /logger\.error\(\{ err \}, "idempotency reservation failed"\);\s*next\(idempotencyStoreUnavailableError\("reservation"\)\);/,
    "reservation failures must not call the side-effecting route handler",
  );
  assert.match(
    source,
    /logger\.error\(\{ err \}, "idempotency lookup failed"\);\s*next\(idempotencyStoreUnavailableError\("lookup"\)\);/,
    "lookup failures must not call the side-effecting route handler",
  );
  assert.doesNotMatch(
    source,
    /idempotency (?:reservation|lookup) failed"\);\s*next\(\);/,
    "keyed idempotency store errors must not fail open",
  );
});
