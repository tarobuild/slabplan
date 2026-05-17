import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Copy, Loader2, Mail, Plus, RotateCw, Send, UserPlus } from "lucide-react"
import { toast } from "sonner"
import {
  getUsersGetUsersQueryKey,
  useUsersGetUsers,
  usersPatchUsersId,
  usersPostUsers,
  usersPostUsersIdInvite,
  usersPostUsersIdInviteResend,
  type UsersInviteUserSchema,
  type UsersUpdateUserSchema,
} from "@workspace/api-client-react"
import {
  UsersPatchUsersIdBody,
  UsersPostUsersBody,
} from "@workspace/api-zod"
import { useAuthStore } from "@/store/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toastApiError } from "@/lib/api-errors"
import { validatePayload } from "@/lib/validate-payload"

type AdminUser = {
  id: string
  email: string
  fullName: string
  role: "admin" | "project_manager" | "crew_member"
  phone: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
  isActive?: boolean
  passwordSetAt?: string | null
  inviteTokenExpiresAt?: string | null
  lastInviteEmailSentAt?: string | null
  lastInviteEmailError?: string | null
}

type EmailDelivery = {
  emailed: boolean
  emailError: string | null
  lastInviteEmailSentAt: string | null
}

type InviteResponse = {
  user: AdminUser
  inviteToken: string
  invitePath: string
  inviteUrl?: string
  inviteTokenExpiresAt: string
  emailDelivery?: EmailDelivery
}

const ROLE_OPTIONS: Array<{ value: AdminUser["role"]; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "project_manager", label: "Project manager" },
  { value: "crew_member", label: "Crew member" },
]

function roleLabel(role: AdminUser["role"]) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
}

function buildAbsoluteInviteLink(invitePath: string): string {
  if (typeof window === "undefined") return invitePath
  // BASE_URL may include a deployed subpath; strip the trailing "/"
  // and prepend it to the relative invitePath ("/accept-invite?token=…")
  // so we don't double-up slashes when combining with origin.
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "")
  return `${window.location.origin}${base}${invitePath}`
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success("Copied to clipboard")
  } catch {
    toast.error("Could not copy — please select and copy manually.")
  }
}

