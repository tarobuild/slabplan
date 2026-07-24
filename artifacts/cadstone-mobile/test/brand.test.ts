import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { appBrand, loginContent } from "../src/lib/brand";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");

test("mobile login uses the branded SlabPlan sign-in copy", () => {
  assert.equal(appBrand.fullName, "SlabPlan");
  assert.equal(loginContent.title, "Sign in");
  assert.equal(loginContent.subtitle, "Welcome back to SlabPlan.");
  assert.equal(loginContent.emailLabel, "Email");
  assert.equal(loginContent.emailPlaceholder, "Enter your email");
  assert.equal(loginContent.passwordLabel, "Password");
  assert.equal(loginContent.submitLabel, "Sign in");
});

test("mobile app bundles its own SlabPlan logo asset", () => {
  const logoPath = resolve(mobileRoot, "assets/slabplan-logo.png");
  assert.equal(existsSync(logoPath), true);

  const logoHeader = readFileSync(logoPath).subarray(0, 8);
  assert.deepEqual([...logoHeader], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});
