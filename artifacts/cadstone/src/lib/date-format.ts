const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function formatShortUsDate(value: string) {
  const dateOnly = DATE_ONLY_RE.exec(value)
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3]),
      )
    : new Date(value)

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
