import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ActivityGetActivityQueryParams } from "../src/generated/api.ts";

const paramsSource = () =>
  readFileSync(
    new URL("../src/generated/types/activityGetActivityParams.ts", import.meta.url),
    "utf8",
  );

test("activity generated params expose pageSize for offset pagination", () => {
  const source = paramsSource();

  assert.match(source, /page\?: number;/);
  assert.match(source, /pageSize\?: number;/);
  assert.match(source, /limit\?: number;/);
  assert.match(source, /Page size for offset pagination/);
  assert.match(source, /Page size for cursor pagination/);
});

test("activity generated query validator accepts pageSize and caps it", () => {
  assert.equal(
    ActivityGetActivityQueryParams.safeParse({ page: "2", pageSize: "50" })
      .success,
    true,
  );
  assert.equal(
    ActivityGetActivityQueryParams.safeParse({ pageSize: "101" }).success,
    false,
  );
});
