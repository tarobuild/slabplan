import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "wipe-and-seed-admins.mjs"), "utf8");

test("admin seed persists only invite token hash and expiration", () => {
  assert.match(source, /invite_token_hash, invite_token, invite_token_expires_at/);
  assert.match(source, /true, \$4, NULL, \$5, NULL\)/);
  assert.match(source, /invite\.tokenHash/);
  assert.match(source, /invite\.expiresAt/);
  assert.doesNotMatch(source, /invite\.token,\s*\n\s*invite\.expiresAt/);
});

test("raw invite token is only used for the one-time invite URL", () => {
  assert.match(source, /accept-invite\?token=\$\{encodeURIComponent\(invite\.token\)\}/);
});

test("invite links require an explicit public app URL", () => {
  assert.match(source, /const PUBLIC_HOST = process\.env\.APP_PUBLIC_URL\?\.trim\(\)/);
  assert.match(source, /APP_PUBLIC_URL is required so invite links never point at the legacy product/);
  assert.doesNotMatch(source, /cadstonesystems\.com/);
});
