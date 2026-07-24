import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ReportsGetReportsArAgingQueryParams,
  ReportsGetReportsRevenueQueryParams,
} from "../src/generated/api.ts";

const readGenerated = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("generated report query schemas reject custom ranges without both dates", () => {
  assert.equal(
    ReportsGetReportsRevenueQueryParams.safeParse({ range: "custom" }).success,
    false,
  );
  assert.equal(
    ReportsGetReportsRevenueQueryParams.safeParse({
      range: "custom",
      from: "2026-01-01",
    }).success,
    false,
  );
  assert.equal(
    ReportsGetReportsRevenueQueryParams.safeParse({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    }).success,
    true,
  );
  assert.equal(ReportsGetReportsArAgingQueryParams.safeParse({}).success, true);
});

test("generated report params types encode the custom range date requirement", () => {
  const apiZodType = readGenerated(
    "../src/generated/types/reportsGetReportsRevenueParams.ts",
  );
  const apiClientTypes = readFileSync(
    new URL("../../api-client-react/src/generated/api.schemas.ts", import.meta.url),
    "utf8",
  );

  for (const source of [apiZodType, apiClientTypes]) {
    assert.match(source, /type ReportsGetReportsRevenueParamsPreset =/);
    assert.match(source, /range\?: Exclude<ReportRangeParamParameter, "custom">;/);
    assert.match(source, /from\?: never;/);
    assert.match(source, /type ReportsGetReportsRevenueParamsCustom =/);
    assert.match(source, /range: "custom";/);
    assert.match(source, /from: ReportFromParamParameter;/);
    assert.match(source, /to: ReportToParamParameter;/);
  }
});
