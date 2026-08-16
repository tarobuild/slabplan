import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { describe, test } from "node:test"

const sourcePath = path.resolve(import.meta.dirname, "leads.tsx")

describe("Sales due-date list controls", () => {
  test("the UI sends server-backed due-date sorting and resets pagination", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(source, /params\.sortBy = "projectedSalesDate"/)
    assert.match(source, /params\.sortDir = "asc"/)
    assert.match(source, /params\.sortDir = "desc"/)
    assert.match(source, /data-testid="leads-sort-select"/)
    assert.match(
      source,
      /setSort\(value as "newest" \| "dueSoonest" \| "dueLatest"\)[\s\S]{0,100}setPage\(1\)/,
      "changing the sort must return to page one",
    )
  })

  test("desktop and narrow layouts display the due date", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(source, />Due date<\/TableHead>/)
    assert.doesNotMatch(source, />Type<\/TableHead>/)
    assert.match(
      source,
      /Due \{lead\.projectedSalesDate \? fmtDate\(lead\.projectedSalesDate\) : "—"\}/,
    )
    assert.match(
      source,
      /new Date\(`\$\{d\}T00:00:00`\)/,
      "date-only values must be parsed in local time instead of UTC",
    )
  })
})
