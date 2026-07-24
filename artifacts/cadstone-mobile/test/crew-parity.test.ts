import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(here, "../src/App.tsx"), "utf8");
const jobDetailSource = readFileSync(resolve(here, "../src/screens/JobDetailScreen.tsx"), "utf8");
const jobFinancialsSource = readFileSync(resolve(here, "../src/screens/JobFinancialsScreen.tsx"), "utf8");
const jobsSource = readFileSync(resolve(here, "../src/screens/JobsScreen.tsx"), "utf8");
const logsSource = readFileSync(resolve(here, "../src/screens/MyLogsScreen.tsx"), "utf8");
const scheduleSource = readFileSync(resolve(here, "../src/screens/FieldScheduleScreen.tsx"), "utf8");
const filesSource = readFileSync(resolve(here, "../src/screens/JobFilesScreen.tsx"), "utf8");
const resourcesSource = readFileSync(resolve(here, "../src/screens/ResourcesScreen.tsx"), "utf8");

test("mobile crew workspace uses the same role-filtered platform endpoints", () => {
  assert.match(jobsSource, /jobsGetJobs/);
  assert.match(jobDetailSource, /jobsGetJobsId/);
  assert.match(logsSource, /dailyLogAdminGetDailyLogsMine/);
  assert.match(scheduleSource, /dashboardGetDashboardSchedule/);
  assert.match(filesSource, /listJobFolders/);
  assert.match(resourcesSource, /listResourceFolders/);
});

test("mobile job detail mirrors crew job summary and conditional financial access", () => {
  assert.match(jobDetailSource, /job\.access\?\.financials/);
  assert.match(jobDetailSource, /navigation\.navigate\("JobFinancials"/);
  assert.match(jobDetailSource, /Internal/);
  assert.match(jobDetailSource, /Subs and vendors/);
  assert.match(jobDetailSource, /Permit/);
  assert.match(jobDetailSource, /Work days/);
  assert.match(appSource, /name="JobFinancials"/);
});

test("mobile financials stay read-only and behind the job financials permission", () => {
  assert.match(jobFinancialsSource, /\/api\/jobs\/\$\{route\.params\.jobId\}\/financials/);
  assert.match(jobFinancialsSource, /Read-only job financial access/);
  assert.doesNotMatch(jobFinancialsSource, /apiPost|apiPatch|customFetch/);
  assert.doesNotMatch(jobFinancialsSource, /Upload|Delete|Edit|Save/);
});
