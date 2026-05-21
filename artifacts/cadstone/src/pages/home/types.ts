// Type contracts for the role-aware /dashboard/home payload. The backend
// generates an `AnyValue`-typed JSON response (consistent with the rest of
// the dashboard endpoints), so we narrow it on the client. Keep these in
// sync with `buildCrewHome / buildPmHome / buildAdminHome` in
// artifacts/api-server/src/routes/dashboard.ts.

export type CrewHome = {
  role: "crew"
  today: string
  schedule: { items: CrewScheduleItem[] }
  todos: CrewTodo[]
  forecast: CrewForecast | null
  weather: WeatherStrip | null
  latestLog: { id: string; logDate: string; jobId: string; jobTitle: string | null; title: string | null } | null
}

export type CrewForecast = {
  jobId: string
  jobTitle: string | null
  address: string
  condition: string
  icon: string
  temperatureHigh: number | null
  temperatureLow: number | null
  windMph: number | null
  humidity: number | null
  precipitation: number
  fetchedAt: string
}

type CrewScheduleItem = {
  id: string
  title: string
  startDate: string
  endDate: string
  startTime: string | null
  endTime: string | null
  displayColor: string
  progress: number
  isComplete: boolean
  jobId: string
  jobTitle: string | null
  jobCity: string | null
  jobState: string | null
  jobAddress: string | null
}

type CrewTodo = {
  id: string
  title: string
  isComplete: boolean
  scheduleItemId: string
  scheduleItemTitle: string | null
  jobId: string | null
  jobTitle: string | null
}

type WeatherStrip = {
  jobId: string
  jobTitle: string | null
  logDate: string
  weatherData: Record<string, unknown> | null
  weatherNotes: string | null
}

export type PmHome = {
  role: "pm"
  today: string
  week: { start: string; end: string; items: PmWeekItem[] }
  atRisk: {
    overdueScheduleItems: number
    jobsMissingLogs: number
    pendingChangeOrders: number
    samples: {
      overdue: Array<{ id: string; title: string; endDate: string; jobId: string; jobTitle: string | null }>
      missingLogJobs: Array<{ id: string; title: string }>
      pendingChangeOrders: Array<{
        id: string
        number: string
        amountCents: number
        jobId: string
        jobTitle: string | null
      }>
    }
  }
  teamLogs: PmTeamLog[]
  summary: { activeJobs: number; openLeads: number; openScheduleItems: number }
}

type PmWeekItem = {
  id: string
  title: string
  startDate: string
  endDate: string
  progress: number
  isComplete: boolean
  displayColor: string
  jobId: string
  jobTitle: string | null
}

type PmTeamLog = {
  id: string
  logDate: string
  title: string | null
  notes: string
  jobId: string
  jobTitle: string | null
  createdAt: string
  createdById: string | null
  createdByName: string | null
}

export type AdminHome = {
  role: "admin"
  today: string
  monthStart: string
  kpis: {
    activeJobs: number
    openLeads: number
    newJobsThisMonth: number
    newContractValueThisMonthCents: number
    arOutstandingCents: number
    pastDueInvoiceCount: number
  }
  topClients: Array<{ clientId: string | null; clientName: string; openBalanceCents: number }>
  pastDueInvoices: Array<{
    id: string
    invoiceNumber: string | null
    invoiceDate: string | null
    totalCents: number
    paidCents: number
    jobId: string
    jobTitle: string | null
    clientId: string | null
    clientName: string | null
  }>
  jobsByStage: Array<{ stage: string; total: number }>
  recentLeads: Array<{
    id: string
    title: string
    status: string
    city: string | null
    state: string | null
    confidence: number | null
    createdAt: string
  }>
  calendar: { start: string; end: string; items: PmWeekItem[] }
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
