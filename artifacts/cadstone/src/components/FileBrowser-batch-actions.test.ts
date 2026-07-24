import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "FileBrowser.tsx")

describe("FileBrowser batch file actions", () => {
  test("renders job-scoped selection controls and calls batch file endpoints", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(source, /const batchSelectionEnabled = !isResourceScope/)
    assert.match(source, /function BatchFileSelectionToolbar/)
    assert.match(source, /function SelectionToggleButton/)
    assert.match(source, /selectedFileIds: Set<string>/)
    assert.match(source, /\/files\/batch\/download/)
    assert.match(source, /\/files\/batch\/move/)
    assert.match(source, /\/files\/batch\/copy/)
    assert.match(source, /\/files\/batch\/delete/)
    assert.match(source, /\/jobs\/\$\{jobId\}\/folder-tree\?mediaType=\$\{mediaType\}/)
    assert.match(source, /folders\.filter\(\(folder\) => folder\.id !== currentFolderId\)/)
  })
})
