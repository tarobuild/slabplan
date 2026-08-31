import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

test("production responses enable HSTS while local development remains unaffected", () => {
  assert.match(source, /hsts: isProd/);
  assert.match(source, /maxAge: 31_536_000/);
  assert.match(source, /includeSubDomains: false/);
});
