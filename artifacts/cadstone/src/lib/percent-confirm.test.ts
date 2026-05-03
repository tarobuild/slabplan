import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { describePercentLowering } from "./percent-confirm.ts"

describe("describePercentLowering", () => {
  test("needs confirm when projected billed dips below already-applied payments", () => {
    // $5,000 scheduled, $4,000 applied across two invoices, editor
    // tries to drop % complete to 50% → projected $2,500 billed which
    // is below the $4,000 already matched. Must prompt.
    const result = describePercentLowering({
      scheduledValueCents: 500_000,
      newPercent: 50,
      payments: [{ amountCents: 250_000 }, { amountCents: 150_000 }],
    })
    assert.equal(result.needsConfirm, true)
    assert.equal(result.proposedBilledCents, 250_000)
    assert.equal(result.appliedCents, 400_000)
  })

  test("no confirm when no payments are applied yet", () => {
    // Brand-new line — editor can pick any %; backend will recompute
    // billed and there is nothing to under-shoot.
    const result = describePercentLowering({
      scheduledValueCents: 100_000,
      newPercent: 25,
      payments: [],
    })
    assert.equal(result.needsConfirm, false)
    assert.equal(result.proposedBilledCents, 25_000)
    assert.equal(result.appliedCents, 0)
  })

  test("no confirm when projected billed exactly meets the applied amount", () => {
    // Boundary: editor sets % so projected billed equals the cents
    // already applied — that's a no-op for the matched payments and
    // shouldn't bother the user with a confirm.
    const result = describePercentLowering({
      scheduledValueCents: 100_000,
      newPercent: 40,
      payments: [{ amountCents: 40_000 }],
    })
    assert.equal(result.needsConfirm, false)
    assert.equal(result.proposedBilledCents, 40_000)
    assert.equal(result.appliedCents, 40_000)
  })

  test("no confirm when raising % complete above current applied", () => {
    // Editor is increasing % — projected billed grows — never a
    // conflict against past payments.
    const result = describePercentLowering({
      scheduledValueCents: 100_000,
      newPercent: 90,
      payments: [{ amountCents: 50_000 }],
    })
    assert.equal(result.needsConfirm, false)
    assert.equal(result.proposedBilledCents, 90_000)
    assert.equal(result.appliedCents, 50_000)
  })

  test("treats negative or NaN amounts as zero (defensive)", () => {
    // The backend always sends non-negative ints, but the helper is
    // pure UI math — defend against bad data so we never confirm on
    // garbage inputs.
    const result = describePercentLowering({
      scheduledValueCents: 100_000,
      newPercent: 50,
      payments: [
        { amountCents: -10_000 },
        { amountCents: Number.NaN },
        { amountCents: 30_000 },
      ],
    })
    assert.equal(result.appliedCents, 30_000)
    assert.equal(result.proposedBilledCents, 50_000)
    // 50,000 projected ≥ 30,000 applied → no confirm.
    assert.equal(result.needsConfirm, false)
  })

  test("rounds projected billed to the nearest cent", () => {
    // 1/3 of $100.00 — backend uses integer cents, so we round.
    const result = describePercentLowering({
      scheduledValueCents: 10_000,
      newPercent: 33,
      payments: [{ amountCents: 4_000 }],
    })
    assert.equal(result.proposedBilledCents, 3_300)
    assert.equal(result.needsConfirm, true)
  })
})
