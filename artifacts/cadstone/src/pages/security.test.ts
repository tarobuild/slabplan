import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./security.tsx", import.meta.url), "utf8")

test("security page clearly separates provider attestations from SlabPlan status", () => {
  assert.match(source, /Replit and Supabase maintain SOC 2 Type II attestations/)
  assert.match(source, /SlabPlan does not currently claim its own independent SOC 2\s+report/)
  assert.doesNotMatch(source, /SlabPlan is SOC 2 (certified|compliant|attested)/i)
})

test("security page documents current application safeguards and reporting", () => {
  for (const requiredCopy of [
    "Tenant and role boundaries",
    "Private file access",
    "Authentication and sessions",
    "Application defenses",
    "Operational monitoring",
    "Responsible disclosure",
  ]) {
    assert.match(source, new RegExp(requiredCopy))
  }
})
