/**
 * Percent-edit conflict math, hoisted out of the SOV row component
 * so it can be unit-tested independently of React (#275 follow-up).
 *
 * Background: invoices apply payments to specific SOV line items. If
 * an editor lowers a line item's "% complete" below the percent that
 * already-applied invoice payments imply, the backend will silently
 * shrink billed under the matched amount. We surface a confirm()
 * dialog before the PATCH runs so the editor can back out.
 *
 * Threshold: needsConfirm=true iff there's at least one cent already
 * applied to this line AND the projected billed under the new percent
 * is strictly less than the cents already applied.
 */
export type PercentLoweringInput = {
  scheduledValueCents: number
  newPercent: number
  payments: Array<{ amountCents: number }>
}

export type PercentLoweringResult = {
  needsConfirm: boolean
  proposedBilledCents: number
  appliedCents: number
}

export function describePercentLowering(
  input: PercentLoweringInput,
): PercentLoweringResult {
  const scheduled = Math.max(0, Math.floor(Number(input.scheduledValueCents) || 0))
  const proposedBilledCents = Math.round(
    (scheduled * Number(input.newPercent || 0)) / 100,
  )
  const appliedCents = (input.payments ?? []).reduce(
    (s, p) => s + Math.max(0, Number(p.amountCents) || 0),
    0,
  )
  return {
    needsConfirm: appliedCents > 0 && proposedBilledCents < appliedCents,
    proposedBilledCents,
    appliedCents,
  }
}
