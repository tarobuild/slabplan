import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Lock, Mail } from "lucide-react"
import { Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  authGetAuthInvite,
  authPostAuthAcceptInvite,
  type AuthAcceptInviteSchema,
  type AuthInvitePreview,
} from "@workspace/api-client-react"
import { AuthPostAuthAcceptInviteBody } from "@workspace/api-zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { apiErrorMessage, toastApiError } from "@/lib/api-errors"
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
  const [email, setEmail] = useState("")
  const [invite, setInvite] = useState<AuthInvitePreview | null>(null)
  const [inviteLoading, setInviteLoading] = useState(() => Boolean(token))
  const [inviteError, setInviteError] = useState("")
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

  useEffect(() => {
    if (currentUser || !token) return

    let cancelled = false
    setInvite(null)
    setInviteError("")
    setInviteLoading(true)

    authGetAuthInvite({ token })
      .then((response) => {
        if (cancelled) return
        setInvite(response)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setInviteError(
          apiErrorMessage(err, "This setup link is invalid or has expired."),
        )
      })
      .finally(() => {
        if (!cancelled) setInviteLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentUser, token])

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  if (!token) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-semibold text-slate-900">
          This setup link is incomplete
        </h1>
        <p className="text-sm text-slate-600">
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

  if (inviteLoading) {
    return (
      <CenteredCard>
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Loader2 className="size-5 animate-spin" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            Checking setup link
          </h1>
          <p className="text-sm text-slate-600">
            We are confirming this invite before you create a password.
          </p>
        </div>
      </CenteredCard>
    )
  }

  if (inviteError || !invite) {
    return (
      <CenteredCard>
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertCircle className="size-5" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            This setup link cannot be used
          </h1>
          <p className="text-sm text-slate-600">
            {inviteError ||
              "Ask your administrator for a fresh invite link, then open it again."}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/login", { replace: true })}
          >
            Back to sign in
          </Button>
        </div>
      </CenteredCard>
    )
  }

  const normalizedEmail = email.trim().toLowerCase()
  const invitedEmail = invite.email.toLowerCase()
  const emailMatches = normalizedEmail === invitedEmail
  const showEmailMismatch = email.trim().length > 0 && !emailMatches
  const expiryLabel = formatInviteExpiry(invite.inviteTokenExpiresAt)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submittingRef.current) return

    if (!emailMatches) {
      toast.error("Enter the invited work email to continue.")
      return
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.")
      return
    }

    const payload: AuthAcceptInviteSchema = {
      token,
      email: normalizedEmail,
      password,
    }
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
          Confirm your work email, then choose a password to activate your{" "}
          {APP_NAME} account.
        </p>
      </div>
      <div className="space-y-2 border-y border-slate-200 py-3 text-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <div className="font-medium text-slate-900">{invite.fullName}</div>
            <div className="truncate text-slate-600">{invite.email}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
          <div>
            <span className="block uppercase">Role</span>
            <span className="text-sm font-medium text-slate-800">
              {roleLabel(invite.role)}
            </span>
          </div>
          <div>
            <span className="block uppercase">Link Expires</span>
            <span className="text-sm font-medium text-slate-800">
              {expiryLabel}
            </span>
          </div>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Confirm work email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="pl-9"
              placeholder={invite.email}
            />
          </div>
          {showEmailMismatch ? (
            <p className="text-xs text-red-600">
              Email must match the invited account.
            </p>
          ) : null}
        </div>
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

function roleLabel(role: AuthInvitePreview["role"]) {
  if (role === "project_manager") return "Project Manager"
  if (role === "crew_member") return "Crew Worker"
  if (role === "drafter") return "Drafter"
  return "Admin"
}

function formatInviteExpiry(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Soon"
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
      <Card className="w-full max-w-md border-[#E5E7EB] shadow-sm">
        <CardContent className="space-y-5 p-8">{children}</CardContent>
      </Card>
    </div>
  )
}
