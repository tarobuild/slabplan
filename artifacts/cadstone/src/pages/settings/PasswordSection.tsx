import { useState } from "react"
import { Loader2, Lock } from "lucide-react"
import {
  usersPostUsersMePassword,
  type UsersChangePasswordSchema,
} from "@workspace/api-client-react"
import { UsersPostUsersMePasswordBody } from "@workspace/api-zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"
import { validatePayload } from "@/lib/validate-payload"

export default function PasswordSection() {
  useDocumentTitle("Password · Settings")
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })
  const [savingPassword, setSavingPassword] = useState(false)

  const setPassword =
    (k: keyof typeof passwordForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setPasswordForm((f) => ({ ...f, [k]: e.target.value }))

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
      const payload: UsersChangePasswordSchema = {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }
      const validated = validatePayload(UsersPostUsersMePasswordBody, payload)
      if (!validated) return
      await usersPostUsersMePassword(validated)
      toast.success("Password changed successfully")
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" })
    } catch (err: unknown) {
      toastApiError(err, "Failed to change password")
    } finally {
      setSavingPassword(false)
    }
  }

  return (
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
  )
}
