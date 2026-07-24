import assert from "node:assert/strict"
import { describe, test } from "node:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourcePath = path.resolve(import.meta.dirname, "useScheduleData.ts")

describe("useScheduleData job switching", () => {
  test("job-scoped fetches guard against stale responses", async () => {
    const source = await fs.readFile(sourcePath, "utf8")

    assert.match(
      source,
      /const currentJobIdRef = useRef\(jobId\)/,
      "hook must track the latest jobId outside async closures",
    )
    assert.match(
      source,
      /currentJobIdRef\.current = jobId/,
      "latest jobId ref must be refreshed on render",
    )
    assert.match(
      source,
      /function isCurrentJob\(requestJobId: string\)/,
      "hook must expose a current-job guard for async fetches",
    )
    assert.match(
      source,
      /const requestJobId = jobId[\s\S]{0,600}scheduleGetJobsJobIdSchedule\(requestJobId/,
      "fetchItems must bind the request job id before fetching",
    )
    assert.match(
      source,
      /if \(!isCurrentJob\(requestJobId\)\) \{[\s\S]{0,80}return[\s\S]{0,220}setItems\(nextItems\)/,
      "fetchItems must check the current job before applying schedule items",
    )
    assert.match(
      source,
      /api\.get<ScheduleSettings>\(`\/jobs\/\$\{requestJobId\}\/schedule\/settings`\)[\s\S]{0,140}if \(!isCurrentJob\(requestJobId\)\)/,
      "fetchSettings must check the current job before applying settings",
    )
    assert.match(
      source,
      /api\.get<\{ baseline: ScheduleBaselineRecord \| null \}>\(`\/jobs\/\$\{requestJobId\}\/schedule\/baseline`\)[\s\S]{0,140}if \(!isCurrentJob\(requestJobId\)\)/,
      "fetchBaseline must check the current job before applying baseline",
    )
    assert.match(
      source,
      /api\.get<\{ exceptions: ScheduleWorkdayException\[\] \}>\(`\/jobs\/\$\{requestJobId\}\/workday-exceptions`\)[\s\S]{0,140}if \(!isCurrentJob\(requestJobId\)\)/,
      "fetchWorkdayExceptions must check the current job before applying exceptions",
    )
  })
})
