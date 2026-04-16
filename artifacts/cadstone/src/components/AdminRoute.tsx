import { Navigate, Outlet } from "react-router-dom"
import { useAuthStore } from "@/store/auth"

/**
 * Route guard that only admits users whose role is `admin`.
 * Non-admins are redirected to /403. Assumes the route is already
 * nested inside `ProtectedRoute`, so `user` is guaranteed non-null
 * by the time this runs.
 */
export default function AdminRoute() {
  const user = useAuthStore((state) => state.user)

  if (user?.role !== "admin") {
    return <Navigate to="/403" replace />
  }

  return <Outlet />
}
