import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  main: string;
  "react-native": string;
};

test("@workspace/api-client-react package export resolves to built JavaScript for Node consumers", () => {
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      [
        "import('@workspace/api-client-react').then((mod) => {",
        "  if (typeof mod.customFetch !== 'function') throw new Error('missing customFetch export');",
        "  if (typeof mod.setBaseUrl !== 'function') throw new Error('missing setBaseUrl export');",
        "  console.log('ok');",
        "})",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(output.trim(), "ok");
});

test("@workspace/api-client-react exposes runtime entrypoints for Node and Metro", () => {
  assert.equal(packageJson.main, "./dist/index.js");
  assert.equal(packageJson["react-native"], "./src/index.ts");
  assert.equal(existsSync(join(import.meta.dirname, "..", packageJson.main)), true);
  assert.equal(existsSync(join(import.meta.dirname, "..", packageJson["react-native"])), true);
});
