import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AccountTokensCreateBody,
  AccountTokensListResponse,
} from "../src/generated/api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.resolve(here, "../src/generated");
const generatedTypesDir = path.join(generatedDir, "types");

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

test("generated date-time schemas keep JSON wire values as ISO strings", () => {
  const iso = "2026-05-18T12:34:56.000Z";

  const createBody = AccountTokensCreateBody.parse({
    name: "Build audit",
    expiresAt: iso,
  });
  assert.equal(createBody.expiresAt, iso);
  assert.equal(typeof createBody.expiresAt, "string");

  const listResponse = AccountTokensListResponse.parse({
    tokens: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Build audit",
        scope: "read_write",
        tokenPrefix: "cs_pat_",
        lastFour: "abcd",
        expiresAt: iso,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: iso,
      },
    ],
  });
  assert.equal(listResponse.tokens[0]?.expiresAt, iso);
  assert.equal(listResponse.tokens[0]?.createdAt, iso);
  assert.equal(typeof listResponse.tokens[0]?.createdAt, "string");
});

test("generated api-zod types do not expose date-time fields as Date objects", () => {
  const apiSource = readFileSync(path.join(generatedDir, "api.ts"), "utf8");
  assert.doesNotMatch(apiSource, /zod\.coerce\s*\.date|zod\.coerce\.date|zod\.date\(/);

  for (const entry of readdirSync(generatedTypesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;

    const source = stripComments(
      readFileSync(path.join(generatedTypesDir, entry.name), "utf8"),
    );
    assert.doesNotMatch(
      source,
      /\bDate\b/,
      `${entry.name} should model JSON dates as string wire values`,
    );
  }
});
