import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("containerized pg_dump receives the Supabase connection environment", async () => {
  const workflow = await readFile(path.join(repoRoot, ".github/workflows/db-backup.yml"), "utf8");
  const wrapper = workflow.match(/cat > .*?<<'EOF'([\s\S]*?)^\s*EOF/m)?.[1] ?? "";

  assert.match(wrapper, /docker run --rm/);
  for (const variable of [
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGSSLMODE",
  ]) {
    assert.match(wrapper, new RegExp(`-e ${variable}(?:\\s|$)`));
  }
  assert.match(wrapper, /postgres:17 pg_dump "\$@"/);
});

test("production backup verification is limited to explicit tags", async () => {
  const workflow = await readFile(path.join(repoRoot, ".github/workflows/db-backup.yml"), "utf8");

  assert.match(workflow, /push:\s*\n\s*tags:\s*\n\s*- "backup-verify-\*"/);
});
