import assert from "node:assert/strict"
import { test } from "node:test"

import { mergeSavedNotificationPrefs } from "./NotificationsSection.tsx"

test("notification preference save results only merge the saved key", () => {
  const current = {
    daily_log_mention: true,
    schedule_change: true,
  }
  const olderServerSnapshot = {
    daily_log_mention: true,
    schedule_change: false,
  }

  assert.deepEqual(
    mergeSavedNotificationPrefs(
      current,
      "daily_log_mention",
      true,
      olderServerSnapshot,
    ),
    {
      daily_log_mention: true,
      schedule_change: true,
    },
  )
})

test("notification preference save results keep the optimistic value if the key is absent", () => {
  assert.deepEqual(
    mergeSavedNotificationPrefs(
      { weekly_summary: true },
      "weekly_summary",
      true,
      { schedule_change: false },
    ),
    { weekly_summary: true },
  )
})
