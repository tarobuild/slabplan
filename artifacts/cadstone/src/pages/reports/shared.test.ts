import assert from "node:assert/strict"
import { test } from "node:test"

import {
  csvDownloadHref,
  isCompleteReportRange,
  rangeToReportParams,
} from "./shared.tsx"

test("custom report ranges do not produce request params until complete", () => {
  assert.equal(isCompleteReportRange({ range: "custom" }), false)
  assert.equal(isCompleteReportRange({ range: "custom", from: "2026-01-01" }), false)
  assert.equal(isCompleteReportRange({ range: "custom", to: "2026-01-31" }), false)
  assert.equal(
    isCompleteReportRange({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    }),
    true,
  )

  assert.equal(rangeToReportParams({ range: "custom" }), undefined)
  assert.equal(
    rangeToReportParams({ range: "custom", from: "2026-01-01" }),
    undefined,
  )
  assert.equal(
    csvDownloadHref("revenue", { range: "custom", from: "2026-01-01" }),
    null,
  )
})

test("complete report ranges produce API params and CSV URLs", () => {
  assert.deepEqual(rangeToReportParams({ range: "last_90" }), {
    range: "last_90",
  })
  assert.equal(
    csvDownloadHref("revenue", { range: "last_90" }),
    "/api/reports/revenue?range=last_90&format=csv",
  )

  assert.deepEqual(
    rangeToReportParams({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    }),
    { range: "custom", from: "2026-01-01", to: "2026-01-31" },
  )
  assert.equal(
    csvDownloadHref("pipeline", {
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
    }),
    "/api/reports/pipeline?range=custom&from=2026-01-01&to=2026-01-31&format=csv",
  )
})
