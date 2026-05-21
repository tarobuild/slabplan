import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./daily-logs.tsx", import.meta.url), "utf8")

test("clearAllFilters clears both visible and debounced keyword state", () => {
  assert.match(
    source,
    /function clearAllFilters\(\) \{[\s\S]*setSearchInput\(""\)[\s\S]*setDebouncedSearch\(""\)/,
  )
})
