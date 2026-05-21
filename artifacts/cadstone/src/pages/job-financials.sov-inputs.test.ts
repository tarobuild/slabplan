import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./job-financials.tsx", import.meta.url), "utf8")
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

test("SOV uncontrolled edit inputs remount when persisted values change", () => {
  for (const key of [
    "desc-${li.description}",
    "qty-${li.qty}",
    "rate-${li.rateCents}",
    "sched-${li.scheduledValueCents}",
    "pct-${li.percentComplete}",
  ]) {
    assert.match(source, new RegExp(`key=\\{\\\`${escapeRegex(key)}\\\`\\}`))
  }
})
