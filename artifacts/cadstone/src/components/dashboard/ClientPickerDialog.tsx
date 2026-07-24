import { useCallback, useEffect, useRef, useState } from "react"
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

const CLIENT_PAGE_SIZE = 100

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
  onSelect: (clientId: string, clientName: string) => void
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const requestIdRef = useRef(0)

  const loadClients = useCallback(
    async (nextPage: number, mode: "replace" | "append") => {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      if (mode === "replace") {
        setClients([])
        setLoading(true)
      } else {
        setLoadingMore(true)
      }
      setLoadError(null)

      const query = search.trim()

      try {
        const response = await api.get("/clients", {
          params: {
            page: nextPage,
            pageSize: CLIENT_PAGE_SIZE,
            status: "all",
            search: query || undefined,
          },
        })
        if (requestIdRef.current !== requestId) return
        const raw: PickableClient[] = response.data?.clients ?? []
        const selectable = raw.filter((c) => !c.archived)
        setClients((current) =>
          mode === "append" ? [...current, ...selectable] : selectable,
        )
        setPage(nextPage)
        setHasMore(Boolean(response.data?.pagination?.hasMore))
      } catch (err: unknown) {
        if (requestIdRef.current !== requestId) return
        if (mode === "replace") setClients([])
        setHasMore(false)
        setLoadError("Clients could not be loaded. Try again in a moment.")
        toastApiError(err, "Failed to load clients")
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [search],
  )

  useEffect(() => {
    if (!open) return
    // Use status=all (not the default "active") so brand-new clients
    // show up immediately. The default "active" filter requires at least
    // one open job or an outstanding balance — which means a freshly
    // created client would be invisible in this assign-a-job picker.
    // Archived clients are filtered out client-side so they aren't selectable,
    // while search itself is sent to the server so matches beyond page 1 are
    // reachable.
    void loadClients(1, "replace")
  }, [loadClients, open])

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1
      setSearch("")
      setClients([])
      setHasMore(false)
      setPage(1)
      setLoading(false)
      setLoadingMore(false)
    }
  }, [open])

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
            ) : loadError ? (
              <div className="px-4 py-6 text-center text-sm text-red-600">
                {loadError}
              </div>
            ) : clients.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                {search.trim()
                  ? "No matching clients."
                  : "No clients yet — create one from the Clients page."}
              </div>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {clients.map((client) => (
                    <li key={client.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(client.id, client.companyName)
                          onOpenChange(false)
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                      >
                        <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
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
                {hasMore ? (
                  <div className="border-t border-slate-100 p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      disabled={loadingMore}
                      onClick={() => loadClients(page + 1, "append")}
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Loading more…
                        </>
                      ) : (
                        "Load more clients"
                      )}
                    </Button>
                  </div>
                ) : null}
              </>
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
