import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DailyLogsGetDailyLogsFeedQueryParams,
  DailyLogsGetJobsJobIdDailyLogsQueryParams,
  DashboardGetDashboardScheduleQueryParams,
} from "../src/generated/api.ts";

const readGeneratedType = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("generated query date params accept YYYY-MM-DD strings", () => {
  assert.equal(
    DailyLogsGetJobsJobIdDailyLogsQueryParams.safeParse({
      from: "2026-04-01",
      to: "2026-04-30",
    }).success,
    true,
  );
  assert.equal(
    DailyLogsGetDailyLogsFeedQueryParams.safeParse({
      from: "2026-04-01",
      to: "2026-04-30",
    }).success,
    true,
  );
  assert.equal(
    DailyLogsGetDailyLogsFeedQueryParams.safeParse({
      from: null,
      to: undefined,
    }).success,
    true,
  );
  assert.equal(
    DashboardGetDashboardScheduleQueryParams.safeParse({
      start: "2026-04-01",
      end: "2026-04-30",
    }).success,
    true,
  );
});

test("generated query date params reject non-calendar-date strings", () => {
  assert.equal(
    DailyLogsGetJobsJobIdDailyLogsQueryParams.safeParse({
      from: "2026-04-01T00:00:00.000Z",
    }).success,
    false,
  );
  assert.equal(
    DailyLogsGetDailyLogsFeedQueryParams.safeParse({
      to: "04/30/2026",
    }).success,
    false,
  );
  assert.equal(
    DashboardGetDashboardScheduleQueryParams.safeParse({
      start: "2026-04-01T00:00:00.000Z",
    }).success,
    false,
  );
});

test("daily log generated query param types stay as calendar-date strings", () => {
  const feedParams = readGeneratedType(
    "../src/generated/types/dailyLogsGetDailyLogsFeedParams.ts",
  );
  const jobParams = readGeneratedType(
    "../src/generated/types/dailyLogsGetJobsJobIdDailyLogsParams.ts",
  );
  const dashboardParams = readGeneratedType(
    "../src/generated/types/dashboardGetDashboardScheduleParams.ts",
  );

  assert.match(feedParams, /from\?: string \| null;/);
  assert.match(feedParams, /to\?: string \| null;/);
  assert.doesNotMatch(feedParams, /\bfrom\?: Date\b/);
  assert.doesNotMatch(feedParams, /\bto\?: Date\b/);

  assert.match(jobParams, /from\?: string;/);
  assert.match(jobParams, /to\?: string;/);
  assert.doesNotMatch(jobParams, /\bfrom\?: Date\b/);
  assert.doesNotMatch(jobParams, /\bto\?: Date\b/);

  assert.match(dashboardParams, /start\?: string;/);
  assert.match(dashboardParams, /end\?: string;/);
  assert.doesNotMatch(dashboardParams, /\bstart\?: Date\b/);
  assert.doesNotMatch(dashboardParams, /\bend\?: Date\b/);
});
