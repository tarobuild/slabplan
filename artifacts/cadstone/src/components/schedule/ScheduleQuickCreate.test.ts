import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./ScheduleQuickCreate.tsx", import.meta.url), "utf8")

test("ScheduleQuickCreate normalizes title before carrying state to more options", () => {
  assert.match(source, /title: title\.trim\(\)/)
  assert.doesNotMatch(source, /title,\s+assigneeIds/)
})

test("ScheduleQuickCreate applies required-title validation before more options", () => {
  assert.match(
    source,
    /function validateTitle\(\) \{[\s\S]*setSaveError\("Title is required"\)[\s\S]*titleRef\.current\?\.focus\(\)[\s\S]*return null[\s\S]*return trimmed[\s\S]*\}/,
  )
  assert.match(
    source,
    /function handleQuickMoreOptions\(\) \{\s+if \(!validateTitle\(\)\) return\s+const state = buildState\(\)/,
  )
})
