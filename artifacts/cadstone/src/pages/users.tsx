import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Copy, Loader2, Mail, Plus, RotateCw, UserPlus } from "lucide-react"
import { toast } from "sonner"
import {
  getUsersGetUsersQueryKey,
  useUsersGetUsers,
  usersPatchUsersId,
  usersPostUsers,
  usersPostUsersIdInvite,
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
  role: "admin" | "project_manager" | "crew_member" | "drafter"
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
  { value: "drafter", label: "Drafter" },
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

function resolveInviteLink(invite: Pick<InviteResponse, "invitePath" | "inviteUrl">): string {
  return invite.inviteUrl?.trim() || buildAbsoluteInviteLink(invite.invitePath)
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
  const latestInviteLink = latestInvite ? resolveInviteLink(latestInvite) : ""

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
        toast.info(
          `Invite created for ${response.user.fullName}. Email was not sent, so copy the setup link below.`,
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
        toast.info(
          `New setup link generated. Email was not sent, so copy the link below.`,
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

  // One set of per-member controls, laid out as a table on wider screens and
  // as stacked rows on phones, so handlers and disabled rules live in one place.
  const renderMemberParts = (user: AdminUser) => {
    const isSelf = user.id === me?.id
    const active = user.isActive ?? true
    const passwordSet = Boolean(user.passwordSetAt)
    const inviteOutstanding =
      !passwordSet && Boolean(user.inviteTokenExpiresAt)
    const inviteExpired =
      inviteOutstanding &&
      new Date(user.inviteTokenExpiresAt!).getTime() < Date.now()

    const selfTag = isSelf ? (
      <span className="ml-2 text-xs font-normal text-muted-foreground">
        (you)
      </span>
    ) : null

    const role = (
      <Select
        value={user.role}
        onValueChange={(value) =>
          handleRoleChange(user, value as AdminUser["role"])
        }
        disabled={pendingPatchId === user.id}
      >
        <SelectTrigger
          className="h-9 w-[160px]"
          aria-label={`Role for ${user.fullName}`}
        >
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
    )

    const status = active ? (
      <Badge variant="success">Active</Badge>
    ) : (
      <Badge variant="secondary">Deactivated</Badge>
    )

    const setup = passwordSet ? (
      <span className="text-xs text-muted-foreground">Password set</span>
    ) : inviteExpired ? (
      <Badge className="w-fit border-transparent bg-red-50 text-red-700">
        Invite expired
      </Badge>
    ) : inviteOutstanding ? (
      <div className="flex flex-col gap-0.5">
        <Badge variant="warning" className="w-fit">
          Invite pending
        </Badge>
        {user.lastInviteEmailSentAt ? (
          <span className="text-[11px] text-muted-foreground">
            Last emailed{" "}
            {new Date(user.lastInviteEmailSentAt).toLocaleString()}
          </span>
        ) : user.lastInviteEmailError ? (
          <span
            className="text-[11px] text-red-600"
            title={user.lastInviteEmailError}
          >
            Email failed — share link manually
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Not emailed yet
          </span>
        )}
      </div>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    )

    const actions = (
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
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
          Reissue link
        </Button>
        <Button
          type="button"
          variant={active ? "ghost" : "default"}
          size="sm"
          onClick={() => handleToggleActive(user)}
          disabled={(isSelf && active) || pendingPatchId === user.id}
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
    )

    return { selfTag, role, status, setup, actions }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold text-foreground">Team</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
            Setup link for {latestInvite.user.fullName}
            {latestInvite.emailDelivery?.emailed
              ? " was emailed and is ready to copy if needed."
              : " is ready to copy and share."}{" "}
            The link expires{" "}
            {new Date(latestInvite.inviteTokenExpiresAt).toLocaleString()}.
          </div>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={latestInviteLink}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(latestInviteLink)}
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
            The invitee will confirm their work email and create their password
            when they open this one-time setup link. Once dismissed, this banner
            won't be shown again.
          </p>
        </div>
      ) : null}

      {usersQuery.isLoading ? (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-card-border bg-card py-16 shadow-sm">
          <Spinner className="size-5 text-primary" />
          <p className="text-sm text-muted-foreground">Loading team…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card py-16 text-center text-sm text-muted-foreground shadow-sm">
          No users match the current filter.
        </div>
      ) : (
        <>
          {/* Phones: one stacked row per member so role, status, setup and
              actions are all visible without sideways scrolling. */}
          <ul
            aria-label="Team members"
            className="divide-y divide-border rounded-lg border border-card-border bg-card shadow-sm md:hidden"
          >
            {rows.map((user) => {
              const member = renderMemberParts(user)
              return (
                <li key={user.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground [overflow-wrap:anywhere]">
                        {user.fullName}
                        {member.selfTag}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {user.email}
                      </p>
                    </div>
                    <div className="shrink-0">{member.status}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {member.role}
                    {member.setup}
                  </div>
                  {member.actions}
                </li>
              )
            })}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border border-card-border bg-card shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
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
                  const member = renderMemberParts(user)
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium text-foreground">
                        {user.fullName}
                        {member.selfTag}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>{member.role}</TableCell>
                      <TableCell>{member.status}</TableCell>
                      <TableCell>{member.setup}</TableCell>
                      <TableCell className="text-right">{member.actions}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

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
