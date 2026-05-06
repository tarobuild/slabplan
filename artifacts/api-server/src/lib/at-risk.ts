// At-risk classifier helpers used by the role-aware Home page (PM layout).
//
// Each rule is a pure function so they can be unit-tested without a database
// or HTTP layer. The route layer feeds them rows that have already been
// loaded with the right access filters applied; this file is intentionally
// agnostic about how those rows were fetched.

export type ScheduleItemAtRiskInput = {
  id: string;
  endDate: string | null; // YYYY-MM-DD
  isComplete: boolean | null;
  progress: number | null;
};

type DailyLogActivityInput = {
  jobId: string;
  logDate: string; // YYYY-MM-DD
};

export type ChangeOrderAtRiskInput = {
  id: string;
  status: string;
};

export type InvoiceAtRiskInput = {
  id: string;
  invoiceDate: string | null; // YYYY-MM-DD
  totalCents: number;
  paidCents: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** A schedule item is overdue when its end date is before `today` (YYYY-MM-DD)
 *  and it is neither marked complete nor at 100 % progress. */
export function isScheduleItemOverdue(
  item: ScheduleItemAtRiskInput,
  today: string,
): boolean {
  if (!item.endDate) return false;
  const done = item.isComplete === true || (item.progress ?? 0) >= 100;
  if (done) return false;
  return item.endDate < today;
}

/** A change order is at-risk-pending when its status is exactly `pending`.
 *  Approved/rejected change orders are not flagged. */
export function isChangeOrderPending(co: ChangeOrderAtRiskInput): boolean {
  return co.status === "pending";
}

/** Past-due rule for invoices. We don't have a stored `dueDate` column, so
 *  the rule treats an invoice as past-due when (a) it has any unpaid balance
 *  and (b) its `invoiceDate` is more than `netDays` days old (default 30). */
export function isInvoicePastDue(
  invoice: InvoiceAtRiskInput,
  today: string,
  netDays = 30,
): boolean {
  if (invoice.totalCents <= invoice.paidCents) return false;
  if (!invoice.invoiceDate) return false;
  const ageDays = daysBetweenIso(invoice.invoiceDate, today);
  return ageDays > netDays;
}

/** Returns the count of working days (Mon-Fri by default) strictly between
 *  `from` (exclusive) and `to` (inclusive). Used by the "no daily log in
 *  last N working days" rule. */
export function workingDaysBetween(
  fromIso: string,
  toIso: string,
  workingDayOfWeek: (dayOfWeek: number) => boolean = (d) => d >= 1 && d <= 5,
): number {
  if (fromIso >= toIso) return 0;
  let cursor = isoToUtc(fromIso) + ONE_DAY_MS;
  const end = isoToUtc(toIso);
  let count = 0;
  while (cursor <= end) {
    const dow = new Date(cursor).getUTCDay();
    if (workingDayOfWeek(dow)) count += 1;
    cursor += ONE_DAY_MS;
  }
  return count;
}

/** From a list of jobs and their last-log-date map, return the ids of jobs
 *  whose most recent daily log is older than `nWorkingDays` working days
 *  (or that have no logs at all). */
export function jobsMissingDailyLogs(
  jobIds: string[],
  lastLogDateByJob: Map<string, string | null>,
  today: string,
  nWorkingDays: number,
): string[] {
  const result: string[] = [];
  for (const jobId of jobIds) {
    const last = lastLogDateByJob.get(jobId) ?? null;
    if (last === null) {
      result.push(jobId);
      continue;
    }
    if (last >= today) continue; // logged today or in the future
    const wd = workingDaysBetween(last, today);
    if (wd >= nWorkingDays) result.push(jobId);
  }
  return result;
}

function isoToUtc(iso: string): number {
  // Parse as UTC noon to dodge DST/timezone surprises.
  return Date.parse(`${iso}T12:00:00Z`);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.floor((isoToUtc(toIso) - isoToUtc(fromIso)) / ONE_DAY_MS);
}
