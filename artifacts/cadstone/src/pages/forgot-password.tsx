import { useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle2, Mail } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { authApi } from "@/lib/api"
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand"

export default function ForgotPasswordPage() {
  useDocumentTitle("Reset password")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    try {
      await authApi.post("/auth/forgot-password", { email })
      setSent(true)
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Could not request a reset link")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-surface flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-9 flex justify-center">
          <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-[4.5rem] w-auto sm:h-20" />
        </div>
        {sent ? (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Check your email</h1>
              <p className="mt-3 leading-7 text-muted-foreground">
                If an active account exists for {email}, a secure reset link is on its way.
              </p>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-3xl font-semibold text-foreground">Reset your password</h1>
              <p className="mt-2 leading-7 text-muted-foreground">
                Enter your work email and we will send a one-time reset link.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-email">Work email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 pl-9 text-base"
                    required
                    autoFocus
                  />
                </div>
              </div>
              <Button type="submit" className="h-12 w-full" disabled={loading}>
                {loading ? "Sending..." : "Send reset link"}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm text-slate-500">
              <Link to="/login" className="font-medium text-primary hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
