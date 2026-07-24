import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  SchedulePostJobsJobIdScheduleBody,
  SchedulePutScheduleItemsIdBody,
} from "../src/generated/api.ts";

const validSchedulePayload = {
  title: "Template",
  startDate: "2026-04-01",
};

test("generated schedule payload rejects impossible times and unknown reminders", () => {
  for (const schema of [
    SchedulePostJobsJobIdScheduleBody,
    SchedulePutScheduleItemsIdBody,
  ]) {
    assert.equal(
      schema.safeParse({
        ...validSchedulePayload,
        startTime: "09:30",
        endTime: "17:30:00",
        reminder: "1_hour_before",
      }).success,
      true,
    );
    assert.equal(
      schema.safeParse({ ...validSchedulePayload, startTime: "99:99" })
        .success,
      false,
    );
    assert.equal(
      schema.safeParse({ ...validSchedulePayload, endTime: "24:60" }).success,
      false,
    );
    assert.equal(
      schema.safeParse({ ...validSchedulePayload, reminder: "1h" }).success,
      false,
    );
  }
});

test("generated schedule payload type exposes reminder as an enum", () => {
  const source = readFileSync(
    new URL("../src/generated/types/scheduleSchedulePayloadSchema.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /reminder\?: ScheduleSchedulePayloadSchemaReminder;/);
  assert.doesNotMatch(source, /reminder\?: string;/);
  assert.match(source, /\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d/);
});
