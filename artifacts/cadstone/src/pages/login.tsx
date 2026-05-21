import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authApi } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand"
import { toast } from "sonner"

export default function LoginPage() {
  useDocumentTitle("Sign in")
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await authApi.post("/auth/login", { email, password })
      setAuth(data.user, data.accessToken)
      navigate("/dashboard", { replace: true })
      toast.success("Welcome back!")
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Invalid email or password")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-surface flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-10 flex justify-center">
          <img
            src={APP_LOGO_PATH}
            alt={APP_NAME}
            className="h-[4.5rem] w-auto sm:h-20"
          />
        </div>

        <div className="mb-6">
          <h1 className="text-4xl font-semibold text-foreground">Sign in</h1>
          <p className="mt-2 text-base text-muted-foreground">
            Welcome back to {APP_NAME}.
          </p>
        </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="h-12 text-base"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 text-base"
                required
              />
            </div>
            <Button
              type="submit"
              className="h-12 w-full text-base"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-500">
            New to {APP_NAME}?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create a workspace
            </Link>
          </p>
      </div>
    </div>
  )
}
