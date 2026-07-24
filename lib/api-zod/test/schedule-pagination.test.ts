import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ScheduleGetJobsJobIdScheduleResponse,
  ScheduleGetScheduleResponse,
} from "../src/generated/api.ts";
import type { ScheduleListResponse } from "../src/generated/types/scheduleListResponse.ts";

function readNextCursor(pagination: ScheduleListResponse["pagination"]) {
  return "hasMore" in pagination ? pagination.nextCursor : null;
}

test("schedule list response accepts cursor pagination", () => {
  const response = {
    data: [],
    pagination: {
      limit: 25,
      hasMore: true,
      nextCursor: "cursor-token",
    },
  } satisfies ScheduleListResponse;

  const jobSchedule = ScheduleGetJobsJobIdScheduleResponse.parse(response);
  const companySchedule = ScheduleGetScheduleResponse.parse(response);

  assert.equal(readNextCursor(response.pagination), "cursor-token");
  assert.equal("hasMore" in jobSchedule.pagination, true);
  assert.equal("hasMore" in companySchedule.pagination, true);
});

test("schedule list response still accepts offset pagination", () => {
  const response = {
    data: [],
    pagination: {
      page: 2,
      limit: 50,
      totalItems: 125,
      totalPages: 3,
    },
  } satisfies ScheduleListResponse;

  const parsed = ScheduleGetJobsJobIdScheduleResponse.parse(response);

  assert.deepEqual(parsed.pagination, response.pagination);
  assert.equal(readNextCursor(response.pagination), null);
});
