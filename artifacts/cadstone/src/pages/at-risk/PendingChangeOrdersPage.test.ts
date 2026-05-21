import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./PendingChangeOrdersPage.tsx", import.meta.url), "utf8")

test("pending change orders drill-down warns when the dashboard sample is incomplete", () => {
  assert.match(
    source,
    /data\.atRisk\.pendingChangeOrders > data\.atRisk\.samples\.pendingChangeOrders\.length/,
  )
  assert.match(source, /Showing \{data\.atRisk\.samples\.pendingChangeOrders\.length\} sampled change orders out of \{data\.atRisk\.pendingChangeOrders\}/)
  assert.match(source, /Open the job financials report for the full list/)
})

test("pending change orders drill-down links sampled rows to job financials", () => {
  assert.match(source, /data\.atRisk\.samples\.pendingChangeOrders\.map\(\(co\) =>/)
  assert.match(source, /to=\{`\/jobs\/\$\{co\.jobId\}\/financials`\}/)
  assert.match(source, /formatCents\(co\.amountCents\)/)
  assert.match(source, /data-testid="at-risk-pending-co-row"/)
})
