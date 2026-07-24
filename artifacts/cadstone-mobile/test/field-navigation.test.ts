import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(here, "../src/App.tsx"), "utf8");
const typesSource = readFileSync(resolve(here, "../src/navigation/types.ts"), "utf8");
const docsSource = readFileSync(resolve(here, "../../../docs/mobile-app.md"), "utf8");

test("field app exposes the expected native field tabs", () => {
  for (const tab of ["Home", "Jobs", "Schedule", "Logs", "More"]) {
    assert.match(appSource, new RegExp(`Tabs\\.Screen name="${tab}"`));
  }
});

test("field app keeps admin users out of the native field workspace", () => {
  assert.match(appSource, /role === "project_manager" \|\| user\?\.role === "crew_member"/);
  assert.match(appSource, /name="UnsupportedRole"/);
  assert.match(typesSource, /UnsupportedRole: undefined/);
});

test("field app registers deeper job, schedule, log, file, and resource routes", () => {
  for (const route of [
    "JobSchedule",
    "JobDailyLogs",
    "JobFiles",
    "JobFinancials",
    "ScheduleItem",
    "DailyLogDetail",
    "FolderFiles",
    "Resources",
  ]) {
    assert.match(typesSource, new RegExp(`${route}:`));
    assert.match(appSource, new RegExp(`name="${route}"`));
  }
});

test("mobile docs describe the field app scope instead of a starter app", () => {
  assert.match(docsSource, /Field App Scope/);
  assert.match(docsSource, /Mark assigned schedule items complete/);
  assert.match(docsSource, /Browse company Resources/);
});
