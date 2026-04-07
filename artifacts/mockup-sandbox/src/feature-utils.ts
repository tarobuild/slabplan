import { isAxiosError } from "axios"
import type { Dispatch, SetStateAction } from "react"

export type PaginationMeta = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export type UserOption = {
  id: string
  fullName: string
  email: string
  role: string
  avatarUrl: string | null
}

export type JobRecord = {
  id: string
  title: string
  status: string
  city: string | null
  state: string | null
  streetAddress: string | null
  zipCode: string | null
  jobType: string | null
  contractPrice: string | null
  projectedStart: string | null
  projectedCompletion: string | null
  actualStart: string | null
  actualCompletion: string | null
  workDays: string[] | null
  createdAt: string
  updatedAt: string
}

export type JobShellContext = {
  job: JobRecord
  refreshJob: () => Promise<JobRecord | null>
  setJob: Dispatch<SetStateAction<JobRecord | null>>
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) {
    return fallback
  }

  const message = error.response?.data?.message
  return typeof message === "string" ? message : fallback
}

export function formatCurrency(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "—"
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value))
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value)
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function buildLocation(parts: Array<string | null | undefined>) {
  const value = parts.filter(Boolean).join(", ")
  return value || "—"
}

export function ageInDays(value: string) {
  const now = Date.now()
  const created = new Date(value).getTime()
  return Math.max(0, Math.floor((now - created) / 86_400_000))
}

export function leadStatusClass(status: string) {
  const normalized = status.toLowerCase()

  if (normalized === "open") {
    return "border-blue-200 bg-blue-50 text-blue-700"
  }

  if (normalized === "in_negotiation") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }

  if (normalized === "won") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (normalized === "lost") {
    return "border-slate-200 bg-slate-100 text-slate-700"
  }

  return "border-slate-200 bg-slate-50 text-slate-500"
}

export function scheduleStatusClass(status: string) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (status === "overdue") {
    return "border-red-200 bg-red-50 text-red-700"
  }

  if (status === "upcoming") {
    return "border-blue-200 bg-blue-50 text-blue-700"
  }

  return "border-amber-200 bg-amber-50 text-amber-700"
}

export function draftStatusClass(status: string) {
  return status === "published"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700"
}

export function titleCaseStatus(value: string) {
  return value.replaceAll("_", " ")
}

function isWeekend(date: Date) {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

export function calculateBusinessEndDate(startDate: string, workDays: number) {
  const current = new Date(`${startDate}T00:00:00.000Z`)

  while (isWeekend(current)) {
    current.setUTCDate(current.getUTCDate() + 1)
  }

  let remaining = Math.max(workDays, 1)

  while (remaining > 1) {
    current.setUTCDate(current.getUTCDate() + 1)

    if (!isWeekend(current)) {
      remaining -= 1
    }
  }

  return current.toISOString().slice(0, 10)
}

export function cleanTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

export function truncateText(value: string, maxLength = 160) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}