export default function UsersPage() {
  useDocumentTitle("Users")
  const me = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()

  const [includeInactive, setIncludeInactive] = useState(false)
  const params = useMemo(
    () => ({ includeInactive, limit: 200 }),
    [includeInactive],
  )

  const usersQuery = useUsersGetUsers(params, {
    query: {
      queryKey: getUsersGetUsersQueryKey(params),
      staleTime: 30_000,
    },
  })

  useEffect(() => {
    if (usersQuery.error) {
      toastApiError(usersQuery.error, "Failed to load users")
    }
  }, [usersQuery.error])

  const rows = useMemo<AdminUser[]>(() => {
    const data = usersQuery.data as
      | { users?: AdminUser[]; data?: AdminUser[] }
      | undefined
    return data?.users ?? data?.data ?? []
  }, [usersQuery.data])

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    email: "",
    fullName: "",
    role: "crew_member" as AdminUser["role"],
  })
  const [inviting, setInviting] = useState(false)
  const [latestInvite, setLatestInvite] = useState<InviteResponse | null>(null)

  const [pendingPatchId, setPendingPatchId] = useState<string | null>(null)
  const [reissuingId, setReissuingId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  const refreshList = () =>
    queryClient.invalidateQueries({
      queryKey: getUsersGetUsersQueryKey(),
    })

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: UsersInviteUserSchema = {
      email: inviteForm.email.trim().toLowerCase(),
      fullName: inviteForm.fullName.trim(),
      role: inviteForm.role,
    }
    const validated = validatePayload(UsersPostUsersBody, payload)
    if (!validated) return

    setInviting(true)
    try {
      const response = (await usersPostUsers(validated)) as InviteResponse
      setLatestInvite(response)
      setInviteForm({ email: "", fullName: "", role: "crew_member" })
      setInviteDialogOpen(false)
      if (response.emailDelivery?.emailed) {
        toast.success(
          `Invite emailed to ${response.user.email}. The setup link is also shown below in case you need to copy it.`,
        )
      } else if (response.emailDelivery?.emailError) {
        toast.error(
          `Failed to send invite — copy this link and share it with ${response.user.fullName}.`,
        )
      } else {
        toast.success(
          `Invite created for ${response.user.fullName}. Copy the setup link to send to them.`,
        )
      }
      await refreshList()
    } catch (err: unknown) {
      toastApiError(err, "Failed to invite user")
    } finally {
      setInviting(false)
    }
  }

  const patchUser = async (
    user: AdminUser,
    changes: UsersUpdateUserSchema,
    actionLabel: string,
  ) => {
    const validated = validatePayload(UsersPatchUsersIdBody, changes)
    if (!validated) return

    setPendingPatchId(user.id)
    try {
      await usersPatchUsersId(user.id, validated)
      toast.success(`${user.fullName}: ${actionLabel}`)
      await refreshList()
    } catch (err: unknown) {
      toastApiError(err, `Failed to update ${user.fullName}`)
    } finally {
      setPendingPatchId(null)
    }
  }

  const handleRoleChange = (user: AdminUser, role: AdminUser["role"]) => {
    if (role === user.role) return
    void patchUser(user, { role }, `role updated to ${roleLabel(role)}`)
  }

  const handleToggleActive = (user: AdminUser) => {
    const nextActive = !(user.isActive ?? true)
    if (!nextActive && user.id === me?.id) {
      toast.error("You cannot deactivate your own account.")
      return
    }
    if (
      !nextActive &&
      !window.confirm(
        `Deactivate ${user.fullName}? They will be signed out and unable to log back in until you reactivate them.`,
      )
    ) {
      return
    }
    void patchUser(
      user,
      { isActive: nextActive },
      nextActive ? "reactivated" : "deactivated",
    )
  }

  const handleResend = async (user: AdminUser) => {
    setResendingId(user.id)
    try {
      const response = (await usersPostUsersIdInviteResend(
        user.id,
      )) as InviteResponse
      if (response.emailDelivery?.emailed) {
        toast.success(`Setup email re-sent to ${user.email}`)
      } else if (response.emailDelivery?.emailError) {
        toast.error(
          `Resend failed — copy the existing setup link and share it manually.`,
        )
        setLatestInvite(response)
      } else {
        toast.success(`Setup email re-sent to ${user.fullName}`)
      }
      await refreshList()
    } catch (err: unknown) {
      toastApiError(err, "Failed to resend invite email")
    } finally {
      setResendingId(null)
    }
  }

  const handleReissue = async (user: AdminUser) => {
    if (
      !window.confirm(
        `Issue a new setup link for ${user.fullName}? Any previous link will stop working.`,
      )
    ) {
      return
    }
    setReissuingId(user.id)
    try {
      const response = (await usersPostUsersIdInvite(user.id)) as InviteResponse
      setLatestInvite(response)
      if (response.emailDelivery?.emailed) {
        toast.success(`New setup link emailed to ${user.email}`)
      } else if (response.emailDelivery?.emailError) {
        toast.error(
          `New setup link generated, but the email failed to send — copy the link below.`,
        )
      } else {
        toast.success(`New setup link generated for ${user.fullName}`)
      }
      await refreshList()
    } catch (err: unknown) {
      toastApiError(err, "Failed to reissue invite")
    } finally {
      setReissuingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Team Members</h1>
          <p className="mt-1 text-sm text-slate-500">
            Invite workers, change their role, or deactivate accounts. Only
            admins see this page.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <Switch
              checked={includeInactive}
              onCheckedChange={setIncludeInactive}
              aria-label="Show deactivated accounts"
            />
            Show deactivated
          </label>
          <Button onClick={() => setInviteDialogOpen(true)}>
            <UserPlus className="mr-2 size-3.5" />
            Invite worker
          </Button>
        </div>
      </div>

      {latestInvite ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <Mail className="size-4" />
            Setup link for {latestInvite.user.fullName} — copy it now and share
            it with them. The link expires{" "}
            {new Date(latestInvite.inviteTokenExpiresAt).toLocaleString()}.
          </div>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={buildAbsoluteInviteLink(latestInvite.invitePath)}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                copyToClipboard(
                  buildAbsoluteInviteLink(latestInvite.invitePath),
                )
              }
            >
              <Copy className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLatestInvite(null)}
            >
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-amber-800">
            Once dismissed, this banner won't be shown again. If the invitee
            says they never received the email, click "Resend email" on their
            row to send the same link again. Use "Reissue link" only if you
            need to invalidate the existing link and start fresh.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        {usersQuery.isLoading ? (
          <div className="flex items-center justify-center gap-3 py-16">
            <Spinner className="size-5 text-orange-600" />
            <p className="text-sm text-slate-600">Loading team…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
            No users match the current filter.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Setup</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => {
                const isSelf = user.id === me?.id
                const active = user.isActive ?? true
                const passwordSet = Boolean(user.passwordSetAt)
                const inviteOutstanding =
                  !passwordSet && Boolean(user.inviteTokenExpiresAt)
                const inviteExpired =
                  inviteOutstanding &&
                  new Date(user.inviteTokenExpiresAt!).getTime() < Date.now()
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium text-slate-800">
                      {user.fullName}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-slate-400">
                          (you)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {user.email}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(value) =>
                          handleRoleChange(user, value as AdminUser["role"])
                        }
                        disabled={pendingPatchId === user.id}
                      >
                        <SelectTrigger className="h-8 w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {active ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                          Active
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-200 text-slate-700 hover:bg-slate-200">
                          Deactivated
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {passwordSet ? (
                        <span className="text-xs text-slate-500">
                          Password set
                        </span>
                      ) : inviteExpired ? (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                          Invite expired
                        </Badge>
                      ) : inviteOutstanding ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 w-fit">
                            Invite pending
                          </Badge>
                          {user.lastInviteEmailSentAt ? (
                            <span className="text-[11px] text-slate-500">
                              Last emailed{" "}
                              {new Date(
                                user.lastInviteEmailSentAt,
                              ).toLocaleString()}
                            </span>
                          ) : user.lastInviteEmailError ? (
                            <span
                              className="text-[11px] text-red-600"
                              title={user.lastInviteEmailError}
                            >
                              Email failed — share link manually
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              Not emailed yet
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {inviteOutstanding && !inviteExpired ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleResend(user)}
                            disabled={resendingId === user.id || !active}
                            title="Re-send the existing setup email without invalidating the current link"
                          >
                            {resendingId === user.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Send className="size-3.5" />
                            )}
                            <span className="ml-1.5 hidden sm:inline">
                              Resend email
                            </span>
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleReissue(user)}
                          disabled={reissuingId === user.id || !active}
                          title={
                            active
                              ? "Generate a new one-time setup link"
                              : "Reactivate the user before reissuing a link"
                          }
                        >
                          {reissuingId === user.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCw className="size-3.5" />
                          )}
                          <span className="ml-1.5 hidden sm:inline">
                            Reissue link
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant={active ? "ghost" : "default"}
                          size="sm"
                          onClick={() => handleToggleActive(user)}
                          disabled={
                            (isSelf && active) ||
                            pendingPatchId === user.id
                          }
                          title={
                            isSelf && active
                              ? "Another admin must deactivate your account"
                              : active
                                ? "Deactivate this account"
                                : "Reactivate this account"
                          }
                        >
                          {pendingPatchId === user.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : null}
                          {active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a new worker</DialogTitle>
            <DialogDescription>
              We'll create the account and generate a one-time setup link you
              can share with them. They'll set their own password the first
              time they sign in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full name</Label>
              <Input
                id="invite-name"
                value={inviteForm.fullName}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, fullName: e.target.value }))
                }
                required
                minLength={2}
                placeholder="Jane Doe"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, email: e.target.value }))
                }
                required
                placeholder="jane@example.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(value) =>
                  setInviteForm((f) => ({
                    ...f,
                    role: value as AdminUser["role"],
                  }))
                }
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setInviteDialogOpen(false)}
                disabled={inviting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-2 size-3.5" />
                )}
                Create invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
