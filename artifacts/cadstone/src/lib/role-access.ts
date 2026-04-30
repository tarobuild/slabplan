export type AppRole = "admin" | "project_manager" | "crew_member"

// Route-level role gates. Only routes whose backend reads are themselves
// restricted to admin/project_manager belong here. Resources is intentionally
// excluded: GET /resources/folders is open and access is enforced per-folder
// via `viewingPermissions` (which routinely admit crew members).
export const ROLE_GATES = {
  sales: ["admin", "project_manager"] as const,
  clients: ["admin", "project_manager"] as const,
} satisfies Record<string, ReadonlyArray<AppRole>>

export function hasRoleAccess(
  role: string | null | undefined,
  allow: ReadonlyArray<AppRole>,
): boolean {
  if (!role) {
    return false
  }

  return (allow as ReadonlyArray<string>).includes(role)
}
