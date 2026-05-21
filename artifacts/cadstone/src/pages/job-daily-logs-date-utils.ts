export type DailyLogFilterPreset =
  | "all"
  | "custom"
  | "today"
  | "today_onward"
  | "next_30"
  | "next_14"
  | "next_7"
  | "today_tomorrow"
  | "past_7"
  | "past_14"
  | "past_30"
  | "past_45"
  | "past_60"
  | "past_90"
  | "past_180"
  | "past_365"

export function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function todayString() {
  return localDateString()
}

export function toDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function toQueryDate(date: Date) {
  return localDateString(date)
}

export function addDays(date: Date, amount: number) {
  const next = toDateOnly(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function getDateRangeForPreset(
  preset: DailyLogFilterPreset,
  nowDate = new Date(),
) {
  const now = toDateOnly(nowDate)

  if (preset === "all") return { from: "", to: "" }
  if (preset === "custom") return null
  if (preset === "today") return { from: toQueryDate(now), to: toQueryDate(now) }
  if (preset === "today_onward") return { from: toQueryDate(now), to: "" }
  if (preset === "today_tomorrow") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 1)) }
  if (preset === "next_7") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 7)) }
  if (preset === "next_14") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 14)) }
  if (preset === "next_30") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 30)) }
  if (preset === "past_7") return { from: toQueryDate(addDays(now, -7)), to: toQueryDate(now) }
  if (preset === "past_14") return { from: toQueryDate(addDays(now, -14)), to: toQueryDate(now) }
  if (preset === "past_30") return { from: toQueryDate(addDays(now, -30)), to: toQueryDate(now) }
  if (preset === "past_45") return { from: toQueryDate(addDays(now, -45)), to: toQueryDate(now) }
  if (preset === "past_60") return { from: toQueryDate(addDays(now, -60)), to: toQueryDate(now) }
  if (preset === "past_90") return { from: toQueryDate(addDays(now, -90)), to: toQueryDate(now) }
  if (preset === "past_180") return { from: toQueryDate(addDays(now, -180)), to: toQueryDate(now) }
  return { from: toQueryDate(addDays(now, -365)), to: toQueryDate(now) }
}
