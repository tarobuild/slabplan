import { useCallback, useEffect, useState } from "react"
import { Copy, KeyRound, Loader2, Lock, Plus, Save, Trash2, User } from "lucide-react"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"

type ApiToken = {
  id: string
  name: string
  scope: "read" | "read_write"
  tokenPrefix: string
  lastFour: string
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

function formatTokenDate(value: string | null): string {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

type AuthUser = {
  id: string
  fullName: string
  email: string
  phone: string | null
  role: string
  avatarUrl: string | null
}

export default function SettingsPage() {
  useDocumentTitle("Settings")
  const { user: authUser, accessToken, setAuth } = useAuthStore()

  const [profileForm, setProfileForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    currentPassword: "",
  })
  const [savedEmail, setSavedEmail] = useState("")
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })
  const [savingPassword, setSavingPassword] = useState(false)

  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loadingTokens, setLoadingTokens] = useState(true)
  const [tokenName, setTokenName] = useState("")
  const [tokenScope, setTokenScope] = useState<"read" | "read_write">("read_write")
  const [tokenExpiresInDays, setTokenExpiresInDays] = useState<"never" | "30" | "90" | "180" | "365">("never")
  const [creatingToken, setCreatingToken] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const refreshTokens = useCallback(async () => {
    setLoadingTokens(true)
    try {
      const r = await api.get<{ tokens: ApiToken[] }>("/account/tokens")
      setTokens(r.data.tokens)
    } catch (err: unknown) {
      toastApiError(err, "Failed to load tokens")
    } finally {
      setLoadingTokens(false)
    }
  }, [])

  useEffect(() => {
    void refreshTokens()
  }, [refreshTokens])

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = tokenName.trim()
    if (!name) {
      toast.error("Token name is required")
      return
    }
    setCreatingToken(true)
    try {
      const expiresAt =
        tokenExpiresInDays === "never"
          ? null
          : new Date(Date.now() + Number(tokenExpiresInDays) * 24 * 60 * 60 * 1000).toISOString()

      const { data } = await api.post<{ token: ApiToken; secret: string }>(
        "/account/tokens",
        { name, scope: tokenScope, expiresAt },
      )
      setRevealedSecret(data.secret)
      setTokenName("")
      setTokenExpiresInDays("never")
      setTokens((prev) => [data.token, ...prev])
      toast.success("Token created — copy it now, it won't be shown again.")
    } catch (err: unknown) {
      toastApiError(err, "Failed to create token")
    } finally {
      setCreatingToken(false)
    }
  }

  const handleRevoke = async (token: ApiToken) => {
    if (token.revokedAt) return
    if (!window.confirm(`Revoke "${token.name}"? Apps using this token will stop working.`)) return
    setRevokingId(token.id)
    try {
      await api.delete(`/account/tokens/${token.id}`)
      toast.success("Token revoked")
      await refreshTokens()
    } catch (err: unknown) {
      toastApiError(err, "Failed to revoke token")
    } finally {
      setRevokingId(null)
    }
  }

  const copySecret = async () => {
    if (!revealedSecret) return
    try {
      await navigator.clipboard.writeText(revealedSecret)
      toast.success("Token copied to clipboard")
    } catch {
      toast.error("Could not copy — please select and copy manually.")
    }
  }

  useEffect(() => {
    setLoadingProfile(true)
    api
      .get("/users/me")
      .then((r) => {
        const u: AuthUser = r.data.user
        setProfileForm({
          fullName: u.fullName,
          email: u.email,
          phone: u.phone ?? "",
          currentPassword: "",
        })
        setSavedEmail(u.email)
      })
      .catch((err: unknown) => toastApiError(err, "Failed to load profile"))
      .finally(() => setLoadingProfile(false))
  }, [])

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const emailChanged = profileForm.email.trim().toLowerCase() !== savedEmail.trim().toLowerCase()

    if (emailChanged && !profileForm.currentPassword.trim()) {
      toast.error("Current password is required to change your email")
      return
    }

    setSavingProfile(true)
    try {
      const { data } = await api.put("/users/me", {
        fullName: profileForm.fullName,
        email: profileForm.email,
        phone: profileForm.phone || null,
        currentPassword: emailChanged ? profileForm.currentPassword : null,
      })
      if (accessToken) {
        setAuth(data.user, accessToken)
      }
      setSavedEmail(data.user.email)
      setProfileForm({
        fullName: data.user.fullName,
        email: data.user.email,
        phone: data.user.phone ?? "",
        currentPassword: "",
      })
      toast.success("Profile updated")
    } catch (err: unknown) {
      toastApiError(err, "Failed to update profile")
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("New passwords do not match")
      return
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error("New password must be at least 8 characters")
      return
    }
    setSavingPassword(true)
    try {
      await api.post("/users/me/password", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      toast.success("Password changed successfully")
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" })
    } catch (err: unknown) {
      toastApiError(err, "Failed to change password")
    } finally {
      setSavingPassword(false)
    }
  }

  const setProfile =
    (k: keyof typeof profileForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setProfileForm((f) => ({ ...f, [k]: e.target.value }))

  const setPassword =
    (k: keyof typeof passwordForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setPasswordForm((f) => ({ ...f, [k]: e.target.value }))

  const emailChanged = profileForm.email.trim().toLowerCase() !== savedEmail.trim().toLowerCase()

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Account Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your profile and security settings</p>
      </div>

      {/* Profile Card */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center gap-2.5">
          <User className="size-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">Profile</h2>
        </div>

        <div className="px-6 py-6">
          {loadingProfile ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-9 rounded-md bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <form onSubmit={handleProfileSave} className="space-y-5">
              <div className="flex items-center gap-4 mb-2">
                <div className="size-14 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white text-xl font-bold select-none">
                  {profileForm.fullName?.charAt(0)?.toUpperCase() ?? "?"}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{profileForm.fullName}</p>
                  <p className="text-xs text-slate-500 capitalize">{authUser?.role ?? "user"}</p>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="profile-name">Full Name</Label>
                  <Input
                    id="profile-name"
                    value={profileForm.fullName}
                    onChange={setProfile("fullName")}
                    required
                    minLength={2}
                    placeholder="Your full name"
                  />
                </div>

                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="profile-email">Email Address</Label>
                  <Input
                    id="profile-email"
                    type="email"
                    value={profileForm.email}
                    onChange={setProfile("email")}
                    required
                    placeholder="you@example.com"
                  />
                </div>

                {emailChanged ? (
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="profile-current-password">Current Password</Label>
                    <Input
                      id="profile-current-password"
                      type="password"
                      value={profileForm.currentPassword}
                      onChange={setProfile("currentPassword")}
                      required
                      autoComplete="current-password"
                      placeholder="Required to confirm your email change"
                    />
                  </div>
                ) : null}

                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="profile-phone">Phone Number</Label>
                  <Input
                    id="profile-phone"
                    type="tel"
                    value={profileForm.phone}
                    onChange={setProfile("phone")}
                    placeholder="(555) 000-0000"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={savingProfile}>
                  {savingProfile ? (
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-3.5" />
                  )}
                  Save Profile
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* API Access Tokens Card */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center gap-2.5">
          <KeyRound className="size-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">API Access Tokens</h2>
        </div>

        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-slate-600">
            Personal access tokens let scripts and AI agents call the CAD Stone API on your behalf.
            Each token starts with <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">cs_pat_</code>.
            Use it as a Bearer token. The token is shown once at creation — keep it secret.
          </p>

          <form onSubmit={handleCreateToken} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="e.g. Reporting bot"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token-scope">Scope</Label>
                <select
                  id="token-scope"
                  value={tokenScope}
                  onChange={(e) => setTokenScope(e.target.value as "read" | "read_write")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="read_write">Read &amp; write</option>
                  <option value="read">Read only</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token-expires">Expires</Label>
                <select
                  id="token-expires"
                  value={tokenExpiresInDays}
                  onChange={(e) =>
                    setTokenExpiresInDays(e.target.value as typeof tokenExpiresInDays)
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="never">Never</option>
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                  <option value="180">In 180 days</option>
                  <option value="365">In 1 year</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={creatingToken}>
                {creatingToken ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-2 size-3.5" />
                )}
                Create token
              </Button>
            </div>
          </form>

          {revealedSecret ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
              <p className="text-sm font-medium text-amber-900">
                Copy this token now — it will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={revealedSecret}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="sm" onClick={copySecret}>
                  <Copy className="size-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRevealedSecret(null)}>
                  Done
                </Button>
              </div>
            </div>
          ) : null}

          <Separator />

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Existing tokens</h3>
            {loadingTokens ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-md bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : tokens.length === 0 ? (
              <p className="text-sm text-slate-500">You haven't created any tokens yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Token</th>
                      <th className="py-2 pr-3">Scope</th>
                      <th className="py-2 pr-3">Last used</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => {
                      const status = t.revokedAt
                        ? "Revoked"
                        : t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()
                          ? "Expired"
                          : "Active"
                      const isActive = status === "Active"
                      return (
                        <tr key={t.id} className="border-t border-slate-100">
                          <td className="py-2 pr-3 font-medium text-slate-800">{t.name}</td>
                          <td className="py-2 pr-3 font-mono text-xs text-slate-500">
                            {t.tokenPrefix}…{t.lastFour}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">
                            {t.scope === "read" ? "Read only" : "Read & write"}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">{formatTokenDate(t.lastUsedAt)}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
                                (isActive
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-100 text-slate-600")
                              }
                            >
                              {status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right">
                            {isActive ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRevoke(t)}
                                disabled={revokingId === t.id}
                                aria-label={`Revoke ${t.name}`}
                              >
                                {revokingId === t.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="size-3.5 text-red-500" />
                                )}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Password Card */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center gap-2.5">
          <Lock className="size-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">Change Password</h2>
        </div>

        <div className="px-6 py-6">
          <form onSubmit={handlePasswordSave} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={passwordForm.currentPassword}
                onChange={setPassword("currentPassword")}
                required
                autoComplete="current-password"
                placeholder="Enter your current password"
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={setPassword("newPassword")}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={setPassword("confirmPassword")}
                  required
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                />
              </div>

              {passwordForm.newPassword &&
                passwordForm.confirmPassword &&
                passwordForm.newPassword !== passwordForm.confirmPassword && (
                  <p className="text-xs text-red-500">Passwords do not match</p>
                )}
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <Lock className="mr-2 size-3.5" />
                )}
                Update Password
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
