import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Lock } from "lucide-react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  authPostAuthAcceptInvite,
  type AuthAcceptInviteSchema,
} from "@workspace/api-client-react"
import { AuthPostAuthAcceptInviteBody } from "@workspace/api-zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toastApiError } from "@/lib/api-errors"
import { APP_NAME } from "@/lib/brand"
import { validatePayload } from "@/lib/validate-payload"
import { useAuthStore } from "@/store/auth"
import type { AuthUser } from "@/store/auth"

type AcceptInviteResponse = {
  accessToken: string
  user: AuthUser
}

export default function AcceptInvitePage() {
  useDocumentTitle("Set your password")
  const [searchParams] = useSearchParams()
  const token = useMemo(
    () => searchParams.get("token")?.trim() ?? "",
    [searchParams],
  )
  const navigate = useNavigate()
  const setAuth = useAuthStore((state) => state.setAuth)
  const currentUser = useAuthStore((state) => state.user)

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  // If somebody is already logged in and follows an invite link in the same
  // browser session, the safest UX is to send them to the dashboard rather
  // than silently swap their session for the invitee's. They can sign out
  // first if they really meant to accept the invite as someone else.
  useEffect(() => {
    if (currentUser && token) {
      toast.info(
        "You're already signed in. Sign out first if you want to accept this invite.",
      )
    }
  }, [currentUser, token])

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  if (!token) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold text-foreground">
          This setup link is incomplete
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask your administrator for a fresh invite link, then open it again.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/login", { replace: true })}
        >
          Back to sign in
        </Button>
      </CenteredCard>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.")
      return
    }

    const payload: AuthAcceptInviteSchema = { token, password }
    const validated = validatePayload(AuthPostAuthAcceptInviteBody, payload)
    if (!validated) return

    submittingRef.current = true
    setSubmitting(true)
    try {
      const response = (await authPostAuthAcceptInvite(
        validated,
      )) as AcceptInviteResponse
      setAuth(response.user, response.accessToken)
      toast.success(`Welcome to ${APP_NAME}, ${response.user.fullName}.`)
      navigate("/dashboard", { replace: true })
    } catch (err: unknown) {
      toastApiError(err, "Could not accept invite")
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <CenteredCard>
      <div className="space-y-1.5 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="size-5" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          Set your password
        </h1>
        <p className="text-sm text-slate-600">
          Choose a password to finish setting up your {APP_NAME} account. You'll
          use it together with your work email to sign in.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invite-password">New password</Label>
          <Input
            id="invite-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-confirm">Confirm password</Label>
          <Input
            id="invite-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Repeat your new password"
          />
        </div>
        {confirm && password !== confirm ? (
          <p className="text-xs text-red-600">Passwords do not match.</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? (
            <Loader2 className="mr-2 size-3.5 animate-spin" />
          ) : (
            <Lock className="mr-2 size-3.5" />
          )}
          Activate account
        </Button>
      </form>
    </CenteredCard>
  )
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-surface flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-border bg-card shadow-sm">
        <CardContent className="space-y-5 p-8">{children}</CardContent>
      </Card>
    </div>
  )
}
