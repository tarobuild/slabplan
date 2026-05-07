import { useEffect, useState } from "react"
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import {
  accountTokensCreate,
  accountTokensRevoke,
  getAccountTokensListQueryKey,
  useAccountTokensList,
  type PersonalAccessToken,
  type PersonalAccessTokenCreatePayload,
} from "@workspace/api-client-react"
import { AccountTokensCreateBody } from "@workspace/api-zod"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"
import { validatePayload } from "@/lib/validate-payload"

type ApiToken = PersonalAccessToken

function formatTokenDate(value: string | null | undefined): string {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export default function TokensSection() {
  useDocumentTitle("API Tokens · Settings")
  const queryClient = useQueryClient()

  const tokensQuery = useAccountTokensList()
  const tokens: ApiToken[] = tokensQuery.data?.tokens ?? []
  const loadingTokens = tokensQuery.isLoading
  const [tokenName, setTokenName] = useState("")
  const [tokenScope, setTokenScope] = useState<"read" | "read_write">("read_write")
  const [tokenExpiresInDays, setTokenExpiresInDays] = useState<"never" | "30" | "90" | "180" | "365">("never")
  const [creatingToken, setCreatingToken] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [tokenToRevoke, setTokenToRevoke] = useState<ApiToken | null>(null)

  useEffect(() => {
    if (tokensQuery.error) {
      toastApiError(tokensQuery.error, "Failed to load tokens")
    }
  }, [tokensQuery.error])

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

      const payload: PersonalAccessTokenCreatePayload = {
        name,
        scope: tokenScope,
        expiresAt,
      }
      const validated = validatePayload(AccountTokensCreateBody, payload)
      if (!validated) return
      const data = await accountTokensCreate(validated)
      setRevealedSecret(data.secret)
      setTokenName("")
      setTokenExpiresInDays("never")
      void queryClient.invalidateQueries({ queryKey: getAccountTokensListQueryKey() })
      toast.success("Token created — copy it now, it won't be shown again.")
    } catch (err: unknown) {
      toastApiError(err, "Failed to create token")
    } finally {
      setCreatingToken(false)
    }
  }

  const requestRevoke = (token: ApiToken) => {
    if (token.revokedAt) return
    setTokenToRevoke(token)
  }

  const confirmRevoke = async () => {
    const token = tokenToRevoke
    if (!token) return
    setRevokingId(token.id)
    try {
      await accountTokensRevoke(token.id)
      toast.success("Token revoked")
      await queryClient.invalidateQueries({ queryKey: getAccountTokensListQueryKey() })
      setTokenToRevoke(null)
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

  return (
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
                onChange={(e) => setTokenExpiresInDays(e.target.value as typeof tokenExpiresInDays)}
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
                    const now = Date.now()
                    const expiresAtMs = t.expiresAt ? new Date(t.expiresAt).getTime() : null
                    const msPerDay = 24 * 60 * 60 * 1000
                    const daysUntilExpiry =
                      expiresAtMs !== null ? Math.ceil((expiresAtMs - now) / msPerDay) : null
                    const isExpired = expiresAtMs !== null && expiresAtMs <= now
                    const isExpiringSoon =
                      !t.revokedAt &&
                      !isExpired &&
                      daysUntilExpiry !== null &&
                      daysUntilExpiry <= 14
                    const status = t.revokedAt
                      ? "Revoked"
                      : isExpired
                        ? "Expired"
                        : isExpiringSoon
                          ? daysUntilExpiry === 0
                            ? "Expires today"
                            : daysUntilExpiry === 1
                              ? "Expires in 1 day"
                              : `Expires in ${daysUntilExpiry} days`
                          : "Active"
                    const isActive = !t.revokedAt && !isExpired
                    const badgeClass = t.revokedAt
                      ? "bg-slate-100 text-slate-600"
                      : isExpired
                        ? "bg-red-100 text-red-800"
                        : isExpiringSoon
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
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
                              badgeClass
                            }
                            title={t.expiresAt ? `Expires ${formatTokenDate(t.expiresAt)}` : undefined}
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
                              onClick={() => requestRevoke(t)}
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
      <AlertDialog
        open={tokenToRevoke !== null}
        onOpenChange={(next) => {
          if (!next && revokingId === null) setTokenToRevoke(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API token</AlertDialogTitle>
            <AlertDialogDescription>
              {tokenToRevoke
                ? `Revoke "${tokenToRevoke.name}"? Apps using this token will stop working.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokingId !== null}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmRevoke()
              }}
            >
              {revokingId !== null ? <Loader2 className="size-4 animate-spin" /> : null}
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
