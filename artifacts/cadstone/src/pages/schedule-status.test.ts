import assert from "node:assert/strict"
import { test } from "node:test"
import { deriveStatus, localDateKey } from "./schedule.tsx"

test("deriveStatus compares schedule dates to the local calendar day", () => {
  const previousTz = process.env.TZ
  process.env.TZ = "America/Los_Angeles"
  try {
    const localLateNight = new Date("2026-05-18T06:30:00.000Z")
    const today = localDateKey(localLateNight)

    assert.equal(today, "2026-05-17")
    assert.equal(
      localLateNight.toISOString().slice(0, 10),
      "2026-05-18",
      "test fixture must be after UTC midnight but before local midnight",
    )

    const status = deriveStatus(
      {
        isComplete: false,
        startDate: "2026-05-17",
        endDate: "2026-05-17",
      } as Parameters<typeof deriveStatus>[0],
      today,
    )

    assert.equal(status.label, "In progress")
  } finally {
    if (previousTz === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = previousTz
    }
  }
})
