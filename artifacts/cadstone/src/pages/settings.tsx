import { useEffect, useState } from "react"
import { Loader2, Lock, Save, User } from "lucide-react"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"

type AuthUser = {
  id: string
  fullName: string
  email: string
  phone: string | null
  role: string
  avatarUrl: string | null
}

function getApiError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    return e.response?.data?.message ?? e.message ?? fallback
  }
  return fallback
}

export default function SettingsPage() {
  const { user: authUser, accessToken, setAuth } = useAuthStore()

  const [profileForm, setProfileForm] = useState({
    fullName: "",
    email: "",
    phone: "",
  })
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })
  const [savingPassword, setSavingPassword] = useState(false)

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
        })
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => setLoadingProfile(false))
  }, [])

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const { data } = await api.put("/users/me", {
        fullName: profileForm.fullName,
        email: profileForm.email,
        phone: profileForm.phone || null,
      })
      if (accessToken) {
        setAuth(data.user, accessToken)
      }
      toast.success("Profile updated")
    } catch (err: unknown) {
      toast.error(getApiError(err, "Failed to update profile"))
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
      toast.error(getApiError(err, "Failed to change password"))
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
