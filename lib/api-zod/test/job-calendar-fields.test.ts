import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readGeneratedType = (file: string) =>
  readFileSync(new URL(`../src/generated/types/${file}`, import.meta.url), "utf8");

test("generated job calendar fields stay as YYYY-MM-DD strings", () => {
  for (const file of ["jobSummary.ts", "jobDetail.ts", "jobListItem.ts"]) {
    const source = readGeneratedType(file);

    assert.match(source, /projectedStart\?: string \| null;/);
    assert.match(source, /projectedCompletion\?: string \| null;/);
    assert.doesNotMatch(source, /projectedStart\?: Date \| null;/);
    assert.doesNotMatch(source, /projectedCompletion\?: Date \| null;/);
  }
});
