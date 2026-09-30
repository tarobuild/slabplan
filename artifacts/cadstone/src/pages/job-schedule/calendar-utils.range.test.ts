import assert from "node:assert/strict"
import { test } from "node:test"
import { formatRangeLabel, parseDate } from "./calendar-utils"

test("schedule date-range headings are readable within and across months and years", () => {
  assert.equal(formatRangeLabel(parseDate("2026-10-04"), parseDate("2026-10-10")), "October 4-10, 2026")
  assert.equal(formatRangeLabel(parseDate("2026-09-27"), parseDate("2026-10-03")), "Sep 27 - Oct 3, 2026")
  assert.equal(formatRangeLabel(parseDate("2026-12-27"), parseDate("2027-01-02")), "Dec 27, 2026 - Jan 2, 2027")
  assert.equal(formatRangeLabel(parseDate("2028-02-27"), parseDate("2028-02-29")), "February 27-29, 2028")
})
