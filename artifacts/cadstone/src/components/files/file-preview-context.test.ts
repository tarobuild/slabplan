import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

const sourcePath = path.resolve(import.meta.dirname, "file-preview-context.tsx")
const source = fs.readFileSync(sourcePath, "utf8")

describe("FilePreviewProvider PDF routing", () => {
  test("PDF clicks open a signed browser view instead of mounting the preview modal", () => {
    assert.match(source, /inferPreviewKind\(selectedFile\.mimeType, selectedFile\.name\) === "pdf"/)
    assert.match(source, /void openPdfInBrowser\(selectedFile\)/)
    assert.match(source, /`\/files\/\$\{fileId\}\/signed-view`/)
    assert.doesNotMatch(source, /setState\(\{ files, index: safeIndex \}\)[\s\S]*inferPreviewKind/)
  })
})
