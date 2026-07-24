import assert from "node:assert/strict";
import { test } from "node:test";

import { getDashboardGetDashboardScheduleUrl } from "../src/generated/api.ts";

test("dashboard schedule generated URL keeps calendar query params as YYYY-MM-DD strings", () => {
  assert.equal(
    getDashboardGetDashboardScheduleUrl({
      start: "2026-04-01",
      end: "2026-04-30",
    }),
    "/api/dashboard/schedule?start=2026-04-01&end=2026-04-30",
  );
});
