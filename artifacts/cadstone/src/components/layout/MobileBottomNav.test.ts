import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "MobileBottomNav.tsx")

describe("MobileBottomNav primary actions", () => {
  test("office roles render at most three primary tabs before More", async () => {
    const source = await fs.readFile(sourcePath, "utf8")
    const officeTabsMatch = source.match(
      /: \[\s*\{ label: "Home"[\s\S]*?\]\s*const moreItems/,
    )

    assert.ok(officeTabsMatch, "office primary tab block must be present")
    const officeTabs = officeTabsMatch[0]

    assert.match(officeTabs, /label: "Home"/)
    assert.match(officeTabs, /label: "Clients"/)
    assert.match(officeTabs, /label: "Schedule"/)
    assert.doesNotMatch(
      officeTabs,
      /label: "Logs"/,
      "Daily Logs must not be a fourth office primary tab in the four-column mobile bar",
    )
    assert.match(
      source,
      /\{[\s\S]{0,80}label: "Daily Logs"[\s\S]{0,120}allow: ROLE_GATES\.dailyLogs/,
      "Daily Logs should remain reachable from More for office roles",
    )
    assert.match(
      source,
      /label: "Reports"[\s\S]{0,120}allow: ROLE_GATES\.reports/,
      "Reports must use the admin-only reports gate, not the broader sales gate",
    )
    assert.match(
      source,
      /label: "My Daily Logs"[\s\S]{0,120}hidden: isDrafter/,
      "Drafters should not see My Daily Logs in More",
    )
    assert.match(source, /<ul className="grid grid-cols-4">/)
  })
})
