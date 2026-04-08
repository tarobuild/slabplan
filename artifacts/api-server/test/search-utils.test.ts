import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContainsLikePattern } from "../src/lib/search.ts";

test("buildContainsLikePattern escapes SQL wildcard characters", () => {
  assert.equal(
    buildContainsLikePattern(String.raw`100%_match\done`),
    String.raw`%100\%\_match\\done%`,
  );
});
