import assert from "node:assert/strict";
import { test } from "node:test";

const SCRIPT_PATH = "../scripts/seed-users.mjs";

const STRONG_PASSWORD_A = "Zx8!qfP@rwLm2#vT";
const STRONG_PASSWORD_B = "Yk3$bnW#oe9Lq!Hv";

async function loadScript() {
  // Cache-bust so each test sees a fresh module instance.
  return await import(`${SCRIPT_PATH}?t=${Date.now()}-${Math.random()}`);
}

test("parseArgs: aborts when --db flag is missing", async () => {
  const mod = await loadScript();
  assert.throws(() => mod.parseArgs([]), /Missing required --db flag/);
});

test("parseArgs: aborts on unknown --db value", async () => {
  const mod = await loadScript();
  assert.throws(() => mod.parseArgs(["--db=staging"]), /Unknown --db value/);
});

test("parseArgs: --db=local is accepted", async () => {
  const mod = await loadScript();
  const result = mod.parseArgs(["--db=local"]);
  assert.deepEqual(result, { db: "local", confirmed: false });
});

test("parseArgs: --db=production without --i-know-what-im-doing is rejected", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.parseArgs(["--db=production"]),
    /Refusing to seed PRODUCTION without --i-know-what-im-doing/,
  );
});

test("parseArgs: --db=production with --i-know-what-im-doing is accepted", async () => {
  const mod = await loadScript();
  const result = mod.parseArgs([
    "--db=production",
    "--i-know-what-im-doing",
  ]);
  assert.deepEqual(result, { db: "production", confirmed: true });
});

test("parseArgs: rejects unknown arguments", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.parseArgs(["--db=local", "--wipe-everything"]),
    /Unrecognized argument: --wipe-everything/,
  );
});

test("validatePassword: rejects missing password", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.validatePassword(undefined, "SEED_ADMIN_CESAR_PASSWORD"),
    /Missing required env var SEED_ADMIN_CESAR_PASSWORD/,
  );
  assert.throws(
    () => mod.validatePassword("", "SEED_ADMIN_CESAR_PASSWORD"),
    /Missing required env var SEED_ADMIN_CESAR_PASSWORD/,
  );
});

test("validatePassword: rejects passwords shorter than 12 chars", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.validatePassword("Sh0rt!aB", "SEED_ADMIN_CESAR_PASSWORD"),
    /SEED_ADMIN_CESAR_PASSWORD is too short/,
  );
});

test("validatePassword: rejects all-numeric passwords", async () => {
  const mod = await loadScript();
  assert.throws(
    () => mod.validatePassword("123456789012345", "SEED_ADMIN_CESAR_PASSWORD"),
    /all numeric/,
  );
});

test("validatePassword: rejects weak/blocked patterns", async () => {
  const mod = await loadScript();
  for (const weak of [
    "Test1!Test1!Test1!",
    "MyAdminPassw0rd!!",
    "passwordIsLongNow1!",
    "CadStoneRulesForever!",
    "ChangemePleaseNow1!",
  ]) {
    assert.throws(
      () => mod.validatePassword(weak, "SEED_ADMIN_CESAR_PASSWORD"),
      /weak\/blocked pattern/,
      `expected weak: ${weak}`,
    );
  }
});

test("validatePassword: accepts a strong password", async () => {
  const mod = await loadScript();
  assert.doesNotThrow(() =>
    mod.validatePassword(STRONG_PASSWORD_A, "SEED_ADMIN_CESAR_PASSWORD"),
  );
});

test("resolveSeedUsers: throws if either env var is missing", async () => {
  const mod = await loadScript();
  assert.throws(
    () =>
      mod.resolveSeedUsers({
        SEED_ADMIN_CESAR_PASSWORD: STRONG_PASSWORD_A,
        // SEED_ADMIN_ANWAR_PASSWORD intentionally absent
      }),
    /SEED_ADMIN_ANWAR_PASSWORD/,
  );
});

test("resolveSeedUsers: returns identities with passwords when both env vars are valid", async () => {
  const mod = await loadScript();
  const users = mod.resolveSeedUsers({
    SEED_ADMIN_CESAR_PASSWORD: STRONG_PASSWORD_A,
    SEED_ADMIN_ANWAR_PASSWORD: STRONG_PASSWORD_B,
  });

  assert.equal(users.length, 2);
  const cesar = users.find((u) => u.email === "cesar@cadstone.works");
  const anwar = users.find((u) => u.email === "anwar@cadstone.works");
  assert.ok(cesar);
  assert.ok(anwar);
  assert.equal(cesar.role, "admin");
  assert.equal(anwar.role, "admin");
  assert.equal(cesar.password, STRONG_PASSWORD_A);
  assert.equal(anwar.password, STRONG_PASSWORD_B);
});

test("SEED_USER_IDENTITIES does not contain any password literals", async () => {
  const mod = await loadScript();
  for (const identity of mod.SEED_USER_IDENTITIES) {
    assert.equal(
      "password" in identity,
      false,
      `identity for ${identity.email} should not embed a password`,
    );
    assert.ok(typeof identity.passwordEnvVar === "string");
    assert.match(identity.passwordEnvVar, /^SEED_ADMIN_/);
  }
});
