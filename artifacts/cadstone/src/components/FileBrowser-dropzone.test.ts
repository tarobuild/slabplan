import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "FileBrowser.tsx")

describe("FileBrowser drag-and-drop uploads", () => {
  test("drop handler is recreated when the upload target changes", async () => {
    const source = await fs.readFile(sourcePath, "utf8")
    const onDropMatch = source.match(
      /const onDrop = useCallback\([\s\S]*?void uploadFilesImmediately\(droppedFiles\)[\s\S]*?\n\s*\[([^\]]+)\],\n\s*\)/,
    )

    assert.ok(onDropMatch, "FileBrowser must memoize the drop handler around uploadFilesImmediately")
    const deps = onDropMatch[1]

    assert.match(deps, /\bcurrentFolderId\b/, "drop handler must refresh when the current folder changes")
    assert.match(deps, /\bisResourceScope\b/, "drop handler must refresh when the upload scope changes")
  })
})
