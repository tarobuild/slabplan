import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { leadStatuses } from "./index";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  path.resolve(here, "../../migrations/0016_leads_status_qualified.sql"),
  "utf8",
);

test("exported lead statuses include every database-accepted value", () => {
  const exported = new Set<string>(leadStatuses);

  for (const status of [
    "open",
    "qualified",
    "in_negotiation",
    "won",
    "lost",
    "archived",
  ]) {
    assert.equal(exported.has(status), true, `${status} should be exported`);
    assert.match(migration, new RegExp(`'${status}'`));
  }

  assert.deepEqual([...leadStatuses], [
    "open",
    "qualified",
    "in_negotiation",
    "won",
    "lost",
    "archived",
  ]);
});
