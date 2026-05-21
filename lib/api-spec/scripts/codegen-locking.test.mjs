import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(root, relPath), "utf8"));
}

describe("API generated-file locking", () => {
  it("makes codegen wait on the generated files lock instead of failing immediately", () => {
    const source = readFileSync(path.join(here, "codegen.mjs"), "utf8");

    assert.match(source, /LOCK_WAIT_TIMEOUT_MS/)
    assert.match(source, /sleepSync\(LOCK_WAIT_POLL_MS\)/)
    assert.doesNotMatch(source, /Another API codegen process is already running/)
  })

  it("wraps local generated-file readers with the same lock", () => {
    const rootPackage = readJson("package.json");
    const appPackage = readJson("artifacts/cadstone/package.json");
    const apiPackage = readJson("artifacts/api-server/package.json");

    assert.match(rootPackage.scripts.typecheck, /with-codegen-lock\.mjs/)
    assert.match(rootPackage.scripts.build, /with-codegen-lock\.mjs/)
    assert.match(appPackage.scripts.typecheck, /with-codegen-lock\.mjs/)
    assert.match(appPackage.scripts.build, /with-codegen-lock\.mjs/)
    assert.match(appPackage.scripts["check-eager-bundle"], /with-codegen-lock\.mjs/)
    assert.match(apiPackage.scripts.typecheck, /with-codegen-lock\.mjs/)
    assert.match(apiPackage.scripts.build, /with-codegen-lock\.mjs/)
  })

  it("marks nested commands as lock-held so wrapped scripts do not deadlock", () => {
    const wrapper = readFileSync(path.join(here, "with-codegen-lock.mjs"), "utf8");

    assert.match(wrapper, /API_CODEGEN_LOCK_HELD !== "1"/)
    assert.match(wrapper, /API_CODEGEN_LOCK_HELD: "1"/)
  })
})
