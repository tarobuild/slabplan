export function parseUsdAmountCents(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const amount = Number(trimmed.replace(/[$,]/g, ""))
  if (!Number.isFinite(amount) || amount < 0) return null

  return Math.round(amount * 100)
}
