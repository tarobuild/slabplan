import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authApi } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"

export default function LoginPage() {
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
    <div className="flex min-h-screen">
      {/* Left panel — brand identity (desktop only) */}
      <div
        className="relative hidden flex-col justify-between p-12 lg:flex lg:w-1/2"
        style={{
          backgroundColor: "#1D1D1D",
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 60px)",
        }}
      >
        {/* Top: logo */}
        <div>
          <img
            src="/cad-logo.png"
            alt="CAD Stone Networks"
            className="h-14 w-auto"
          />
        </div>

        {/* Center: headline + descriptor */}
        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-tight text-white">
            Built for the stone trade.
          </h1>
          <p className="mt-3 text-sm text-white/60">
            Manage every job, crew, and deadline — from the office or the field.
          </p>
        </div>

        {/* Bottom: stat pills */}
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
            Jobs
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
            Daily Logs
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
            Scheduling
          </span>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full items-center justify-center bg-white px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Logo — mobile only (left panel shows it on lg) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <img
              src="/cad-logo.png"
              alt="CAD Stone Networks"
              className="h-12 w-auto"
            />
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500">
              Welcome back to CAD Stone Networks.
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
              variant="orange"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
