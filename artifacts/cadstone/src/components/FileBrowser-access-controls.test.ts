import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "FileBrowser.tsx")

describe("FileBrowser folder access controls", () => {
  test("folder access dialog exposes role-level controls that save without assigned people", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(source, /const folderAccessRoles[\s\S]{0,120}= \[/)
    assert.match(source, /Project Managers/)
    assert.match(source, /Crew Workers/)
    assert.match(source, /function updateFolderRolePermission/)
    assert.match(
      source,
      /permissions === null \|\| permissions\?\.internal === true/,
      "role switches must expand all-internal permissions before changing one role",
    )
    assert.match(
      source,
      /setAccessViewingPermissions\(\(prev\)[\s\S]{0,140}updateFolderRolePermission\(prev, role\.key, checked\)/,
      "view role switches must update viewingPermissions",
    )
    assert.match(
      source,
      /setAccessUploadingPermissions\(\(prev\)[\s\S]{0,140}updateFolderRolePermission\(prev, role\.key, checked\)/,
      "upload role switches must update uploadingPermissions",
    )
    assert.match(
      source,
      /onClick=\{handleSaveFolderAccess\}[\s\S]{0,80}disabled=\{savingFolderAccess\}/,
      "admins must be able to save role access even when no people are assigned to the job",
    )
  })

  test("locked global folders do not expose rejected management actions", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(source, /isGlobal: boolean/)
    assert.match(
      source,
      /showActions=\{canManageFolders && !folder\.isGlobal\}/,
      "global folders should not show actions the API rejects",
    )
  })
})
