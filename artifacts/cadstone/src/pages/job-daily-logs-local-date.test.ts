import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "job-daily-logs.tsx")

describe("daily log local date helpers", () => {
  test("today defaults and presets use local calendar dates instead of UTC dates", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(
      source,
      /function formatLocalDate\(date: Date\)[\s\S]{0,260}date\.getFullYear\(\)[\s\S]{0,260}date\.getMonth\(\) \+ 1[\s\S]{0,260}date\.getDate\(\)/,
      "date-only strings must be built from local date components",
    )
    assert.match(
      source,
      /function todayString\(\)[\s\S]{0,80}return formatLocalDate\(new Date\(\)\)/,
      "todayString must use the local calendar date",
    )
    assert.match(
      source,
      /function addDays\(date: Date, amount: number\)[\s\S]{0,140}next\.setDate\(next\.getDate\(\) \+ amount\)/,
      "preset date arithmetic must use local day arithmetic",
    )
    assert.doesNotMatch(
      source,
      /toISOString\(\)\.slice\(0,\s*10\)|getUTCFullYear|getUTCMonth|getUTCDate|setUTCDate/,
      "daily log date-only helpers must not use UTC conversion",
    )
  })
})
