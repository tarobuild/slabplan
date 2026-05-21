import assert from "node:assert/strict"
import test from "node:test"
import { parseUsdAmountCents } from "./money-input.ts"

test("parseUsdAmountCents parses valid USD amounts", () => {
  assert.equal(parseUsdAmountCents("123.45"), 12345)
  assert.equal(parseUsdAmountCents("$1,234.56"), 123456)
  assert.equal(parseUsdAmountCents("0"), 0)
})

test("parseUsdAmountCents rejects invalid or negative amounts", () => {
  assert.equal(parseUsdAmountCents(""), null)
  assert.equal(parseUsdAmountCents("not a number"), null)
  assert.equal(parseUsdAmountCents("-1"), null)
  assert.equal(parseUsdAmountCents("Infinity"), null)
})
