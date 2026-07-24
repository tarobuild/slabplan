export type AppRole = "admin" | "project_manager" | "crew_member" | "drafter"

// Route-level role gates. Only routes whose backend reads are themselves
// restricted to admins belong here. Resources is intentionally
// excluded: GET /resources/folders is open and access is enforced per-folder
// via `viewingPermissions` (which routinely admit crew members).
export const ROLE_GATES = {
  sales: ["admin", "drafter"] as const,
  clients: ["admin"] as const,
  // Reports are admin-only (per task #322). PMs and crew get a 403 from
  // the backend; the nav link is hidden via this gate too.
  reports: ["admin"] as const,
  // Field users and explicitly assigned drafters reach their assigned projects through My Jobs.
  myJobs: ["project_manager", "crew_member", "drafter"] as const,
  // PM Home at-risk drilldowns render PM-specific dashboard payloads.
  atRisk: ["project_manager"] as const,
  // Drafters work from the company Schedule list but do not get the
  // admin-only company Daily Logs feed.
  schedule: ["admin", "drafter"] as const,
  dailyLogs: ["admin"] as const,
  companyViews: ["admin"] as const,
} satisfies Record<string, ReadonlyArray<AppRole>>

// Roles that may perform write/mutation actions on Financials and Schedule
// (Set Baseline, Workday Exceptions, Settings save, Delete All Items, etc).
// PMs and crew get a read-only experience unless a dedicated workflow says
// otherwise. Convention: derive a local
// `canWrite = canWriteRole(user?.role)` and gate JSX on it.
export const WRITE_ROLES: ReadonlyArray<AppRole> = ["admin"]

export const SCHEDULE_ITEM_CREATE_ROLES: ReadonlyArray<AppRole> = ["admin", "drafter"]

export function canWriteRole(role: string | null | undefined): boolean {
  return hasRoleAccess(role, WRITE_ROLES)
}

export function canCreateScheduleItemRole(role: string | null | undefined): boolean {
  return hasRoleAccess(role, SCHEDULE_ITEM_CREATE_ROLES)
}

export function hasRoleAccess(
  role: string | null | undefined,
  allow: ReadonlyArray<AppRole>,
): boolean {
  if (!role) {
    return false
  }

  return (allow as ReadonlyArray<string>).includes(role)
}
