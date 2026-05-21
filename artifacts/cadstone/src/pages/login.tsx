import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authApi } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { APP_DESCRIPTION, APP_LOGO_PATH, APP_NAME, APP_TAGLINE } from "@/lib/brand"
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
    <div className="flex min-h-screen bg-background">
      {/* Left panel — brand identity (desktop only) */}
      <div
        className="relative hidden flex-col justify-between p-12 lg:flex lg:w-1/2"
        style={{
          backgroundColor: "hsl(var(--nav))",
          backgroundImage:
            "radial-gradient(circle at 22% 18%, hsl(var(--oxide) / 0.2), transparent 34%), repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 56px)",
        }}
      >
        {/* Top: logo */}
        <div>
          <img
            src={APP_LOGO_PATH}
            alt={APP_NAME}
            className="h-14 w-auto"
          />
        </div>

        {/* Center: headline + descriptor */}
        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-tight text-white">
            {APP_TAGLINE}
          </h1>
          <p className="mt-3 text-sm text-white/68">
            {APP_DESCRIPTION}
          </p>
        </div>

        {/* Bottom: stat pills */}
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80">
            Jobs
          </span>
          <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80">
            Daily Logs
          </span>
          <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80">
            Scheduling
          </span>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="app-surface flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Logo — mobile only (left panel shows it on lg) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <img
              src={APP_LOGO_PATH}
              alt={APP_NAME}
              className="h-12 w-auto"
            />
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
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
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full"
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
    </div>
  )
}
