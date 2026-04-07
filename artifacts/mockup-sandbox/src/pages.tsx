import { useEffect, useState, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import {
  ArrowLeft,
  BriefcaseBusiness,
  FolderKanban,
  LayoutDashboard,
  Logs,
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

  if (!user) {
    return null
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
          <div className="relative w-full max-w-2xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              placeholder="Search jobs, leads, files, and schedule items"
              className="h-10 border-[#E5E7EB] bg-[#F9FAFB] pl-9 text-sm shadow-none"
            />
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
  const cards = [
    {
      title: "Dashboard",
      description:
        "The stats and activity feed land in the next task. The shell, routing, and auth flow are ready now.",
      href: "/jobs",
    },
    {
      title: "Jobs",
      description: "Seeded jobs are available so you can exercise the job-context sidebar today.",
      href: "/jobs",
    },
    {
      title: "Sales",
      description: "Lead placeholders are wired to the backend with the foundation schema in place.",
      href: "/sales/leads",
    },
    {
      title: "Settings",
      description: "Profile settings are connected to `/api/users/me` for account updates.",
      href: "/settings",
    },
  ]

  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading
        title="Dashboard"
        description="Foundation phase complete: authenticated shell, seeded records, and placeholder routes."
      />
      <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title} className="border-[#E5E7EB] shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{card.title}</CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full border-[#E5E7EB]" asChild>
                <Link to={card.href}>Open {card.title}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
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
  const [submitting, setSubmitting] = useState(false)
  const form = useForm({
    defaultValues: {
      fullName: "",
      phone: "",
      avatarUrl: "",
    },
  })

  useEffect(() => {
    if (!user) {
      return
    }

    form.reset({
      fullName: user.fullName,
      phone: user.phone || "",
      avatarUrl: user.avatarUrl || "",
    })
  }, [form, user])

  if (!user) {
    return <RouteLoadingScreen />
  }

  return (
    <Card className="border-[#E5E7EB] shadow-sm">
      <PageHeading
        title="Settings"
        description="Profile updates are persisted through the protected `/api/users/me` endpoint."
      />
      <CardContent className="p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit(async (values) => {
                setSubmitting(true)

                try {
                  const { data } = await api.put<{ user: AuthUser }>("/users/me", values)
                  updateAuthUser(data.user)
                  toast.success("Profile updated.")
                } catch {
                  toast.error("Unable to save profile changes.")
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

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">Email</label>
                <Input value={user.email} readOnly className="border-[#E5E7EB] bg-[#F9FAFB]" />
              </div>

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
