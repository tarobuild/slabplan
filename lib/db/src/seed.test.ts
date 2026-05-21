import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "seed.ts"),
  "utf8",
);

test("seedDatabase runs relation rewrites inside one transaction-scoped client", () => {
  assert.match(source, /new AsyncLocalStorage<typeof db>\(\)/);
  assert.match(source, /function seedDb\(\): typeof db/);
  assert.match(source, /seedClientStorage\.getStore\(\) \?\? db/);
  assert.match(source, /return await db\.transaction\(async \(tx\) => \{/);
  assert.match(source, /seedClientStorage\.run\(tx as unknown as typeof db, async \(\) => \{/);
  assert.match(source, /await seedDb\(\)\s+\s*\.delete\(scheduleItemAssignees\)/);
  assert.match(source, /await seedDb\(\)\.delete\(dailyLogTags\)/);
  assert.match(source, /await seedDb\(\)\s+\s*\.delete\(dailyLogAttachments\)/);
  assert.doesNotMatch(source, /await db\s*\n\s*\.delete\(/);
  assert.doesNotMatch(source, /await db\.delete\(/);
});
