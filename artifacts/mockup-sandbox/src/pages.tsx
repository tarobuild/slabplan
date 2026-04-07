import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { formatDistanceToNow } from "date-fns"
import { useForm } from "react-hook-form"
import { io } from "socket.io-client"
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  Logs,
  Plus,
  Search,
  Settings,
  UserCircle2,
  Users,
} from "lucide-react"
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom"
import { toast } from "sonner"
import { api } from "@/lib/api"
import {
  bootstrapAuth,
  login,
  logout,
  registerAccount,
  updateAuthUser,
  useAuthStore,
  type AuthUser,
} from "@/store/auth"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type JobRecord = {
  id: string
  title: string
  status: string
  city: string | null
  state: string | null
  streetAddress: string | null
  zipCode: string | null
  jobType: string | null
  contractPrice: string | null
  projectedStart: string | null
  projectedCompletion: string | null
  actualStart: string | null
  actualCompletion: string | null
  workDays: string[] | null
  createdAt: string
  updatedAt: string
  createdByName?: string | null
}

type LeadRecord = {
  id: string
  title: string
  city: string | null
  state: string | null
  confidence: number | null
  status: string
  projectType: string | null
  estimatedRevenueMin: string | null
  estimatedRevenueMax: string | null
  projectedSalesDate: string | null
  createdAt: string
  updatedAt: string
}

type AuthLocationState = {
  from?: {
    pathname?: string
  }
}

type DashboardStats = {
  activeJobs: number
  openLeads: number
  openScheduleItems: number
  myDailyLogs: number
}

type ActivityEntry = {
  id: string
  entityType: string
  entityId: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
  userName: string | null
}

type SearchResult = {
  id: string
  type: "job" | "lead" | "file" | "schedule"
  title: string
  subtitle: string
  href: string
}

function useAuthBootstrap() {
  useEffect(() => {
    void bootstrapAuth()
  }, [])
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function formatCurrency(value: string | null) {
  if (!value) {
    return "—"
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value))
}

function formatDate(value: string | null) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function formatRelativeTimestamp(value: string) {
  return `${formatDistanceToNow(new Date(value), { addSuffix: false })} ago`
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value)
}

function searchGroupLabel(type: SearchResult["type"]) {
  if (type === "job") {
    return "Jobs"
  }

  if (type === "lead") {
    return "Leads"
  }

  if (type === "file") {
    return "Files"
  }

  return "Schedule"
}

function activityIconClass(action: string) {
  if (action.includes("deleted")) {
    return "border-red-200 bg-red-50 text-red-600"
  }

  if (action.includes("published") || action.includes("won")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-600"
  }

  if (action.includes("uploaded")) {
    return "border-amber-200 bg-amber-50 text-amber-600"
  }

  return "border-blue-200 bg-blue-50 text-blue-600"
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase()

  if (normalized === "open") {
    return "border-blue-200 bg-blue-50 text-blue-700"
  }

  if (normalized === "closed" || normalized === "archived" || normalized === "lost") {
    return "border-slate-200 bg-slate-100 text-slate-700"
  }

  if (normalized === "won") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (normalized === "in_negotiation") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }

  return "border-slate-200 bg-slate-100 text-slate-700"
}

function navButtonClass(isActive: boolean) {
  return cn(
    "h-10 w-full justify-start rounded-md px-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    isActive && "bg-blue-50 text-blue-700 hover:bg-blue-50 hover:text-blue-700",
  )
}

function RouteLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
      <Card className="w-full max-w-md border-[#E5E7EB] shadow-sm">
        <CardContent className="flex items-center justify-center gap-3 py-10">
          <Spinner className="size-5 text-blue-600" />
          <p className="text-sm text-slate-600">Checking your session…</p>
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="rounded-full border border-[#E5E7EB] bg-slate-50 p-3 text-slate-500">
          <FolderKanban className="size-5" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <p className="max-w-md text-sm text-slate-500">{description}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  )
}

function PageHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#E5E7EB] px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-950">{title}</h1>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

