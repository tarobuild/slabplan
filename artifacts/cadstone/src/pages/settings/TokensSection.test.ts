import assert from "node:assert/strict"
import { test } from "node:test"
import { canCreateToken } from "./TokensSection.tsx"

test("token create form is blocked while a one-time secret is visible", () => {
  assert.equal(canCreateToken(false, null), true)
  assert.equal(canCreateToken(true, null), false)
  assert.equal(canCreateToken(false, "cs_pat_secret"), false)
  assert.equal(canCreateToken(true, "cs_pat_secret"), false)
})
