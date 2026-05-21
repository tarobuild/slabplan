import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./MissingLogsPage.tsx", import.meta.url), "utf8")

test("missing logs drill-down warns when the dashboard sample is incomplete", () => {
  assert.match(
    source,
    /data\.atRisk\.jobsMissingLogs > data\.atRisk\.samples\.missingLogJobs\.length/,
  )
  assert.match(source, /Showing \{data\.atRisk\.samples\.missingLogJobs\.length\} sampled jobs out of \{data\.atRisk\.jobsMissingLogs\}/)
  assert.match(source, /Return to Home or reports for the full cohort/)
})

test("missing logs drill-down still renders sampled jobs as daily-log links", () => {
  assert.match(source, /data\.atRisk\.samples\.missingLogJobs\.map\(\(job\) =>/)
  assert.match(source, /to=\{`\/jobs\/\$\{job\.id\}\/daily-logs`\}/)
  assert.match(source, /data-testid="at-risk-missing-logs-row"/)
})
