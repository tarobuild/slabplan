import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { validateSelectedFiles } from "./uploads.ts"

function makeFile(name: string, mimeType: string, size = 16): File {
  return new File([new Uint8Array(size)], name, { type: mimeType })
}

describe("validateSelectedFiles (document)", () => {
  test("accepts a .pdf with the standard application/pdf MIME", () => {
    const error = validateSelectedFiles([makeFile("plan.pdf", "application/pdf")], "document")
    assert.equal(error, null)
  })

  test("accepts a .docx whose browser MIME is the openxml type", () => {
    const error = validateSelectedFiles(
      [
        makeFile(
          "spec.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ],
      "document",
    )
    assert.equal(error, null)
  })

  test("accepts a .docx when the browser reports application/octet-stream", () => {
    // Some Windows file pickers and older browsers report a generic
    // MIME for .docx uploads. The server still does the authoritative
    // magic-byte check, so the front-end must not dead-end the user.
    const error = validateSelectedFiles(
      [makeFile("spec.docx", "application/octet-stream")],
      "document",
    )
    assert.equal(error, null)
  })

  test("accepts a .csv with an empty MIME (Safari behaviour)", () => {
    const error = validateSelectedFiles([makeFile("data.csv", "")], "document")
    assert.equal(error, null)
  })

  test("rejects a .exe even when the MIME is application/octet-stream", () => {
    // Loosening the MIME check must not loosen the extension check —
    // a renamed executable still has a non-document extension and
    // must be refused before it leaves the browser.
    const error = validateSelectedFiles(
      [makeFile("payload.exe", "application/octet-stream")],
      "document",
    )
    assert.ok(error, "expected a validation error for .exe")
    assert.match(error!, /supported office, text, or PDF files/)
  })

  test("rejects a .pdf when the MIME is something obviously wrong like image/png", () => {
    const error = validateSelectedFiles(
      [makeFile("plan.pdf", "image/png")],
      "document",
    )
    assert.ok(error)
  })
})
