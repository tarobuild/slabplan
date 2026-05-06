import { useEffect, useState } from "react"
import { Loader2, Save, User } from "lucide-react"
import {
  usersGetUsersMe,
  usersPutUsersMe,
  type UsersUpdateProfileSchema,
} from "@workspace/api-client-react"
import { UsersPutUsersMeBody } from "@workspace/api-zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"
import { validatePayload } from "@/lib/validate-payload"

type AuthUser = {
  id: string
  fullName: string
  email: string
  phone: string | null
  role: string
  avatarUrl: string | null
}

export default function ProfileSection() {
  useDocumentTitle("Profile · Settings")
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

  useEffect(() => {
    setLoadingProfile(true)
    usersGetUsersMe()
      .then((r) => {
        const u = (r as { user: AuthUser }).user
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

  const setProfile =
    (k: keyof typeof profileForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setProfileForm((f) => ({ ...f, [k]: e.target.value }))

  const emailChanged =
    profileForm.email.trim().toLowerCase() !== savedEmail.trim().toLowerCase()

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (emailChanged && !profileForm.currentPassword.trim()) {
      toast.error("Current password is required to change your email")
      return
    }

    setSavingProfile(true)
    try {
      const payload: UsersUpdateProfileSchema = {
        fullName: profileForm.fullName,
        email: profileForm.email,
        phone: profileForm.phone || null,
        currentPassword: emailChanged ? profileForm.currentPassword : null,
      }
      const validated = validatePayload(UsersPutUsersMeBody, payload)
      if (!validated) return
      const data = (await usersPutUsersMe(validated)) as { user: AuthUser }
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

  return (
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

              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="profile-timezone">Time Zone</Label>
                <Input
                  id="profile-timezone"
                  value={
                    typeof Intl !== "undefined"
                      ? Intl.DateTimeFormat().resolvedOptions().timeZone
                      : ""
                  }
                  readOnly
                  disabled
                  placeholder="America/Los_Angeles"
                />
                <p className="text-xs text-slate-500">
                  Detected from your browser. Per-account time-zone overrides are coming soon.
                </p>
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
  )
}
