import assert from "node:assert/strict";
import { test } from "node:test";

const SCRIPT_PATH = "../scripts/reset-db.mjs";

async function loadScript() {
  return await import(`${SCRIPT_PATH}?t=${Date.now()}-${Math.random()}`);
}

test("parseArgs: aborts when --db flag is missing", async () => {
  const mod = await loadScript();
  assert.throws(() => mod.parseArgs([]), /A --db flag is required/);
});

test("parseArgs: accepts local reset without production confirmation", async () => {
  const mod = await loadScript();
  assert.deepEqual(mod.parseArgs(["--db=local"]), {
    db: "local",
    confirmed: false,
  });
});

test("parseArgs: rejects production reset without confirmation", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.parseArgs(["--db=production"]),
    /Refusing to reset PRODUCTION without --i-know-what-im-doing/,
  );
});

test("parseArgs: accepts production reset only with explicit confirmation", async () => {
  const mod = await loadScript();
  assert.deepEqual(
    mod.parseArgs(["--db=production", "--i-know-what-im-doing"]),
    {
      db: "production",
      confirmed: true,
    },
  );
});

test("parseArgs: rejects unknown arguments", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.parseArgs(["--db=local", "--drop-everything"]),
    /Unrecognized argument: --drop-everything/,
  );
});
