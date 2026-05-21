export type AppRole = "admin" | "project_manager" | "crew_member"

// Route-level role gates. Only routes whose backend reads are themselves
// restricted to admins belong here. Resources is intentionally
// excluded: GET /resources/folders is open and access is enforced per-folder
// via `viewingPermissions` (which routinely admit crew members).
export const ROLE_GATES = {
  sales: ["admin"] as const,
  clients: ["admin"] as const,
  // Reports are admin-only (per task #322). PMs and crew get a 403 from
  // the backend; the nav link is hidden via this gate too.
  reports: ["admin"] as const,
  atRisk: ["admin", "project_manager"] as const,
  // Field users reach their assigned projects through My Jobs.
  myJobs: ["project_manager", "crew_member"] as const,
  // Company-wide Schedule and Daily Logs feeds (`/schedule`, `/daily-logs`)
  // are admin-only — PMs and crew see only per-job views.
  companyViews: ["admin"] as const,
} satisfies Record<string, ReadonlyArray<AppRole>>

// Roles that may perform write/mutation actions on Financials and Schedule
// (Set Baseline, Workday Exceptions, Settings save, Delete All Items, etc).
// PMs and crew get a read-only experience unless a dedicated workflow says
// otherwise. Convention: derive a local
// `canWrite = canWriteRole(user?.role)` and gate JSX on it.
export const WRITE_ROLES: ReadonlyArray<AppRole> = ["admin"]

export function canWriteRole(role: string | null | undefined): boolean {
  return hasRoleAccess(role, WRITE_ROLES)
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
