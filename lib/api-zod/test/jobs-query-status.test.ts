import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { JobsGetJobsQueryParams } from "../src/generated/api.ts";
import type { JobsGetJobsParams } from "../src/generated/types/jobsGetJobsParams.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedTypesDir = path.resolve(here, "../src/generated/types");

test("GET /jobs status query is constrained to server-supported statuses", async () => {
  const validParams: JobsGetJobsParams = { status: "open" };

  assert.equal(JobsGetJobsQueryParams.safeParse(validParams).success, true);
  assert.equal(JobsGetJobsQueryParams.safeParse({ status: "closed" }).success, true);
  assert.equal(JobsGetJobsQueryParams.safeParse({ status: "archived" }).success, true);
  assert.equal(JobsGetJobsQueryParams.safeParse({ status: "done" }).success, false);

  const source = await readFile(path.join(generatedTypesDir, "jobsGetJobsParams.ts"), "utf8");
  assert.match(source, /status\?:\s*JobsGetJobsStatus;/);
  assert.doesNotMatch(source, /status\?:\s*string;/);
});