function AppHeader() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  if (!user) {
    return null
  }

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setOpen(false)
      setLoading(false)
      setHighlightedIndex(0)
      return
    }

    const timeout = window.setTimeout(() => {
      setLoading(true)

      void api
        .get<{ results: SearchResult[] }>("/search", {
          params: {
            q: query.trim(),
            limit: 10,
          },
        })
        .then((response) => {
          setResults(response.data.results)
          setOpen(true)
          setHighlightedIndex(0)
        })
        .catch(() => {
          setResults([])
          setOpen(true)
        })
        .finally(() => {
          setLoading(false)
        })
    }, 200)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [])

  const groupedResults = useMemo(() => {
    return results.reduce<Array<{ label: string; items: SearchResult[] }>>((groups, result) => {
      const label = searchGroupLabel(result.type)
      const existing = groups.find((group) => group.label === label)

      if (existing) {
        existing.items.push(result)
        return groups
      }

      groups.push({
        label,
        items: [result],
      })

      return groups
    }, [])
  }, [results])

  const flattenedResults = useMemo(() => {
    return groupedResults.flatMap((group) => group.items)
  }, [groupedResults])

  const activeResult = flattenedResults[highlightedIndex] ?? null

  const openResult = (result: SearchResult) => {
    setQuery("")
    setResults([])
    setOpen(false)
    navigate(result.href)
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[#E5E7EB] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-4 px-4 lg:px-6">
        <Button
          variant="ghost"
          className="h-auto px-0 text-base font-semibold text-slate-950 hover:bg-transparent hover:text-blue-700"
          asChild
        >
          <Link to="/dashboard">CAD Stone Networks</Link>
        </Button>

        <div className="hidden flex-1 md:flex">
          <div ref={wrapperRef} className="relative w-full max-w-2xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              placeholder="Search jobs, leads, files, and schedule items"
              value={query}
              onFocus={() => {
                if (query.trim()) {
                  setOpen(true)
                }
              }}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (!open || flattenedResults.length === 0) {
                  return
                }

                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setHighlightedIndex((current) => (current + 1) % flattenedResults.length)
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setHighlightedIndex((current) =>
                    current === 0 ? flattenedResults.length - 1 : current - 1,
                  )
                }

                if (event.key === "Enter" && activeResult) {
                  event.preventDefault()
                  openResult(activeResult)
                }

                if (event.key === "Escape") {
                  setOpen(false)
                }
              }}
              className="h-10 border-[#E5E7EB] bg-[#F9FAFB] pl-9 text-sm shadow-none"
            />

            {open ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-xl">
                {loading ? (
                  <div className="space-y-3 p-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ))}
                  </div>
                ) : results.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-500">
                    No matches found for “{query.trim()}”.
                  </div>
                ) : (
                  <div className="max-h-[28rem] overflow-y-auto py-2">
                    {groupedResults.map((group) => (
                      <div key={group.label} className="px-2 pb-2">
                        <div className="px-2 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          {group.label}
                        </div>
                        <div className="space-y-1">
                          {group.items.map((result) => {
                            const resultIndex = flattenedResults.findIndex((item) => item.id === result.id)
                            const isActive = resultIndex === highlightedIndex

                            return (
                              <button
                                key={`${result.type}-${result.id}`}
                                type="button"
                                className={cn(
                                  "flex w-full flex-col rounded-lg px-3 py-2 text-left transition",
                                  isActive ? "bg-blue-50 text-blue-700" : "hover:bg-[#F9FAFB]",
                                )}
                                onMouseEnter={() => setHighlightedIndex(resultIndex)}
                                onClick={() => openResult(result)}
                              >
                                <span className="text-sm font-medium text-slate-900">
                                  {result.title}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {result.subtitle}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-auto h-10 gap-3 rounded-full px-2 hover:bg-slate-100">
              <Avatar className="size-8 border border-[#E5E7EB]">
                <AvatarImage src={user.avatarUrl || undefined} alt={user.fullName} />
                <AvatarFallback className="bg-blue-50 text-blue-700">
                  {initials(user.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden text-left sm:block">
                <div className="text-sm font-medium text-slate-900">{user.fullName}</div>
                <div className="text-xs capitalize text-slate-500">
                  {user.role.replaceAll("_", " ")}
                </div>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-[#E5E7EB]">
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <UserCircle2 className="size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await logout()
                navigate("/login", { replace: true })
              }}
            >
              <Logs className="size-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function SidebarCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col border-r border-[#E5E7EB] bg-white">{children}</div>
  )
}

function SidebarSection({ children }: { children: ReactNode }) {
  return <div className="space-y-1 px-3 py-3">{children}</div>
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
}) {
  return (
    <NavLink to={to} end={end}>
      {({ isActive }) => (
        <Button variant="ghost" className={navButtonClass(isActive)}>
          <Icon className="size-4" />
          {label}
        </Button>
      )}
    </NavLink>
  )
}

function ShellFrame({
  desktopSidebar,
  mobileSidebar,
}: {
  desktopSidebar: ReactNode
  mobileSidebar: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <AppHeader />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1600px]">
        <aside className="hidden w-72 shrink-0 lg:block">{desktopSidebar}</aside>
        <main className="flex-1 p-4 lg:p-6">
          <div className="mb-4 lg:hidden">{mobileSidebar}</div>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function GlobalShell() {
  const sidebar = (
    <SidebarCard>
      <SidebarSection>
        <SidebarLink to="/dashboard" label="Dashboard" icon={LayoutDashboard} />
        <SidebarLink to="/jobs" label="Jobs" icon={BriefcaseBusiness} end />
        <SidebarLink to="/sales/leads" label="Sales" icon={Users} />
        <SidebarLink to="/settings" label="Settings" icon={Settings} />
      </SidebarSection>
    </SidebarCard>
  )

  const mobileSidebar = (
    <Card className="border-[#E5E7EB] shadow-sm">
      <CardContent className="flex gap-2 overflow-x-auto p-3">
        <SidebarLink to="/dashboard" label="Dashboard" icon={LayoutDashboard} />
        <SidebarLink to="/jobs" label="Jobs" icon={BriefcaseBusiness} end />
        <SidebarLink to="/sales/leads" label="Sales" icon={Users} />
        <SidebarLink to="/settings" label="Settings" icon={Settings} />
      </CardContent>
    </Card>
  )

  return <ShellFrame desktopSidebar={sidebar} mobileSidebar={mobileSidebar} />
}

function JobShell() {
  const { jobId } = useParams()
  const location = useLocation()
  const [job, setJob] = useState<JobRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshJob = async () => {
    if (!jobId) {
      setJob(null)
      setLoading(false)
      return null
    }

    setLoading(true)

    try {
      const response = await api.get<{ job: JobRecord }>(`/jobs/${jobId}`)
      setJob(response.data.job)
      return response.data.job
    } catch {
      setJob(null)
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    if (!jobId) {
      setLoading(false)
      return
    }

    setLoading(true)

    void api
      .get<{ job: JobRecord }>(`/jobs/${jobId}`)
      .then((response) => {
        if (!active) {
          return
        }

        setJob(response.data.job)
      })
      .catch(() => {
        if (!active) {
          return
        }

        setJob(null)
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [jobId])

  const currentSection = location.pathname.includes("/files/")
    ? "files"
    : location.pathname.endsWith("/schedule")
      ? "schedule"
      : location.pathname.endsWith("/daily-logs")
        ? "daily-logs"
        : "summary"

  const desktopSidebar = (
    <SidebarCard>
      <SidebarSection>
        <Button variant="ghost" className="h-10 w-full justify-start rounded-md px-3 text-slate-600" asChild>
          <Link to="/jobs">
            <ArrowLeft className="size-4" />
            Back to Jobs
          </Link>
        </Button>
      </SidebarSection>

      <div className="border-y border-[#E5E7EB] px-4 py-4">
        <div className="space-y-2">
          <div className="text-base font-semibold text-slate-950">
            {loading ? "Loading job…" : job?.title || "Job not found"}
          </div>
          {job ? (
            <Badge variant="outline" className={statusBadgeClass(job.status)}>
              {job.status.replaceAll("_", " ")}
            </Badge>
          ) : null}
        </div>
      </div>

      <SidebarSection>
        <SidebarLink to={`/jobs/${jobId}`} label="Summary" icon={LayoutDashboard} end />
        <SidebarLink to={`/jobs/${jobId}/files/documents`} label="Files" icon={FolderKanban} />
        <SidebarLink to={`/jobs/${jobId}/schedule`} label="Schedule" icon={Logs} />
        <SidebarLink to={`/jobs/${jobId}/daily-logs`} label="Daily Logs" icon={Logs} />
      </SidebarSection>
    </SidebarCard>
  )

  const mobileSidebar = (
    <Card className="border-[#E5E7EB] shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" className="h-9 px-0 text-slate-600" asChild>
            <Link to="/jobs">
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
          {job ? (
            <Badge variant="outline" className={statusBadgeClass(job.status)}>
              {job.status.replaceAll("_", " ")}
            </Badge>
          ) : null}
        </div>
        <div className="text-base font-semibold text-slate-950">
          {loading ? "Loading job…" : job?.title || "Job not found"}
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <SidebarLink to={`/jobs/${jobId}`} label="Summary" icon={LayoutDashboard} end />
          <SidebarLink to={`/jobs/${jobId}/files/documents`} label="Files" icon={FolderKanban} />
          <SidebarLink to={`/jobs/${jobId}/schedule`} label="Schedule" icon={Logs} />
          <SidebarLink to={`/jobs/${jobId}/daily-logs`} label="Daily Logs" icon={Logs} />
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <AppHeader />
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1600px]">
        <aside className="hidden w-72 shrink-0 lg:block">{desktopSidebar}</aside>
        <main className="flex-1 p-4 lg:p-6">
          <div className="mb-4 lg:hidden">{mobileSidebar}</div>
          {loading ? (
            <EmptyState
              title="Loading job context"
              description="Fetching job details for the sidebar and summary view."
            />
          ) : job ? (
            <div className="space-y-4">
              <Card className="border-[#E5E7EB] bg-white shadow-sm">
                <CardContent className="space-y-4 p-6">
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link to="/jobs">Jobs</Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>{job.title}</BreadcrumbPage>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>

                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-2xl font-semibold text-slate-950">{job.title}</h1>
                        <Badge variant="outline" className={statusBadgeClass(job.status)}>
                          {job.status.replaceAll("_", " ")}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        {[job.streetAddress, job.city, job.state, job.zipCode]
                          .filter(Boolean)
                          .join(", ") || "No job address saved yet."}
                      </p>
                    </div>

                    <Button variant="outline" className="border-[#E5E7EB]" asChild>
                      <Link to={`/jobs/${job.id}`}>Edit</Link>
                    </Button>
                  </div>

                  <Tabs value={currentSection}>
                    <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
                      <TabsTrigger value="summary" asChild>
                        <Link to={`/jobs/${job.id}`}>Summary</Link>
                      </TabsTrigger>
                      <TabsTrigger value="files" asChild>
                        <Link to={`/jobs/${job.id}/files/documents`}>Files</Link>
                      </TabsTrigger>
                      <TabsTrigger value="schedule" asChild>
                        <Link to={`/jobs/${job.id}/schedule`}>Schedule</Link>
                      </TabsTrigger>
                      <TabsTrigger value="daily-logs" asChild>
                        <Link to={`/jobs/${job.id}/daily-logs`}>Daily Logs</Link>
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </CardContent>
              </Card>

              <Outlet
                context={{
                  job,
                  refreshJob,
                  setJob,
                }}
              />
            </div>
          ) : (
            <EmptyState
              title="Job not found"
              description="The selected job could not be loaded. Pick another job from the Jobs list."
              action={
                <Button asChild>
                  <Link to="/jobs">Return to Jobs</Link>
                </Button>
              }
            />
          )}
        </main>
      </div>
    </div>
  )
}

function RequireAuth() {
  const location = useLocation()
  const { initialized, status } = useAuthStore((state) => ({
    initialized: state.initialized,
    status: state.status,
  }))

  if (!initialized || status === "checking") {
    return <RouteLoadingScreen />
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

function PublicOnlyRoute() {
  const { initialized, status } = useAuthStore((state) => ({
    initialized: state.initialized,
    status: state.status,
  }))

  if (!initialized || status === "checking") {
    return <RouteLoadingScreen />
  }

  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function AuthPageShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] px-4 py-10">
      <Card className="w-full max-w-md border-[#E5E7EB] shadow-sm">
        <CardHeader className="space-y-2 pb-4">
          <Button
            variant="ghost"
            className="h-auto w-fit px-0 text-sm font-semibold text-blue-700 hover:bg-transparent hover:text-blue-800"
            asChild
          >
            <Link to="/login">CAD Stone Networks</Link>
          </Button>
          <CardTitle className="text-2xl text-slate-950">{title}</CardTitle>
          <CardDescription className="text-sm text-slate-500">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {children}
          <div className="text-sm text-slate-500">{footer}</div>
        </CardContent>
      </Card>
    </div>
  )
}

export function LoginPage() {
  useAuthBootstrap()

  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)
  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
  })

  const state = location.state as AuthLocationState | null
  const nextPath = state?.from?.pathname || "/dashboard"

  return (
    <AuthPageShell
      title="Sign in"
      description="Use your Cadstone account to access the internal operations workspace."
      footer={
        <>
          Need an account?{" "}
          <Link className="font-medium text-blue-700" to="/register">
            Create one
          </Link>
        </>
      }
    >
      <Form {...form}>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setSubmitting(true)

            try {
              await login(values)
              navigate(nextPath, { replace: true })
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Unable to sign in.")
            } finally {
              setSubmitting(false)
            }
          })}
        >
          <FormField
            control={form.control}
            name="email"
            rules={{ required: "Email is required." }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="email"
                    placeholder="name@cadstone.internal"
                    className="border-[#E5E7EB]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            rules={{ required: "Password is required." }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="border-[#E5E7EB]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Spinner className="size-4" /> : null}
            Sign in
          </Button>
        </form>
      </Form>
    </AuthPageShell>
  )
}

export function RegisterPage() {
  useAuthBootstrap()

  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const form = useForm({
    defaultValues: {
      full_name: "",
      email: "",
      password: "",
    },
  })

  return (
    <AuthPageShell
      title="Create account"
      description="Register a new internal user profile and continue into the app shell."
      footer={
        <>
          Already have an account?{" "}
          <Link className="font-medium text-blue-700" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <Form {...form}>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setSubmitting(true)

            try {
              await registerAccount(values)
              navigate("/dashboard", { replace: true })
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Unable to create account.")
            } finally {
              setSubmitting(false)
            }
          })}
        >
          <FormField
            control={form.control}
            name="full_name"
            rules={{ required: "Full name is required." }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input placeholder="Maria Garcia" className="border-[#E5E7EB]" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            rules={{ required: "Email is required." }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="email"
                    placeholder="name@cadstone.internal"
                    className="border-[#E5E7EB]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            rules={{
              required: "Password is required.",
              minLength: {
                value: 8,
                message: "Password must be at least 8 characters.",
              },
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    className="border-[#E5E7EB]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Spinner className="size-4" /> : null}
            Create account
          </Button>
        </form>
      </Form>
    </AuthPageShell>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((state) => state.accessToken)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [jobPickerOpen, setJobPickerOpen] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState("")

  const loadStatsAndJobs = async () => {
    setLoadingStats(true)

    try {
      const [statsResponse, jobsResponse] = await Promise.all([
        api.get<{ stats: DashboardStats }>("/dashboard/stats"),
        api.get<{ jobs: JobRecord[] }>("/jobs", {
          params: {
            page: 1,
            pageSize: 100,
            status: "open",
          },
        }),
      ])

      setStats(statsResponse.data.stats)
      setJobs(jobsResponse.data.jobs)
      setSelectedJobId((current) => current || jobsResponse.data.jobs[0]?.id || "")
    } catch {
      toast.error("Unable to load dashboard stats.")
    } finally {
      setLoadingStats(false)
    }
  }

  const loadActivity = async (silent = false) => {
    if (!silent) {
      setLoadingActivity(true)
    }

    try {
      const response = await api.get<{
        entries: ActivityEntry[]
      }>("/activity", {
        params: {
          page: 1,
          limit: 20,
        },
      })

      setActivity(response.data.entries)
    } catch {
      toast.error("Unable to load recent activity.")
    } finally {
      setLoadingActivity(false)
    }
  }

  useEffect(() => {
    void Promise.all([loadStatsAndJobs(), loadActivity()])
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadActivity(true)
    }, 30_000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!accessToken) {
      return
    }

    const socket = io("/", {
      auth: {
        token: accessToken,
      },
      transports: ["websocket", "polling"],
    })

    socket.on("activity:created", (entry: ActivityEntry) => {
      setActivity((current) => {
        if (current.some((item) => item.id === entry.id)) {
          return current
        }

        return [entry, ...current].slice(0, 20)
      })
    })

    return () => {
      socket.disconnect()
    }
  }, [accessToken])

  const firstOpenJobId = jobs[0]?.id ?? null
  const statCards = [
    {
      title: "Active Jobs",
      value: stats?.activeJobs ?? 0,
      description: "Open work across the company",
      icon: BriefcaseBusiness,
      onClick: () => navigate("/jobs"),
    },
    {
      title: "Open Leads",
      value: stats?.openLeads ?? 0,
      description: "Pipeline opportunities still in motion",
      icon: Users,
      onClick: () => navigate("/sales/leads"),
    },
    {
      title: "Open Schedule Items",
      value: stats?.openScheduleItems ?? 0,
      description: "Upcoming and active work still on the board",
      icon: CalendarDays,
      onClick: () => navigate(firstOpenJobId ? `/jobs/${firstOpenJobId}/schedule` : "/jobs"),
    },
    {
      title: "My Daily Logs",
      value: stats?.myDailyLogs ?? 0,
      description: "Drafts and published logs tied to your account",
      icon: ClipboardList,
      onClick: () =>
        navigate(firstOpenJobId ? `/jobs/${firstOpenJobId}/daily-logs` : "/jobs"),
    },
  ]

  return (
    <>
      <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading
        title="Dashboard"
        description="Live counts, quick actions, and the latest project activity across the Cadstone workspace."
      />
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {loadingStats
              ? Array.from({ length: 4 }).map((_, index) => (
                  <Card key={index} className="border-[#E5E7EB] shadow-none">
                    <CardContent className="space-y-3 p-5">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-8 w-20" />
                      <Skeleton className="h-3 w-full" />
                    </CardContent>
                  </Card>
                ))
              : statCards.map((card) => (
                  <button
                    key={card.title}
                    type="button"
                    className="rounded-xl text-left"
                    onClick={card.onClick}
                  >
                    <Card className="h-full border-[#E5E7EB] shadow-none transition hover:border-blue-200 hover:bg-blue-50/40">
                      <CardContent className="space-y-3 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-600">{card.title}</p>
                          <div className="rounded-full border border-blue-200 bg-blue-50 p-2 text-blue-700">
                            <card.icon className="size-4" />
                          </div>
                        </div>
                        <div className="text-3xl font-semibold text-slate-950">
                          {formatCount(card.value)}
                        </div>
                        <p className="text-sm text-slate-500">{card.description}</p>
                      </CardContent>
                    </Card>
                  </button>
                ))}
          </div>

          <Card className="border-[#E5E7EB] shadow-none">
            <CardHeader className="border-b border-[#E5E7EB] pb-4">
              <CardTitle className="text-base">Quick Actions</CardTitle>
              <CardDescription>
                Jump straight into the highest-frequency creation flows.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 p-5">
              <Button type="button" onClick={() => navigate("/jobs?create=1")}>
                <Plus className="size-4" />
                New Job
              </Button>
              <Button type="button" variant="outline" className="border-[#E5E7EB]" onClick={() => navigate("/sales/leads?create=1")}>
                <Plus className="size-4" />
                New Lead
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-[#E5E7EB]"
                onClick={() => {
                  if (jobs.length === 0) {
                    toast.info("Create a job before starting a daily log.")
                    navigate("/jobs?create=1")
                    return
                  }

                  if (jobs.length === 1) {
                    navigate(`/jobs/${jobs[0].id}/daily-logs?create=1`)
                    return
                  }

                  setJobPickerOpen(true)
                }}
              >
                <Plus className="size-4" />
                Daily Log
              </Button>
            </CardContent>
          </Card>

          <Card className="border-[#E5E7EB] shadow-none">
            <CardHeader className="border-b border-[#E5E7EB] pb-4">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>
                The last 20 activity events across jobs, leads, files, schedule items, and daily logs.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loadingActivity ? (
                <div className="space-y-4 p-5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <Skeleton className="size-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activity.length === 0 ? (
                <EmptyState
                  title="No recent activity"
                  description="Activity will appear here as jobs, files, leads, schedule items, and daily logs change."
                />
              ) : (
                <div className="divide-y divide-[#E5E7EB]">
                  {activity.map((entry) => {
                    const description =
                      typeof entry.metadata?.description === "string"
                        ? entry.metadata.description
                        : "Activity recorded"
                    const jobTitle =
                      typeof entry.metadata?.jobTitle === "string"
                        ? entry.metadata.jobTitle
                        : null

                    return (
                      <div key={entry.id} className="flex items-start gap-3 px-5 py-4">
                        <div className={cn("rounded-full border p-2", activityIconClass(entry.action))}>
                          <Logs className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-900">{description}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {(entry.userName || "Unknown user") +
                              (jobTitle ? ` • ${jobTitle}` : "") +
                              ` • ${formatRelativeTimestamp(entry.createdAt)}`}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <Dialog open={jobPickerOpen} onOpenChange={setJobPickerOpen}>
        <DialogContent className="border-[#E5E7EB] bg-white">
          <DialogHeader>
            <DialogTitle>Create Daily Log</DialogTitle>
            <DialogDescription>
              Pick the job that should receive the new daily log draft.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-900">Job</label>
            <Select value={selectedJobId} onValueChange={setSelectedJobId}>
              <SelectTrigger className="border-[#E5E7EB]">
                <SelectValue placeholder="Select a job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="border-[#E5E7EB]" onClick={() => setJobPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedJobId}
              onClick={() => {
                setJobPickerOpen(false)
                navigate(`/jobs/${selectedJobId}/daily-logs?create=1`)
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function JobsPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    let active = true

    setLoading(true)

    void api
      .get<{ jobs: JobRecord[] }>("/jobs")
      .then((response) => {
        if (active) {
          setJobs(response.data.jobs)
        }
      })
      .catch(() => {
        if (active) {
          toast.error("Unable to load jobs.")
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const filteredJobs = jobs.filter((job) =>
    [job.title, job.city, job.state, job.jobType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  )

  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading
        title="Jobs"
        description="Seeded records are live so you can validate navigation, route protection, and job context."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs"
              className="w-56 border-[#E5E7EB] bg-white"
            />
            <Button onClick={() => toast.info("Create Job modal is scoped to the next phase.")}>
              + Create Job
            </Button>
          </>
        }
      />

      <CardContent className="p-6">
        {loading ? (
          <EmptyState
            title="Loading jobs"
            description="Fetching the seeded job list from the protected API."
          />
        ) : filteredJobs.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description="Create your first job to get started."
            action={<Button onClick={() => toast.info("Create Job modal is next.")}>Create Job</Button>}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Job Title</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Contract Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <TableCell className="font-medium text-blue-700">{job.title}</TableCell>
                    <TableCell>
                      {[job.city, job.state].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell>{job.jobType || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(job.status)}>
                        {job.status.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(job.createdAt)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(job.contractPrice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function JobSummaryPage() {
  const job = useOutletContext<JobRecord>()

  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading
        title={job.title}
        description="Summary foundation view wired to the seeded job record."
        actions={
          <Badge variant="outline" className={statusBadgeClass(job.status)}>
            {job.status.replaceAll("_", " ")}
          </Badge>
        }
      />
      <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        <Card className="border-[#E5E7EB] shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600">
            <p>{job.streetAddress || "—"}</p>
            <p>{[job.city, job.state, job.zipCode].filter(Boolean).join(", ") || "—"}</p>
          </CardContent>
        </Card>

        <Card className="border-[#E5E7EB] shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600">
            <p>Projected start: {formatDate(job.projectedStart)}</p>
            <p>Projected completion: {formatDate(job.projectedCompletion)}</p>
            <p>Actual completion: {formatDate(job.actualCompletion)}</p>
          </CardContent>
        </Card>

        <Card className="border-[#E5E7EB] shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Commercial Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600">
            <p>Contract price: {formatCurrency(job.contractPrice)}</p>
            <p>Type: {job.jobType || "—"}</p>
            <p>Work days: {job.workDays?.join(", ") || "—"}</p>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  )
}

function JobPlaceholderPage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  const job = useOutletContext<JobRecord>()

  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading title={title} description={`${job.title} • ${description}`} />
      <CardContent className="p-6">
        <EmptyState
          title={`${title} is next`}
          description="This route is scaffolded, protected, and inside the persistent app shell. The full feature UI lands in the next tasks."
        />
      </CardContent>
    </Card>
  )
}

export function FilesDocumentsPage() {
  return (
    <JobPlaceholderPage
      title="Documents"
      description="Document folders, uploads, and activity live here."
    />
  )
}

export function FilesPhotosPage() {
  return (
    <JobPlaceholderPage
      title="Photos"
      description="Photo folders and image previews live here."
    />
  )
}

export function FilesVideosPage() {
  return (
    <JobPlaceholderPage
      title="Videos"
      description="Video uploads and playback previews live here."
    />
  )
}

export function SchedulePage() {
  return (
    <JobPlaceholderPage
      title="Schedule"
      description="Calendar, list, and gantt scheduling views live here."
    />
  )
}

export function DailyLogsPage() {
  return (
    <JobPlaceholderPage
      title="Daily Logs"
      description="Drafts, publishing, and weather-backed daily logs live here."
    />
  )
}

export function SalesLeadsPage() {
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    void api
      .get<{ leads: LeadRecord[] }>("/leads")
      .then((response) => {
        if (active) {
          setLeads(response.data.leads)
        }
      })
      .catch(() => {
        if (active) {
          toast.error("Unable to load lead opportunities.")
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading
        title="Lead Opportunities"
        description="Read-only foundation view backed by the seeded sales pipeline."
        actions={
          <Button onClick={() => toast.info("Lead creation modal is part of the next phase.")}>
            + Lead Opportunity
          </Button>
        }
      />
      <CardContent className="p-6">
        {loading ? (
          <EmptyState
            title="Loading leads"
            description="Fetching the protected sales pipeline."
          />
        ) : leads.length === 0 ? (
          <EmptyState
            title="No leads yet"
            description="Create your first lead opportunity."
            action={<Button onClick={() => toast.info("Lead creation modal is next.")}>Create Lead</Button>}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Projected Sales Date</TableHead>
                  <TableHead className="text-right">Est. Revenue Min</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium text-blue-700">{lead.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(lead.status)}>
                        {lead.status.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{lead.confidence ?? 0}%</TableCell>
                    <TableCell>{formatDate(lead.projectedSalesDate)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(lead.estimatedRevenueMin)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const user = useAuthStore((state) => state.user)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const form = useForm({
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      avatarUrl: "",
    },
  })

  useEffect(() => {
    let active = true

    void api
      .get<{ user: AuthUser }>("/users/me")
      .then((response) => {
        if (!active) {
          return
        }

        form.reset({
          fullName: response.data.user.fullName,
          email: response.data.user.email,
          phone: response.data.user.phone || "",
          avatarUrl: response.data.user.avatarUrl || "",
        })
        updateAuthUser(response.data.user)
      })
      .catch(() => {
        if (active) {
          toast.error("Unable to load your profile.")
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [form])

  if (!user) {
    return <RouteLoadingScreen />
  }

  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading
        title="Settings"
        description="Manage your Cadstone profile details and keep account information current."
      />
      <CardContent className="p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          {loading ? (
            <Card className="border-[#E5E7EB] shadow-none">
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-36" />
              </CardContent>
            </Card>
          ) : (
            <Form {...form}>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit(async (values) => {
                  setSubmitting(true)

                  try {
                    const { data } = await api.put<{ user: AuthUser }>("/users/me", values)
                    updateAuthUser(data.user)
                    form.reset({
                      fullName: data.user.fullName,
                      email: data.user.email,
                      phone: data.user.phone || "",
                      avatarUrl: data.user.avatarUrl || "",
                    })
                    toast.success("Profile updated.")
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Unable to save profile changes.",
                    )
                  } finally {
                    setSubmitting(false)
                  }
                })}
              >
                <FormField
                  control={form.control}
                  name="fullName"
                  rules={{ required: "Full name is required." }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input className="border-[#E5E7EB]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  rules={{ required: "Email is required." }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          className="border-[#E5E7EB]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Role</label>
                  <Input
                    value={user.role.replaceAll("_", " ")}
                    readOnly
                    className="border-[#E5E7EB] bg-[#F9FAFB] capitalize"
                  />
                </div>

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input className="border-[#E5E7EB]" placeholder="(303) 555-0123" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="avatarUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Avatar URL</FormLabel>
                      <FormControl>
                        <Input
                          className="border-[#E5E7EB]"
                          placeholder="https://example.com/avatar.jpg"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" disabled={submitting}>
                  {submitting ? <Spinner className="size-4" /> : null}
                  Save Changes
                </Button>
              </form>
            </Form>
          )}

          <Card className="border-[#E5E7EB] bg-slate-50 shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Current Session</CardTitle>
              <CardDescription>
                Access token stays in memory, and refresh stays in an httpOnly cookie.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>
                Signed in as <span className="font-medium text-slate-900">{user.fullName}</span>
              </p>
              <p>Role: {user.role.replaceAll("_", " ")}</p>
              <p>Updated: {formatDate(user.updatedAt)}</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}

export function RootRedirect() {
  return <Navigate to="/dashboard" replace />
}

export function NotFoundPage() {
  const { authenticated, initialized } = useAuthStore((state) => ({
    initialized: state.initialized,
    authenticated: state.status === "authenticated",
  }))

  if (!initialized) {
    return <RouteLoadingScreen />
  }

  if (authenticated) {
    return (
      <Card className="mx-auto mt-12 max-w-xl border-[#E5E7EB] shadow-sm">
        <CardContent className="space-y-4 px-6 py-10 text-center">
          <h1 className="text-2xl font-semibold text-slate-950">Page not found</h1>
          <p className="text-sm text-slate-500">
            The route exists outside the current foundation shell. Use the primary navigation to continue.
          </p>
          <Button asChild>
            <Link to="/dashboard">Return to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <AuthPageShell
      title="Page not found"
      description="The requested route does not exist in this build."
      footer={
        <Link className="font-medium text-blue-700" to="/login">
          Return to login
        </Link>
      }
    >
      <div className="text-sm text-slate-500">
        Protected routes are available after signing in.
      </div>
    </AuthPageShell>
  )
}

export const routeElements = {
  RequireAuth,
  PublicOnlyRoute,
  GlobalShell,
  JobShell,
}
