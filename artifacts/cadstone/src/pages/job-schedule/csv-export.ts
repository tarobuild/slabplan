import type {
  ScheduleBaselineRecord,
  ScheduleItemRecord,
  ScheduleWorkdayException,
} from "@/lib/schedule"
import type { ScheduleExportKind } from "./types"

export type CsvCell = string | number | boolean | null | undefined

const FORMULA_LEADING_CHARACTER = /^[=+\-@\t\r]/

export function csvEscape(value: CsvCell): string {
  const rawText = value == null ? "" : String(value)
  const text = FORMULA_LEADING_CHARACTER.test(rawText) ? `'${rawText}` : rawText
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function rowsToCsv(rows: CsvCell[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n")
}

export function downloadCsv(filename: string, rows: CsvCell[][]) {
  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function buildScheduleCsvRows(items: ScheduleItemRecord[]) {
  return [
    [
      "Title",
      "Start Date",
      "End Date",
      "Work Days",
      "Start Time",
      "End Time",
      "Phase",
      "Status",
      "Progress",
      "Assigned",
    ],
    ...items.map((item) => [
      item.title,
      item.startDate,
      item.endDate,
      item.workDays,
      item.startTime,
      item.endTime,
      item.phaseName,
      item.isComplete ? "Complete" : "Open",
      item.progress,
      item.assignees.map((assignee) => assignee.fullName ?? assignee.email).join("; "),
    ]),
  ]
}

export function buildBaselineCsvRows(baseline: ScheduleBaselineRecord | null) {
  return [
    [
      "Item Title",
      "Baseline Start",
      "Baseline End",
      "Current Start",
      "Current End",
      "Shift Days",
    ],
    ...(baseline?.items ?? []).map((item) => [
      item.title,
      item.baselineStartDate,
      item.baselineEndDate,
      item.currentStartDate,
      item.currentEndDate,
      item.shiftDays,
    ]),
  ]
}

export function buildExceptionsCsvRows(exceptions: ScheduleWorkdayException[]) {
  return [
    [
      "Title",
      "Type",
      "Start Date",
      "End Date",
      "Same Every Year",
      "Category",
      "Applies To All Jobs",
      "Job IDs",
      "Notes",
    ],
    ...exceptions.map((exception) => [
      exception.title,
      exception.type,
      exception.startDate,
      exception.endDate,
      exception.sameEveryYear,
      exception.categoryName,
      exception.appliesToAllJobs,
      exception.jobIds.join("; "),
      exception.notes,
    ]),
  ]
}

export function buildScheduleExportRows(
  kind: ScheduleExportKind,
  input: {
    items: ScheduleItemRecord[]
    baseline: ScheduleBaselineRecord | null
    workdayExceptions: ScheduleWorkdayException[]
  },
) {
  if (kind === "schedule") return buildScheduleCsvRows(input.items)
  if (kind === "baseline") return buildBaselineCsvRows(input.baseline)
  return buildExceptionsCsvRows(input.workdayExceptions)
}
