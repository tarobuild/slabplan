import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SchedulePostJobsJobIdWorkdayExceptionsBody,
  UsersPatchUsersIdBody,
} from "../src/generated/api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedTypesDir = path.resolve(here, "../src/generated/types");

const validWorkdayBase = {
  title: "Holiday",
  type: "non_workday",
  startDate: "2026-12-24",
  endDate: "2026-12-24",
} as const;

test("generated request contracts reject payloads that server refinements reject", async () => {
  assert.equal(UsersPatchUsersIdBody.safeParse({}).success, false);
  assert.equal(UsersPatchUsersIdBody.safeParse({ fullName: "Ada Lovelace" }).success, true);

  assert.equal(
    SchedulePostJobsJobIdWorkdayExceptionsBody.safeParse(validWorkdayBase).success,
    false,
  );
  assert.equal(
    SchedulePostJobsJobIdWorkdayExceptionsBody.safeParse({
      ...validWorkdayBase,
      jobIds: [],
    }).success,
    false,
  );
  assert.equal(
    SchedulePostJobsJobIdWorkdayExceptionsBody.safeParse({
      ...validWorkdayBase,
      jobIds: ["11111111-1111-4111-8111-111111111111"],
    }).success,
    true,
  );
  assert.equal(
    SchedulePostJobsJobIdWorkdayExceptionsBody.safeParse({
      ...validWorkdayBase,
      appliesToAllJobs: true,
    }).success,
    true,
  );

  const usersSource = await readFile(
    path.join(generatedTypesDir, "usersUpdateUserSchema.ts"),
    "utf8",
  );
  const workdaySource = await readFile(
    path.join(generatedTypesDir, "workdayExceptionPayload.ts"),
    "utf8",
  );

  assert.match(usersSource, /export type UsersUpdateUserSchema = AtLeastOne/);
  assert.doesNotMatch(usersSource, /export interface UsersUpdateUserSchema/);
  assert.match(workdaySource, /jobIds: \[string, \.\.\.string\[\]\]/);
  assert.match(workdaySource, /appliesToAllJobs: true/);
  assert.doesNotMatch(workdaySource, /export interface WorkdayExceptionPayload/);
});
