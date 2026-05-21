import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { buildShortcutGroups } from "./KeyboardShortcuts"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "KeyboardShortcuts.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("KeyboardShortcuts role gates", () => {
  it("hides clients and sales shortcuts from field roles", () => {
    const projectManagerLabels = buildShortcutGroups("project_manager")
      .flatMap((group) => group.shortcuts)
      .map((shortcut) => shortcut.label)
    const crewLabels = buildShortcutGroups("crew_member")
      .flatMap((group) => group.shortcuts)
      .map((shortcut) => shortcut.label)

    assert.equal(projectManagerLabels.includes("Go to Clients"), false)
    assert.equal(projectManagerLabels.includes("Go to Leads"), false)
    assert.equal(crewLabels.includes("Go to Clients"), false)
    assert.equal(crewLabels.includes("Go to Leads"), false)
  })

  it("gates keyboard route dispatch with the same role access rules", () => {
    assert.match(source, /key === "c" && hasRoleAccess\(role, ROLE_GATES\.clients\)/)
    assert.match(source, /key === "l" && hasRoleAccess\(role, ROLE_GATES\.sales\)/)
  })
})
