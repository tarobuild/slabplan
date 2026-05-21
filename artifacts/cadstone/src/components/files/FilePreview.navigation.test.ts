import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { clampFilePreviewIndex } from "./FilePreview"

describe("FilePreview navigation index", () => {
  it("clamps out-of-range indexes to the visible file bounds", () => {
    assert.equal(clampFilePreviewIndex(99, 3), 2)
    assert.equal(clampFilePreviewIndex(-4, 3), 0)
    assert.equal(clampFilePreviewIndex(1, 3), 1)
    assert.equal(clampFilePreviewIndex(99, 0), 0)
  })

  it("wraps next and previous navigation from the clamped visible index", () => {
    const total = 3
    const visibleIndex = clampFilePreviewIndex(99, total)

    assert.equal((visibleIndex + 1) % total, 0)
    assert.equal((visibleIndex - 1 + total) % total, 1)
  })
})
