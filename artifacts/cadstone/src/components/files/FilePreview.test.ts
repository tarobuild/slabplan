import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

const sourcePath = path.resolve(import.meta.dirname, "FilePreview.tsx")
const source = fs.readFileSync(sourcePath, "utf8")

describe("FilePreview PDF loading", () => {
  test("PDF previews do not auto-load the in-app PDF renderer", () => {
    assert.match(
      source,
      /if \(kind === "pdf"\) \{\s*return <PdfExternalView file=\{file\} \/>\s*\}/,
    )
    const previewBodySource = source.match(/function PreviewBody[\s\S]*?function PdfExternalView/)?.[0] ?? ""
    assert.doesNotMatch(
      previewBodySource,
      /else if \(kind === "pdf"|kind === "pdf" && fileId/,
      "PDF previews should show the lightweight action panel before loading any PDF bytes",
    )
  })

  test("PDF open and download mint short-lived signed URLs without pdf.js markup", () => {
    assert.match(source, /`\/files\/\$\{fileId\}\/signed-view`/)
    assert.match(source, /`\/files\/\$\{fileId\}\/signed-download`/)
    assert.match(source, /window\.location\.assign\(signedUrl\)/)
    assert.doesNotMatch(source, /react-pdf/)
    assert.doesNotMatch(source, /PdfViewer/)
    assert.doesNotMatch(source, /pdfjs/)
    assert.doesNotMatch(source, /Markup/)
  })
})
