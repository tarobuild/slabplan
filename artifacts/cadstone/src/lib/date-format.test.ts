import assert from "node:assert/strict"
import test from "node:test"
import { formatShortUsDate } from "./date-format.ts"

test("formatShortUsDate keeps date-only values on their calendar day", () => {
  assert.equal(formatShortUsDate("2026-05-20"), "May 20, 2026")
})

test("formatShortUsDate still formats timestamps", () => {
  assert.equal(formatShortUsDate("2026-05-20T19:30:00Z"), "May 20, 2026")
})
