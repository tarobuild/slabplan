import assert from "node:assert/strict"
import test from "node:test"

import { formatCents } from "./types.ts"

test("formatCents preserves cent precision for dashboard financial rows", () => {
  assert.equal(formatCents(12_345), "$123.45")
  assert.equal(formatCents(12_300), "$123.00")
})
