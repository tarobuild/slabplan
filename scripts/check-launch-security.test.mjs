import assert from "node:assert/strict";
import test from "node:test";
import { assessLaunchAudit, launchRoots } from "./check-launch-security.mjs";

const projects = () => launchRoots.map((name) => ({ name }));
const advisory = (version = "1.0.0", severity = "high") => ({
  module_name: "vulnerable",
  severity,
  findings: [{ version, paths: ["mobile>vulnerable"] }],
});
const audit = (entry = advisory()) => ({
  advisories: { 1: entry },
  metadata: { vulnerabilities: { high: 1 } },
});

test("fails high/critical transitive runtime and build dependencies regardless of advisory path", () => {
  for (const kind of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const graph = projects();
    graph[1][kind] = {
      parent: {
        version: "2",
        dependencies: { vulnerable: { from: "vulnerable", version: "1.0.0" } },
      },
    };
    assert.equal(assessLaunchAudit(audit(), graph).blocking.length, 1);
  }
});
test("matches installed versions and does not confuse unused mobile versions with deployed versions", () => {
  const graph = projects();
  graph[2].dependencies = { vulnerable: { version: "2.0.0" } };
  const result = assessLaunchAudit(audit(), graph);
  assert.equal(result.blocking.length, 0);
  assert.equal(result.excluded.length, 1);
});
test("retains lower-severity findings in the launch report", () => {
  const graph = projects();
  graph[0].devDependencies = { vulnerable: { version: "1.0.0" } };
  const result = assessLaunchAudit(audit(advisory("1.0.0", "moderate")), graph);
  assert.equal(result.included.length, 1);
  assert.equal(result.blocking.length, 0);
});
test("fails closed on provider errors, malformed findings, or incomplete dependency graphs", () => {
  assert.throws(() => assessLaunchAudit({ error: "unavailable" }, projects()));
  assert.throws(() =>
    assessLaunchAudit(audit({ module_name: "x" }), projects()),
  );
  assert.throws(
    () => assessLaunchAudit(audit(), projects().slice(1)),
    /Missing launch/,
  );
});
