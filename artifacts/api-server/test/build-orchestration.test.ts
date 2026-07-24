import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function readPackageJson(relativePath: string) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8")) as {
    scripts?: Record<string, string>;
  };
}

test("workspace build builds the web app once before the API bundle", async () => {
  const rootPackage = await readPackageJson("package.json");
  const apiServerPackage = await readPackageJson("artifacts/api-server/package.json");

  const rootBuild = rootPackage.scripts?.build ?? "";
  const apiServerBuild = apiServerPackage.scripts?.build ?? "";

  assert.match(apiServerBuild, /with-codegen-lock\.mjs -- node \.\/build\.mjs$/);
  assert.doesNotMatch(apiServerBuild, /@workspace\/cadstone/);

  const webBuildIndex = rootBuild.indexOf("pnpm run build:web");
  const apiServerBuildIndex = rootBuild.indexOf("pnpm run build:api");

  assert.notEqual(webBuildIndex, -1);
  assert.notEqual(apiServerBuildIndex, -1);
  assert.ok(webBuildIndex < apiServerBuildIndex);
});
