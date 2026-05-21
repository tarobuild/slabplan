import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "AdminHomePage.tsx")
const source = readFileSync(sourcePath, "utf8")

describe("AdminHomePage recent leads", () => {
  it("links each recent lead row to the selected lead", () => {
    assert.match(
      source,
      /to=\{`\/sales\/leads\?lead=\$\{encodeURIComponent\(lead\.id\)\}`\}/,
    )
    assert.doesNotMatch(source, /recentLeads\.map[\s\S]*to="\/sales\/leads"/)
  })
})

describe("AdminHomePage financial values", () => {
  it("uses the shared cents formatter for open balances and invoice remaining amounts", () => {
    assert.match(source, /value=\{formatCents\(kpis\.arOutstandingCents\)\}/)
    assert.match(source, /value=\{formatCents\(kpis\.newContractValueThisMonthCents\)\}/)
    assert.match(source, /\{formatCents\(c\.openBalanceCents\)\}/)
    assert.match(source, /const remaining = Math\.max\(0, inv\.totalCents - inv\.paidCents\)/)
    assert.match(source, /\{formatCents\(remaining\)\}/)
  })
})
