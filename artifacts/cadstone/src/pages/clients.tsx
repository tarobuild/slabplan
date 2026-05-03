import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  Building2,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react"
import {
  getClientsGetClientsQueryKey,
  getClientsGetClientsIdQueryKey,
  useClientsGetClients,
  useClientsPostClients,
  useClientsPutClientsId,
  useClientsDeleteClientsId,
  useClientsPostClientsIdContacts,
  useClientsPutClientsIdContactsContactId,
  useClientsDeleteClientsIdContactsContactId,
  type ClientListItem as ClientListItemDto,
  type ClientsGetClientsQueryResult,
} from "@workspace/api-client-react"
import {
  ClientsPostClientsBody,
  ClientsPutClientsIdBody,
  ClientsPostClientsIdContactsBody,
  ClientsPutClientsIdContactsContactIdBody,
} from "@workspace/api-zod"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { validatePayload } from "@/lib/validate-payload"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { invalidateAppData } from "@/lib/data-refresh"
import { toast } from "sonner"
import { toastApiError } from "@/lib/api-errors"
import { cn } from "@/lib/utils"

type Contact = {
  id: string
  clientId: string | null
  firstName: string | null
  lastName: string | null
  title: string | null
  email: string | null
  phone: string | null
  cellPhone: string | null
  isPrimary: boolean | null
}

type ClientDetail = {
  id: string
  companyName: string
  phone: string | null
  email: string | null
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  notes: string | null
  contacts: Contact[]
  jobs: JobRow[]
}

type JobRow = {
  id: string
  title: string
  status: string
  city: string | null
  state: string | null
  jobType: string | null
  contractPrice: string | null
  projectedStart: string | null
  projectedCompletion: string | null
  createdAt: string
}

type ClientForm = {
  companyName: string
  phone: string
  email: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  notes: string
}

type ContactForm = {
  firstName: string
  lastName: string
  title: string
  email: string
  phone: string
  cellPhone: string
  isPrimary: boolean
}

const emptyClientForm: ClientForm = {
  companyName: "",
  phone: "",
  email: "",
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
  notes: "",
}

const emptyContactForm: ContactForm = {
  firstName: "",
  lastName: "",
  title: "",
  email: "",
  phone: "",
  cellPhone: "",
  isPrimary: false,
}

const JOB_STATUS_COLORS: Record<string, string> = {
  open: "bg-green-50 text-green-700 border-green-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
  archived: "bg-slate-50 text-slate-400 border-slate-200",
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
function fmtCurrency(v: string | null) {
  if (!v) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v))
}
function fmtMoneyCents(v: number | null | undefined) {
  if (v == null) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v / 100)
}

type ClientStatus = "active" | "archived" | "all"
const STATUS_TABS: { value: ClientStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
]

