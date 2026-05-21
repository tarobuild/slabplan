import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");

test("daily-logs/mine contract documents limit-only requests as page mode", () => {
  const specRaw = readFileSync(path.join(root, "lib/api-spec/openapi.yaml"), "utf8");
  const spec = YAML.parse(specRaw);
  const cursorParam = spec.components.parameters.CursorParam.description;
  const mine = spec.components.schemas.MyDailyLogsResponse;
  const pageBranch = mine.properties.pagination.oneOf[0];

  assert.match(cursorParam, /Requests that only send `\?limit=N` remain in page mode/);
  assert.match(mine.description, /unless the request supplied an explicit `cursor` parameter/);
  assert.deepEqual(pageBranch.required, [
    "page",
    "pageSize",
    "limit",
    "total",
    "totalItems",
    "totalPages",
  ]);
});

test("generated MyDailyLogsResponse pagination matches the documented page/cursor union", () => {
  const generated = readFileSync(
    path.join(root, "lib/api-zod/src/generated/types/myDailyLogsResponsePagination.ts"),
    "utf8",
  );

  assert.match(generated, /page: number/);
  assert.match(generated, /pageSize: number/);
  assert.match(generated, /limit: number/);
  assert.match(generated, /total: number/);
  assert.match(generated, /totalItems: number/);
  assert.match(generated, /totalPages: number/);
  assert.match(generated, /\| CursorPagination/);
});

test("schedule list contract exposes cursor pagination when cursor is requested", () => {
  const specRaw = readFileSync(path.join(root, "lib/api-spec/openapi.yaml"), "utf8");
  const spec = YAML.parse(specRaw);
  const schedule = spec.components.schemas.ScheduleListResponse;
  const scheduleParams = spec.paths["/jobs/{jobId}/schedule"].get.parameters;
  const generated = readFileSync(
    path.join(root, "lib/api-zod/src/generated/types/scheduleListResponsePagination.ts"),
    "utf8",
  );

  assert.ok(
    scheduleParams.some((param) => param.$ref === "#/components/parameters/CursorParam"),
  );
  assert.match(schedule.description, /explicit `cursor` parameter/);
  assert.equal(schedule.properties.pagination.oneOf[1].$ref, "#/components/schemas/CursorPagination");
  assert.match(generated, /import type \{ CursorPagination \}/);
  assert.match(generated, /\| CursorPagination/);
});
