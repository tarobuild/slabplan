import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { mobileNavColumnTemplate } from "./MobileBottomNav.tsx"

const source = readFileSync(new URL("./MobileBottomNav.tsx", import.meta.url), "utf8")

test("mobileNavColumnTemplate includes the More control in the column count", () => {
  assert.equal(mobileNavColumnTemplate(4), "repeat(5, minmax(0, 1fr))")
})

test("mobile Reports navigation uses the reports role gate", () => {
  assert.match(source, /label: "Reports"[\s\S]*allow: ROLE_GATES\.reports/)
  assert.doesNotMatch(source, /label: "Reports"[\s\S]*allow: ROLE_GATES\.sales/)
})
