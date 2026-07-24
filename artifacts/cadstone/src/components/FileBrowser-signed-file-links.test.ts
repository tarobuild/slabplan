import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

const sourcePath = path.resolve(import.meta.dirname, "FileBrowser.tsx")
const source = fs.readFileSync(sourcePath, "utf8")

describe("FileBrowser signed file links", () => {
  test("single-file downloads use signed download URLs instead of buffering blobs", () => {
    const handleDownloadSource =
      source.match(/const handleDownload = async \(file: FileItem\) => \{[\s\S]*?\n  \}/)?.[0] ?? ""

    assert.match(handleDownloadSource, /`\/files\/\$\{file\.id\}\/signed-download`/)
    assert.match(handleDownloadSource, /window\.location\.assign\(signedUrl\)/)
    assert.doesNotMatch(handleDownloadSource, /api\s*\.\s*get<Blob>/)
    assert.doesNotMatch(handleDownloadSource, /URL\.createObjectURL/)
    assert.doesNotMatch(handleDownloadSource, /anchor\.click\(\)/)
  })

  test("document opens use signed view URLs instead of routing PDFs into preview", () => {
    const handleOpenSource =
      source.match(/const handleViewInNewTab = \(file: FileItem\) => \{[\s\S]*?\n  \}/)?.[0] ?? ""

    assert.match(handleOpenSource, /openLoadingTab\(\)/)
    assert.match(handleOpenSource, /`\/files\/\$\{file\.id\}\/signed-view`/)
    assert.doesNotMatch(handleOpenSource, /openFilePreview\(file\)/)
    assert.doesNotMatch(handleOpenSource, /api\s*\.\s*get<Blob>/)
    assert.doesNotMatch(handleOpenSource, /URL\.createObjectURL/)
  })
})
