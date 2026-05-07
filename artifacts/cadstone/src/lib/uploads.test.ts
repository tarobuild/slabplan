import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { validateSelectedFiles } from "./uploads.ts"

function makeFile(name: string, mimeType: string, size = 16): File {
  return new File([new Uint8Array(size)], name, { type: mimeType })
}

describe("validateSelectedFiles", () => {
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

  test("accepts a .dwg CAD drawing with an empty browser MIME", () => {
    // Browsers don't have a built-in MIME for AutoCAD DWG, so the file
    // picker reports "" — we used to block this on the front-end and
    // strand contractors who routinely attach drawings.
    const error = validateSelectedFiles([makeFile("site.dwg", "")], "document")
    assert.equal(error, null)
  })

  test("accepts a HEIC photo, an MP3 voice memo, and a ZIP of plans", () => {
    for (const f of [
      makeFile("burst.heic", "image/heic"),
      makeFile("voicememo.mp3", "audio/mpeg"),
      makeFile("plans.zip", "application/zip"),
      makeFile("raw.cr2", ""),
    ]) {
      assert.equal(validateSelectedFiles([f], "document"), null, `${f.name} should be accepted`)
    }
  })

  test("rejects a .exe with a clear, extension-named message", () => {
    // Loosening the MIME check must not loosen the extension check —
    // a renamed executable still has a non-document extension and
    // must be refused before it leaves the browser.
    const error = validateSelectedFiles(
      [makeFile("payload.exe", "application/octet-stream")],
      "document",
    )
    assert.ok(error, "expected a validation error for .exe")
    assert.match(error!, /\.exe/)
    assert.match(error!, /aren't allowed for safety/)
  })

  test("rejects .bat / .sh / .html across the blocklist", () => {
    for (const name of ["run.bat", "deploy.sh", "evil.html"]) {
      const error = validateSelectedFiles([makeFile(name, "")], "document")
      assert.ok(error, `${name} should be blocked`)
    }
  })

  test("does not block .pdf even when the MIME looks unusual (server is authoritative)", () => {
    // Front-end no longer second-guesses the MIME for legitimate
    // extensions. The server's PDF magic-byte check catches a renamed
    // payload before storage.
    const error = validateSelectedFiles([makeFile("plan.pdf", "image/png")], "document")
    assert.equal(error, null)
  })
})
