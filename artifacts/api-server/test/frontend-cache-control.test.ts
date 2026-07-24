import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "frontend-cache-control-test-secret";
process.env.JWT_REFRESH_SECRET = "frontend-cache-control-test-refresh-secret";
process.env.JWT_UPLOAD_SECRET = "frontend-cache-control-test-upload-secret";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-key";

const { frontendCacheControlForFile } = await import("../src/app.ts");

test("frontend app shell is always revalidated after deployments", () => {
  assert.equal(
    frontendCacheControlForFile(path.join("dist", "public", "index.html")),
    "no-store, max-age=0, must-revalidate",
  );
});

test("fingerprinted frontend assets can be cached immutably", () => {
  assert.equal(
    frontendCacheControlForFile(path.join("dist", "public", "assets", "index-a13d0e67.js")),
    "public, max-age=31536000, immutable",
  );
});

test("non-fingerprinted public frontend files must revalidate", () => {
  assert.equal(
    frontendCacheControlForFile(path.join("dist", "public", "cad-logo.png")),
    "no-cache, max-age=0, must-revalidate",
  );
});
