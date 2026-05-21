import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readInlineTextUrl } from "./FilePreview"

describe("FilePreview inline text URLs", () => {
  it("decodes data URL text content for inline text previews", async () => {
    const text = await readInlineTextUrl("data:text/plain,hello%20slabplan")

    assert.equal(text, "hello slabplan")
  })
})
