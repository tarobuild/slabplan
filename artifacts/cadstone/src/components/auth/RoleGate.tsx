import React, { type ReactNode } from "react"
import { Navigate, Outlet } from "react-router-dom"
import { useAuthStore } from "@/store/auth"
import { hasRoleAccess, type AppRole } from "@/lib/role-access"

type RoleGateProps = {
  allow: ReadonlyArray<AppRole>
  redirectTo?: string
  children?: ReactNode
}

/**
 * Renders its children (or `<Outlet />` when used as a route element) only if
 * the signed-in user's role is in the `allow` list. Unauthorized users are
 * sent to a sensible page (the dashboard by default), which avoids the empty
 * pages and "Forbidden" toasts that the backend produces when the request
 * actually reaches the API.
 *
 * Assumes the route is already nested inside `ProtectedRoute`, so `user` is
 * normally non-null by the time this runs. If the store somehow has no user,
 * we redirect rather than render.
 */
export default function RoleGate({
  allow,
  redirectTo = "/dashboard",
  children,
}: RoleGateProps) {
  const user = useAuthStore((state) => state.user)

  if (!hasRoleAccess(user?.role, allow)) {
    return <Navigate to={redirectTo} replace />
  }

  return children !== undefined ? <>{children}</> : <Outlet />
}
