import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");

test("Replit mobile artifact owns the Expo preview root", () => {
  const artifact = readFileSync(
    resolve(mobileRoot, ".replit-artifact/artifact.toml"),
    "utf8",
  );

  assert.match(artifact, /router = "expo-domain"/);
  assert.match(artifact, /ensurePreviewReachable = "\/status"/);
  assert.match(artifact, /paths = \[ "\/" \]/);
  assert.match(
    artifact,
    /run = "pnpm --filter @workspace\/cadstone-mobile run start:replit"/,
  );
  assert.match(
    artifact,
    /EXPO_PUBLIC_SLABPLAN_API_BASE_URL = "https:\/\/slabplan-api-production\.up\.railway\.app"/,
  );
});

test("Replit mobile start runs the native-manifest proxy", () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(mobileRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.equal(
    packageJson.scripts?.["start:replit"],
    "node scripts/replit-expo-proxy.mjs",
  );
});
