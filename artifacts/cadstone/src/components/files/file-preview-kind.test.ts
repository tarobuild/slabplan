import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { inferPreviewKind } from "./file-preview-kind.ts"

describe("inferPreviewKind", () => {
  test("treats .pdf filenames as PDFs even when stored MIME metadata says text", () => {
    assert.equal(
      inferPreviewKind("text/plain", "h643202 February, 2, 2026 v2 (1).pdf"),
      "pdf",
    )
  })

  test("still previews true text files as text", () => {
    assert.equal(inferPreviewKind("text/plain", "field-notes.txt"), "text")
  })
})
