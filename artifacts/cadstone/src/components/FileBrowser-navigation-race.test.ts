import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "FileBrowser.tsx")

describe("FileBrowser folder navigation loading", () => {
  test("folder and file loaders ignore stale responses and clear failed current loads", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(source, /const currentFolderIdRef = useRef<string \| null>\(currentFolderId\)/)
    assert.match(source, /const folderLoadRequestRef = useRef\(0\)/)
    assert.match(source, /const fileLoadRequestRef = useRef\(0\)/)
    assert.match(
      source,
      /function isCurrentFolderLoad\(requestId: number, parentId: string \| null\)[\s\S]{0,160}currentFolderIdRef\.current === parentId/,
      "folder loads must be scoped to the latest request and active folder",
    )
    assert.match(
      source,
      /function isCurrentFileLoad\(requestId: number, folderId: string\)[\s\S]{0,160}currentFolderIdRef\.current === folderId/,
      "file loads must be scoped to the latest request and active folder",
    )
    assert.match(
      source,
      /\.then\(\(r\) => \{[\s\S]{0,100}if \(!isCurrentFolderLoad\(requestId, parentId\)\) return[\s\S]{0,180}setFolders\(r\.data\.folders \?\? \[\]\)/,
      "stale folder responses must not update visible folders",
    )
    assert.match(
      source,
      /\.catch\(\(err: unknown\) => \{[\s\S]{0,100}if \(!isCurrentFileLoad\(requestId, folderId\)\) return[\s\S]{0,100}setFiles\(\[\]\)/,
      "failed current file loads must clear stale files",
    )
    assert.match(
      source,
      /function clearFilesForFolderChange\(\)[\s\S]{0,120}fileLoadRequestRef\.current \+= 1[\s\S]{0,120}setFiles\(\[\]\)/,
      "folder navigation must invalidate in-flight file loads and clear old files",
    )
  })
})
