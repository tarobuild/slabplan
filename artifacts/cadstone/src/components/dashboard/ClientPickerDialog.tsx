import { useEffect, useMemo, useState } from "react"
import { Building2, Loader2, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"

type PickableClient = {
  id: string
  companyName: string
  city?: string | null
  state?: string | null
  archived?: boolean
}

type ClientPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  onSelect: (clientId: string) => void
}

export function ClientPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  onSelect,
}: ClientPickerDialogProps) {
  const [clients, setClients] = useState<PickableClient[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    // Use status=all (not the default "active") so brand-new clients
    // show up immediately. The default "active" filter requires at least
    // one open job or an outstanding balance — which means a freshly
    // created client would be invisible in this assign-a-job picker.
    // Archived clients are filtered out below so they aren't selectable.
    api
      .get("/clients?pageSize=100&status=all")
      .then((response) => {
        if (cancelled) return
        const raw: PickableClient[] = response.data?.clients ?? []
        setClients(raw.filter((c) => !c.archived))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        toastApiError(err, "Failed to load clients")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((client) =>
      [client.companyName, client.city ?? "", client.state ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [clients, search])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search clients…"
              className="pl-8 h-9"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-[#E5E7EB] bg-white">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading clients…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                {search.trim()
                  ? "No matching clients."
                  : "No clients yet — create one from the Clients page."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((client) => (
                  <li key={client.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(client.id)
                        onOpenChange(false)
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-orange-50 text-orange-500">
                        <Building2 className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {client.companyName}
                        </span>
                        {(client.city || client.state) && (
                          <span className="block truncate text-xs text-slate-500">
                            {[client.city, client.state].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

