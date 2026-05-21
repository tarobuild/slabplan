import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  TOOL_INPUT_PREVIEW_LIMIT,
  truncateToolInputPreview,
} from "./ChatMessage"

describe("ChatMessage tool input preview", () => {
  it("caps long string tool inputs and marks truncation", () => {
    const longInput = "x".repeat(TOOL_INPUT_PREVIEW_LIMIT + 20)
    const preview = truncateToolInputPreview(longInput)

    assert.equal(preview.length, TOOL_INPUT_PREVIEW_LIMIT + 1)
    assert.equal(preview.endsWith("…"), true)
  })

  it("leaves short string tool inputs unchanged", () => {
    assert.equal(truncateToolInputPreview("small input"), "small input")
  })
})