export default function ClientsPage() {
  useDocumentTitle("Clients")
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [statusFilter, setStatusFilter] = useState<ClientStatus>("active")
  const [search, setSearch] = useState("")
  // `debouncedSearch` is what actually drives the typed list query — the
  // input updates `search` immediately for snappy UI, but we wait until the
  // user pauses before refetching so we don't hammer the API.
  const [debouncedSearch, setDebouncedSearch] = useState("")

  const [createOpen, setCreateOpen] = useState(false)
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm)
  const [saving, setSaving] = useState(false)

  const [selected, setSelected] = useState<ClientDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [sheetTab, setSheetTab] = useState<"info" | "contacts" | "jobs">("info")

  const [editingClient, setEditingClient] = useState(false)
  const [clientPatch, setClientPatch] = useState<ClientForm>(emptyClientForm)
  const [patchSaving, setPatchSaving] = useState(false)

  const [contactDialogOpen, setContactDialogOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContactForm)
  const [contactSaving, setContactSaving] = useState(false)

  const [deleteClientId, setDeleteClientId] = useState<string | null>(null)
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkClientId = searchParams.get("client")
  const lastDeepLinkRef = useRef<string | null>(null)

  const listParams = useMemo(
    () => ({
      page,
      pageSize,
      status: statusFilter,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [page, pageSize, statusFilter, debouncedSearch],
  )

  // `placeholderData: previous` keeps the prior page visible while refetching
  // so pagination/search feel snappy instead of flashing a spinner.
  // tanstack-query's typed options require an explicit queryKey when the
  // `query` block is overridden, so we pass the generated helper.
  const clientsQuery = useClientsGetClients(listParams, {
    query: {
      queryKey: getClientsGetClientsQueryKey(listParams),
      placeholderData: (previous: ClientsGetClientsQueryResult | undefined) => previous,
    },
  })

  // Surface load errors via the existing toast helper so behavior matches
  // the previous hand-rolled fetch path. Effect tracks the query's error
  // identity so we don't spam duplicate toasts on retries.
  useEffect(() => {
    if (clientsQuery.error) {
      toastApiError(clientsQuery.error, "Failed to load clients")
    }
  }, [clientsQuery.error])

  const clients: ClientListItemDto[] = clientsQuery.data?.clients ?? []
  const total = clientsQuery.data?.pagination?.totalItems ?? 0
  const loading = clientsQuery.isPending

  const invalidateClientsList = () => {
    // Calling the query-key helper without params yields the resource prefix
    // (`["/api/clients"]`), which acts as a partial match for every paginated
    // variant we have cached.
    void queryClient.invalidateQueries({ queryKey: getClientsGetClientsQueryKey() })
  }
  const invalidateClientDetail = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: getClientsGetClientsIdQueryKey(id) })
  }

  // All writes go through generated mutation hooks (see replit.md).
  const createClientMutation = useClientsPostClients()
  const updateClientMutation = useClientsPutClientsId()
  const deleteClientMutation = useClientsDeleteClientsId()
  const createContactMutation = useClientsPostClientsIdContacts()
  const updateContactMutation = useClientsPutClientsIdContactsContactId()
  const deleteContactMutation = useClientsDeleteClientsIdContactsContactId()

  // Open the matching client automatically when the URL carries
  // ?client=<id> (e.g. from a global search result). Track the last id
  // we opened so navigating with a different param re-opens the sheet,
  // but a manual close does not immediately re-trigger.
  useEffect(() => {
    if (!deepLinkClientId) {
      lastDeepLinkRef.current = null
      return
    }
    if (lastDeepLinkRef.current === deepLinkClientId) return
    lastDeepLinkRef.current = deepLinkClientId
    void openDetail(deepLinkClientId)
  }, [deepLinkClientId])

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 300)
  }

  const handlePage = (p: number) => { setPage(p) }

  const openDetail = async (id: string) => {
    setLoadingDetail(true)
    setSelected(null)
    setSheetTab("info")
    try {
      const r = await api.get(`/clients/${id}`)
      setSelected(r.data.client)
    } catch (err: unknown) {
      toastApiError(err, "Failed to load client")
      if (searchParams.get("client")) {
        const next = new URLSearchParams(searchParams)
        next.delete("client")
        setSearchParams(next, { replace: true })
      }
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    // Validate the payload against the generated Zod schema before issuing
    // the request so we surface a friendly toast instead of round-tripping
    // to the server for shape errors. Returns `null` (after toasting) when
    // invalid.
    const payload = validatePayload(ClientsPostClientsBody, {
      companyName: clientForm.companyName,
      phone: clientForm.phone || null,
      email: clientForm.email || null,
      streetAddress: clientForm.streetAddress || null,
      city: clientForm.city || null,
      state: clientForm.state || null,
      zipCode: clientForm.zipCode || null,
      notes: clientForm.notes || null,
    })
    if (!payload) return
    setSaving(true)
    try {
      const r = await createClientMutation.mutateAsync({ data: payload })
      toast.success("Client created")
      setCreateOpen(false)
      setClientForm(emptyClientForm)
      setPage(1)
      invalidateClientsList()
      invalidateAppData(["clients", "navigation"])
      await openDetail(r.client.id)
    } catch (err: unknown) {
      toastApiError(err, "Failed to create client")
    } finally {
      setSaving(false)
    }
  }

  const startEditClient = () => {
    if (!selected) return
    setClientPatch({
      companyName: selected.companyName,
      phone: selected.phone ?? "",
      email: selected.email ?? "",
      streetAddress: selected.streetAddress ?? "",
      city: selected.city ?? "",
      state: selected.state ?? "",
      zipCode: selected.zipCode ?? "",
      notes: selected.notes ?? "",
    })
    setEditingClient(true)
  }

  const handlePatchClient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    const payload = validatePayload(ClientsPutClientsIdBody, {
      companyName: clientPatch.companyName,
      phone: clientPatch.phone || null,
      email: clientPatch.email || null,
      streetAddress: clientPatch.streetAddress || null,
      city: clientPatch.city || null,
      state: clientPatch.state || null,
      zipCode: clientPatch.zipCode || null,
      notes: clientPatch.notes || null,
    })
    if (!payload) return
    setPatchSaving(true)
    try {
      const r = await updateClientMutation.mutateAsync({
        id: selected.id,
        data: payload,
      })
      toast.success("Client updated")
      setEditingClient(false)
      setSelected(prev => prev ? { ...prev, ...(r.client as ClientDetail) } : prev)
      invalidateClientsList()
      invalidateClientDetail(selected.id)
      invalidateAppData(["clients", "navigation"])
    } catch (err: unknown) {
      toastApiError(err, "Failed to update client")
    } finally {
      setPatchSaving(false)
    }
  }

  const handleDeleteClient = async () => {
    if (!deleteClientId) return
    setDeleting(true)
    try {
      await deleteClientMutation.mutateAsync({ id: deleteClientId })
      toast.success("Client deleted")
      const deletedId = deleteClientId
      setDeleteClientId(null)
      if (selected?.id === deletedId) setSelected(null)
      invalidateClientsList()
      invalidateClientDetail(deletedId)
      invalidateAppData(["clients", "navigation"])
    } catch (err: unknown) {
      toastApiError(err, "Failed to delete client")
    } finally {
      setDeleting(false)
    }
  }

  const openContactDialog = (contact?: Contact) => {
    if (contact) {
      setEditingContact(contact)
      setContactForm({
        firstName: contact.firstName ?? "",
        lastName: contact.lastName ?? "",
        title: contact.title ?? "",
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        cellPhone: contact.cellPhone ?? "",
        isPrimary: contact.isPrimary ?? false,
      })
    } else {
      setEditingContact(null)
      setContactForm(emptyContactForm)
    }
    setContactDialogOpen(true)
  }

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setContactSaving(true)
    try {
      const rawPayload = {
        firstName: contactForm.firstName || null,
        lastName: contactForm.lastName || null,
        title: contactForm.title || null,
        email: contactForm.email || null,
        phone: contactForm.phone || null,
        cellPhone: contactForm.cellPhone || null,
        isPrimary: contactForm.isPrimary,
      }
      if (editingContact) {
        const payload = validatePayload(
          ClientsPutClientsIdContactsContactIdBody,
          rawPayload,
        )
        if (!payload) return
        await updateContactMutation.mutateAsync({
          id: selected.id,
          contactId: editingContact.id,
          data: payload,
        })
        toast.success("Contact updated")
      } else {
        const payload = validatePayload(
          ClientsPostClientsIdContactsBody,
          rawPayload,
        )
        if (!payload) return
        await createContactMutation.mutateAsync({
          id: selected.id,
          data: payload,
        })
        toast.success("Contact added")
      }
      setContactDialogOpen(false)
      invalidateClientDetail(selected.id)
      const r = await api.get(`/clients/${selected.id}`)
      setSelected(r.data.client)
    } catch (err: unknown) {
      toastApiError(err, "Failed to save contact")
    } finally {
      setContactSaving(false)
    }
  }

  const handleDeleteContact = async () => {
    if (!deleteContactId || !selected) return
    setDeleting(true)
    try {
      await deleteContactMutation.mutateAsync({
        id: selected.id,
        contactId: deleteContactId,
      })
      toast.success("Contact removed")
      setDeleteContactId(null)
      invalidateClientDetail(selected.id)
      const r = await api.get(`/clients/${selected.id}`)
      setSelected(r.data.client)
    } catch (err: unknown) {
      toastApiError(err, "Failed to delete contact")
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Clients</h1>
        <Button size="sm" onClick={() => { setClientForm(emptyClientForm); setCreateOpen(true) }}>
          <Plus className="mr-1.5 size-3.5" />
          New Client
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search clients…"
            className="pl-8 h-9"
          />
        </div>
        <div className="inline-flex rounded-md border border-[#E5E7EB] bg-white p-0.5">
          {STATUS_TABS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => { setStatusFilter(t.value); setPage(1) }}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded transition-colors",
                statusFilter === t.value
                  ? "bg-orange-600 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold text-slate-600">Company</TableHead>
              <TableHead className="font-semibold text-slate-600">Primary Contact</TableHead>
              <TableHead className="font-semibold text-slate-600">Phone</TableHead>
              <TableHead className="font-semibold text-slate-600">Email</TableHead>
              <TableHead className="font-semibold text-slate-600 text-center">Active Jobs</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Contract</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Outstanding</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                  No clients found.{" "}
                  <button
                    onClick={() => { setClientForm(emptyClientForm); setCreateOpen(true) }}
                    className="text-orange-600 hover:underline"
                  >
                    Add your first client
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              clients.map(client => {
                const contract = client.contractValueCents
                const outstanding = client.outstandingCents
                const archived = client.archived
                return (
                <TableRow
                  key={client.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/clients/${client.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                        <Building2 className="size-3.5" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-sm">
                          {client.companyName}
                          {archived && (
                            <Badge variant="outline" className="ml-1.5 bg-slate-50 text-slate-500 border-slate-200 text-[10px]">
                              Archived
                            </Badge>
                          )}
                        </p>
                        {(client.city || client.state) && (
                          <p className="text-xs text-slate-400">{[client.city, client.state].filter(Boolean).join(", ")}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {client.primaryContact
                      ? [client.primaryContact.firstName, client.primaryContact.lastName].filter(Boolean).join(" ") || "—"
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {client.phone || (client.primaryContact?.phone) || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {client.email || (client.primaryContact?.email) || "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {client.openJobCount > 0 ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                        {client.openJobCount}
                      </Badge>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-slate-700">
                    {fmtMoneyCents(contract)}
                  </TableCell>
                  <TableCell className={cn("text-right text-sm font-medium", outstanding && outstanding > 0 ? "text-orange-700" : "text-slate-400")}>
                    {fmtMoneyCents(outstanding)}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setDeleteClientId(client.id)}
                      className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))
        ) : clients.length === 0 ? (
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-8 text-center text-sm text-slate-400">
            No clients found.{" "}
            <button
              onClick={() => { setClientForm(emptyClientForm); setCreateOpen(true) }}
              className="text-orange-600 hover:underline"
            >
              Add your first client
            </button>
          </div>
        ) : (
          clients.map(client => (
            <div
              key={client.id}
              className="rounded-lg border border-[#E5E7EB] bg-white p-4 cursor-pointer active:bg-slate-50"
              onClick={() => navigate(`/clients/${client.id}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                    <Building2 className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{client.companyName}</p>
                    {(client.city || client.state) && (
                      <p className="text-xs text-slate-400">{[client.city, client.state].filter(Boolean).join(", ")}</p>
                    )}
                    <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                      {(client.phone || client.primaryContact?.phone) && (
                        <p className="flex items-center gap-1.5">
                          <Phone className="size-3 shrink-0 text-slate-400" />
                          {client.phone || client.primaryContact?.phone}
                        </p>
                      )}
                      {(client.email || client.primaryContact?.email) && (
                        <p className="flex items-center gap-1.5 truncate">
                          <Mail className="size-3 shrink-0 text-slate-400" />
                          <span className="truncate">{client.email || client.primaryContact?.email}</span>
                        </p>
                      )}
                      {client.openJobCount > 0 && (
                        <p>
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                            {client.openJobCount} open {client.openJobCount === 1 ? "job" : "jobs"}
                          </Badge>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteClientId(client.id) }}
                  className="shrink-0 p-1 text-slate-400 transition-colors hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {!loading && total > pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => handlePage(page - 1)} disabled={page <= 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => handlePage(page + 1)} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      )}

      {/* Client Detail Sheet */}
      <Sheet open={!!selected || loadingDetail} onOpenChange={open => { if (!open) { setSelected(null); setEditingClient(false); if (deepLinkClientId) { const next = new URLSearchParams(searchParams); next.delete("client"); setSearchParams(next, { replace: true }) } } }}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 gap-0">
          {loadingDetail ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : selected ? (
            <>
              <SheetHeader className="px-6 pt-6 pb-4 border-b border-[#E5E7EB]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                      <Building2 className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <SheetTitle className="text-base font-semibold text-slate-900 truncate">
                        {selected.companyName}
                      </SheetTitle>
                      {(selected.city || selected.state) && (
                        <p className="text-xs text-slate-400">{[selected.city, selected.state].filter(Boolean).join(", ")}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="size-8" onClick={startEditClient} title="Edit client">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => setDeleteClientId(selected.id)} title="Delete client">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex gap-1 mt-3">
                  {(["info", "contacts", "jobs"] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setSheetTab(tab)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded transition-colors capitalize",
                        sheetTab === tab
                          ? "bg-orange-600 text-white"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                      )}
                    >
                      {tab === "contacts" ? `Contacts (${selected.contacts.length})` : tab === "jobs" ? `Jobs (${selected.jobs.length})` : "Company Info"}
                    </button>
                  ))}
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {sheetTab === "info" && (
                  editingClient ? (
                    <form onSubmit={handlePatchClient} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label>Company Name *</Label>
                        <Input value={clientPatch.companyName} onChange={e => setClientPatch(p => ({ ...p, companyName: e.target.value }))} required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>Phone</Label>
                          <Input value={clientPatch.phone} onChange={e => setClientPatch(p => ({ ...p, phone: e.target.value }))} placeholder="(555) 000-0000" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Email</Label>
                          <Input type="email" value={clientPatch.email} onChange={e => setClientPatch(p => ({ ...p, email: e.target.value }))} placeholder="info@company.com" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Street Address</Label>
                        <Input value={clientPatch.streetAddress} onChange={e => setClientPatch(p => ({ ...p, streetAddress: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-1 space-y-1.5">
                          <Label>City</Label>
                          <Input value={clientPatch.city} onChange={e => setClientPatch(p => ({ ...p, city: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>State</Label>
                          <Input value={clientPatch.state} onChange={e => setClientPatch(p => ({ ...p, state: e.target.value }))} maxLength={2} className="uppercase" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Zip</Label>
                          <Input value={clientPatch.zipCode} onChange={e => setClientPatch(p => ({ ...p, zipCode: e.target.value }))} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Notes</Label>
                        <Textarea value={clientPatch.notes} onChange={e => setClientPatch(p => ({ ...p, notes: e.target.value }))} rows={4} maxLength={2500} />
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={patchSaving}>
                          {patchSaving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}Save
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingClient(false)}>Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-5">
                      <div className="space-y-3">
                        {selected.phone && (
                          <div className="flex items-center gap-2.5 text-sm text-slate-700">
                            <Phone className="size-4 shrink-0 text-slate-400" />
                            <span>{selected.phone}</span>
                          </div>
                        )}
                        {selected.email && (
                          <div className="flex items-center gap-2.5 text-sm text-slate-700">
                            <Mail className="size-4 shrink-0 text-slate-400" />
                            <a href={`mailto:${selected.email}`} className="text-orange-600 hover:underline">{selected.email}</a>
                          </div>
                        )}
                        {(selected.streetAddress || selected.city) && (
                          <div className="flex items-start gap-2.5 text-sm text-slate-700">
                            <Building2 className="size-4 shrink-0 text-slate-400 mt-0.5" />
                            <div>
                              {selected.streetAddress && <p>{selected.streetAddress}</p>}
                              {(selected.city || selected.state || selected.zipCode) && (
                                <p>{[selected.city, selected.state, selected.zipCode].filter(Boolean).join(", ")}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {selected.notes && (
                        <>
                          <Separator />
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Notes</p>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{selected.notes}</p>
                          </div>
                        </>
                      )}
                      {!selected.phone && !selected.email && !selected.streetAddress && !selected.notes && (
                        <p className="text-sm text-slate-400 italic">No additional info. Click the edit icon to add details.</p>
                      )}
                    </div>
                  )
                )}

                {sheetTab === "contacts" && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => openContactDialog()}>
                        <Plus className="mr-1.5 size-3.5" />Add Contact
                      </Button>
                    </div>
                    {selected.contacts.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[#E5E7EB] py-10 text-center">
                        <User className="mx-auto size-8 text-slate-300 mb-2" />
                        <p className="text-sm text-slate-400">No contacts yet.</p>
                        <button onClick={() => openContactDialog()} className="mt-1 text-xs text-orange-600 hover:underline">Add the first contact</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selected.contacts.map(c => (
                          <div key={c.id} className="rounded-lg border border-[#E5E7EB] bg-white p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-sm font-medium text-slate-900">
                                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed"}
                                  </p>
                                  {c.isPrimary && (
                                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-600">
                                      <Star className="size-2.5 fill-amber-400 text-amber-400" /> Primary
                                    </span>
                                  )}
                                </div>
                                {c.title && <p className="text-xs text-slate-400">{c.title}</p>}
                                <div className="mt-1.5 space-y-0.5">
                                  {c.email && (
                                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                                      <Mail className="size-3 text-slate-400" />
                                      <a href={`mailto:${c.email}`} className="hover:text-orange-600 hover:underline">{c.email}</a>
                                    </p>
                                  )}
                                  {c.phone && (
                                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                                      <Phone className="size-3 text-slate-400" />
                                      {c.phone}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={() => openContactDialog(c)} className="text-slate-400 hover:text-slate-700 p-1 rounded">
                                  <Pencil className="size-3.5" />
                                </button>
                                <button onClick={() => setDeleteContactId(c.id)} className="text-slate-400 hover:text-red-500 p-1 rounded">
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {sheetTab === "jobs" && (
                  <div className="space-y-3">
                    {selected.jobs.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[#E5E7EB] py-10 text-center">
                        <p className="text-sm text-slate-400">No jobs linked to this client yet.</p>
                        <p className="text-xs text-slate-400 mt-1">Link jobs from the Job Summary page.</p>
                      </div>
                    ) : (
                      selected.jobs.map(job => (
                        <Link
                          key={job.id}
                          to={`/jobs/${job.id}`}
                          className="block rounded-lg border border-[#E5E7EB] bg-white p-3.5 hover:border-orange-300 hover:bg-orange-50/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">{job.title}</p>
                              {(job.city || job.state) && (
                                <p className="text-xs text-slate-400">{[job.city, job.state].filter(Boolean).join(", ")}</p>
                              )}
                              {job.projectedStart && (
                                <p className="text-xs text-slate-400 mt-0.5">Start: {fmtDate(job.projectedStart)}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {job.contractPrice && (
                                <span className="text-xs text-slate-500">{fmtCurrency(job.contractPrice)}</span>
                              )}
                              <Badge variant="outline" className={`text-xs capitalize ${JOB_STATUS_COLORS[job.status] ?? ""}`}>
                                {job.status}
                              </Badge>
                            </div>
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* New Client Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Client</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  value={clientForm.companyName}
                  onChange={e => setClientForm(f => ({ ...f, companyName: e.target.value }))}
                  required
                  placeholder="Acme Construction"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={clientForm.phone} onChange={e => setClientForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={clientForm.email} onChange={e => setClientForm(f => ({ ...f, email: e.target.value }))} placeholder="info@acme.com" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={clientForm.city} onChange={e => setClientForm(f => ({ ...f, city: e.target.value }))} placeholder="Austin" />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Create Client
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Contact Dialog */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveContact}>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First Name</Label>
                  <Input value={contactForm.firstName} onChange={e => setContactForm(f => ({ ...f, firstName: e.target.value }))} placeholder="John" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name</Label>
                  <Input value={contactForm.lastName} onChange={e => setContactForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Smith" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Title / Role</Label>
                <Input value={contactForm.title} onChange={e => setContactForm(f => ({ ...f, title: e.target.value }))} placeholder="Project Owner" />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} placeholder="john@company.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Cell Phone</Label>
                  <Input value={contactForm.cellPhone} onChange={e => setContactForm(f => ({ ...f, cellPhone: e.target.value }))} placeholder="(555) 000-0001" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={contactForm.isPrimary}
                  onChange={e => setContactForm(f => ({ ...f, isPrimary: e.target.checked }))}
                  className="rounded accent-orange-600"
                />
                <span className="text-sm text-slate-700">Primary contact</span>
              </label>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setContactDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={contactSaving}>
                {contactSaving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                {editingContact ? "Save" : "Add Contact"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Client Confirm */}
      <AlertDialog open={!!deleteClientId} onOpenChange={open => !open && setDeleteClientId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the client and all their contacts. Any linked jobs will be unlinked and the client association removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClient} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Contact Confirm */}
      <AlertDialog open={!!deleteContactId} onOpenChange={open => !open && setDeleteContactId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Contact?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this contact from the client.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContact} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
