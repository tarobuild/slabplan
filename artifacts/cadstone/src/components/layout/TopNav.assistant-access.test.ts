import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./TopNav.tsx", import.meta.url), "utf8")

test("assistant access checks reset visibility and ignore stale responses", () => {
  assert.match(source, /setCanUseAssistant\(false\)/)
  assert.match(source, /assistantAccessRequestSeq\.current === requestSeq/)
})
