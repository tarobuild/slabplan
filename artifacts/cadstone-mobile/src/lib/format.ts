export function formatShortDate(value?: string | null): string {
  if (!value) return "Not scheduled";
  const dateOnly = value.slice(0, 10);
  const [year, month, day] = dateOnly.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

export function formatDateRange(start?: string | null, end?: string | null): string {
  const startLabel = formatShortDate(start);
  if (!end || end === start) return startLabel;
  return `${startLabel} - ${formatShortDate(end)}`;
}

export function formatTime(value?: string | null): string | null {
  if (!value) return null;
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

export function formatJobLocation(job: {
  city?: string | null;
  state?: string | null;
  streetAddress?: string | null;
}): string {
  const cityState = [job.city, job.state].filter(Boolean).join(", ");
  return [job.streetAddress, cityState].filter(Boolean).join(" • ") || "No address";
}

export function titleCaseStatus(status?: string | null): string {
  if (!status) return "Unknown";
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatPercent(value?: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export function formatFileSize(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Unknown size";
  }
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

export function formatCurrencyCents(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not available";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatPersonRole(role?: string | null): string {
  if (role === "project_manager") return "Project manager";
  if (role === "crew_member") return "Crew";
  if (role === "admin") return "Admin";
  return titleCaseStatus(role);
}

export function formatWorkDays(days?: string[] | null): string {
  if (!days || days.length === 0) return "Not set";
  const labels: Record<string, string> = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  };
  return days.map((day) => labels[day] ?? titleCaseStatus(day)).join(", ");
}
