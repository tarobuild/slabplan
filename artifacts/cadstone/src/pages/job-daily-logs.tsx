import { useEffect, useMemo, useRef, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { useDropzone } from "react-dropzone"
import {
  Check,
  ChevronLeft,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  FileText,
  Filter,
  Heart,
  ImagePlus,
  Info,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Search,
  Send,
  Settings2,
  Smile,
  Sun,
  Users,
  X,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"

type JobContext = {
  job: JobOption | null
  jobId: string
}

type JobOption = {
  id: string
  title: string
  status?: string
  streetAddress: string | null
  city: string | null
  state: string | null
  zipCode: string | null
}

type UserOption = {
  id: string
  fullName: string
  email: string
  role: string
  avatarUrl: string | null
}

type WeatherSnapshot = {
  condition: string
  icon?: string | null
  temperatureHigh: number | null
  temperatureLow: number | null
  windMph: number | null
  humidity: number | null
  precipitation: number | null
  fetchedAt?: string | null
}

type DailyLogAttachment = {
  id: string
  fileId: string
  originalName: string
  fileUrl: string | null
  fileSize: number | null
  mimeType: string | null
  createdAt: string
  uploadedByName: string | null
}

type DailyLogTodo = {
  id: string
  title: string
  isComplete: boolean | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  createdByName: string | null
}

type CustomFieldScalar = string | number | boolean | null
type DailyLogCustomFieldType = "text" | "number" | "date" | "dropdown" | "checkbox"

type DailyLogCustomField = {
  id: string
  name: string
  fieldType: DailyLogCustomFieldType
  options: string[]
  displayOrder: number
}

type DailyLogListItem = {
  id: string
  jobId: string | null
  logDate: string
  title: string | null
  notes: string
  weatherData: WeatherSnapshot | null
  includeWeather: boolean | null
  includeWeatherNotes: boolean | null
  weatherNotes: string | null
  customFieldValues: Record<string, CustomFieldScalar>
  shareInternalUsers: boolean | null
  shareSubsVendors: boolean | null
  shareClient: boolean | null
  isPrivate: boolean | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  createdByName: string | null
  notifyUserIds: string[]
  tags: string[]
  attachmentCount: number
  likesCount: number
  commentsCount: number
  likedByCurrentUser: boolean
  visibilityLabel: string
  todoCount: number
  completedTodoCount: number
  status: "draft" | "published"
}

type DailyLogDetail = DailyLogListItem & {
  notifyUsers: UserOption[]
  attachments: DailyLogAttachment[]
  todos: DailyLogTodo[]
}

type CommentRecord = {
  id: string
  dailyLogId: string
  parentCommentId: string | null
  body: string
  mentions: string[]
  attachments: Array<{
    name: string
    url: string
    mimeType: string | null
  }>
  links: string[]
  reactions: Record<string, string[]>
  createdBy: string | null
  createdAt: string
  updatedAt: string
  author: {
    id: string | null
    fullName: string | null
    avatarUrl: string | null
  }
  replies: CommentRecord[]
}

type DailyLogSettings = {
  stampLocation: boolean
  defaultNotes: string
  includeWeatherByDefault: boolean
  includeWeatherNotesByDefault: boolean
  shareInternalUsersByDefault: boolean
  notifyInternalUsersByDefault: boolean
  shareEstimatorsByDefault: boolean
  notifyEstimatorsByDefault: boolean
  shareInstallersByDefault: boolean
  notifyInstallersByDefault: boolean
}

type FormValues = {
  jobId: string
  logDate: string
  title: string
  notes: string
  tags: string[]
  tagInput: string
  shareInternalUsers: boolean
  shareClient: boolean
  shareSubsVendors: boolean
  isPrivate: boolean
  notifyUserIds: string[]
  includeWeather: boolean
  includeWeatherNotes: boolean
  weatherNotes: string
  weatherData: WeatherSnapshot | null
  customFieldValues: Record<string, CustomFieldScalar>
}

type CommentDraftAttachment = {
  name: string
  url: string
  mimeType: string | null
}

type FilterPreset =
  | "all"
  | "custom"
  | "today"
  | "today_onward"
  | "next_30"
  | "next_14"
  | "next_7"
  | "today_tomorrow"
  | "past_7"
  | "past_14"
  | "past_30"
  | "past_45"
  | "past_60"
  | "past_90"
  | "past_180"
  | "past_365"

type FilterValues = {
  standardFilter: "all" | "published" | "draft" | "with_attachments" | "weather_included"
  sharedWith: "all" | "internal" | "estimators" | "installers" | "private"
  keywords: string
  createdBy: string
  datePreset: FilterPreset
  from: string
  to: string
  tags: string[]
}

const dailyLogShareDefaults = {
  shareInternalUsers: "shareInternalUsersByDefault",
  // Legacy API flag names: shareClient is used for estimators.
  shareClient: "shareEstimatorsByDefault",
  // Legacy API flag names: shareSubsVendors is used for installers.
  shareSubsVendors: "shareInstallersByDefault",
} as const

const dailyLogShareLabels: Array<
  [keyof Pick<FormValues, "shareInternalUsers" | "shareClient" | "shareSubsVendors" | "isPrivate">, string]
> = [
  ["shareInternalUsers", "Internal Users"],
  ["shareClient", "Estimators"],
  ["shareSubsVendors", "Installers"],
  ["isPrivate", "Private"],
]

const PAGE_SIZE = 10
const DEFAULT_SETTINGS: DailyLogSettings = {
  stampLocation: false,
  defaultNotes: "",
  includeWeatherByDefault: true,
  includeWeatherNotesByDefault: false,
  shareInternalUsersByDefault: true,
  notifyInternalUsersByDefault: false,
  shareEstimatorsByDefault: false,
  notifyEstimatorsByDefault: false,
  shareInstallersByDefault: false,
  notifyInstallersByDefault: false,
}
const DEFAULT_FILTERS: FilterValues = {
  standardFilter: "all",
  sharedWith: "all",
  keywords: "",
  createdBy: "all",
  datePreset: "all",
  from: "",
  to: "",
  tags: [],
}
const DATE_PRESET_OPTIONS: Array<{ value: FilterPreset; label: string }> = [
  { value: "all", label: "All dates" },
  { value: "custom", label: "Custom dates" },
  { value: "today", label: "Today" },
  { value: "today_onward", label: "Today onward" },
  { value: "next_30", label: "Next 30 days" },
  { value: "next_14", label: "Next 14 days" },
  { value: "next_7", label: "Next 7 days" },
  { value: "today_tomorrow", label: "Today & tomorrow" },
  { value: "past_7", label: "Past 7 days" },
  { value: "past_14", label: "Past 14 days" },
  { value: "past_30", label: "Past 30 days" },
  { value: "past_45", label: "Past 45 days" },
  { value: "past_60", label: "Past 60 days" },
  { value: "past_90", label: "Past 90 days" },
  { value: "past_180", label: "Past 180 days" },
  { value: "past_365", label: "Past 365 days" },
]
const QUICK_REACTIONS = ["👍", "❤️", "👀"]
const COMMENT_EMOJIS = ["😀", "👍", "🎉", "🚧", "📌", "✅"]

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

function toDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`))
}

function formatTitleDate(value: string) {
  const formatted = formatShortDate(value)
  return formatted.replace(/^[A-Za-z]+,/, (match) => match)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function truncateText(value: string | null | undefined, maxLength = 180) {
  if (!value) return "No notes added."
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function getInitials(value: string | null | undefined) {
  if (!value) return "?"
  const parts = value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

function buildAddress(job: JobOption | null | undefined) {
  if (!job) return ""
  return [job.streetAddress, job.city, job.state, job.zipCode].filter(Boolean).join(", ")
}

function normalizeWeatherData(value: unknown): WeatherSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const toNumber = (entry: unknown) =>
    typeof entry === "number" ? entry : typeof entry === "string" && entry !== "" ? Number(entry) : null

  return {
    condition: typeof record.condition === "string" ? record.condition : "Unavailable",
    icon: typeof record.icon === "string" ? record.icon : null,
    temperatureHigh: toNumber(record.temperatureHigh),
    temperatureLow: toNumber(record.temperatureLow),
    windMph: toNumber(record.windMph),
    humidity: toNumber(record.humidity),
    precipitation: toNumber(record.precipitation),
    fetchedAt: typeof record.fetchedAt === "string" ? record.fetchedAt : null,
  }
}

function getWeatherIcon(icon: string | null | undefined, className = "size-5") {
  const normalized = (icon || "").toLowerCase()

  if (normalized.includes("snow")) return <CloudSnow className={className} />
  if (normalized.includes("storm")) return <CloudLightning className={className} />
  if (normalized.includes("rain")) return <CloudRain className={className} />
  if (normalized.includes("cloud")) return <Cloud className={className} />
  if (normalized.includes("sun")) return <Sun className={className} />

  return <CloudSun className={className} />
}

function deriveWeatherIcon(snapshot: WeatherSnapshot | null) {
  if (!snapshot) return "sun"
  if (snapshot.icon) return snapshot.icon
  const text = snapshot.condition.toLowerCase()
  if (text.includes("snow")) return "snow"
  if (text.includes("storm") || text.includes("thunder")) return "storm"
  if (text.includes("rain") || text.includes("drizzle")) return "rain"
  if (text.includes("cloud") || text.includes("overcast") || text.includes("fog")) return "cloud"
  return "sun"
}

function titleForLog(logDate: string, title: string | null | undefined) {
  return `${formatTitleDate(logDate)} | ${title || "Daily Log"}`
}

function toQueryDate(date: Date) {
  return toDateOnly(date).toISOString().slice(0, 10)
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + amount)
  return next
}

function getDateRangeForPreset(preset: FilterPreset) {
  const now = toDateOnly(new Date())

  if (preset === "all") return { from: "", to: "" }
  if (preset === "custom") return null
  if (preset === "today") return { from: toQueryDate(now), to: toQueryDate(now) }
  if (preset === "today_onward") return { from: toQueryDate(now), to: "" }
  if (preset === "today_tomorrow") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 1)) }
  if (preset === "next_7") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 7)) }
  if (preset === "next_14") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 14)) }
  if (preset === "next_30") return { from: toQueryDate(now), to: toQueryDate(addDays(now, 30)) }
  if (preset === "past_7") return { from: toQueryDate(addDays(now, -7)), to: toQueryDate(now) }
  if (preset === "past_14") return { from: toQueryDate(addDays(now, -14)), to: toQueryDate(now) }
  if (preset === "past_30") return { from: toQueryDate(addDays(now, -30)), to: toQueryDate(now) }
  if (preset === "past_45") return { from: toQueryDate(addDays(now, -45)), to: toQueryDate(now) }
  if (preset === "past_60") return { from: toQueryDate(addDays(now, -60)), to: toQueryDate(now) }
  if (preset === "past_90") return { from: toQueryDate(addDays(now, -90)), to: toQueryDate(now) }
  if (preset === "past_180") return { from: toQueryDate(addDays(now, -180)), to: toQueryDate(now) }
  return { from: toQueryDate(addDays(now, -365)), to: toQueryDate(now) }
}

function apiError(err: unknown, fallback: string) {
  if (typeof err === "object" && err !== null) {
    const value = err as { response?: { data?: { message?: string } }; message?: string }
    return value.response?.data?.message ?? value.message ?? fallback
  }
  return fallback
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeCustomFieldValues(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, CustomFieldScalar>
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      if (
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean" ||
        entry === null
      ) {
        return [[key, entry] as const]
      }

      return []
    }),
  )
}

function normalizeDailyLogSettings(value: Partial<DailyLogSettings> | null | undefined): DailyLogSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
  }
}

function normalizeDailyLogCustomFields(value: unknown): DailyLogCustomField[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null
      }

      const record = entry as Record<string, unknown>
      const fieldType = record.fieldType
      if (
        fieldType !== "text" &&
        fieldType !== "number" &&
        fieldType !== "date" &&
        fieldType !== "dropdown" &&
        fieldType !== "checkbox"
      ) {
        return null
      }

      return {
        id: typeof record.id === "string" ? record.id : `field-${index}`,
        name: typeof record.name === "string" ? record.name : `Custom Field ${index + 1}`,
        fieldType,
        options: Array.isArray(record.options)
          ? record.options.filter((option): option is string => typeof option === "string")
          : [],
        displayOrder: typeof record.displayOrder === "number" ? record.displayOrder : index,
      } satisfies DailyLogCustomField
    })
    .filter((entry): entry is DailyLogCustomField => entry !== null)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name))
}

function userMatchesNotifyCategory(user: UserOption, category: "internal" | "estimators" | "installers") {
  if (category === "internal") {
    return true
  }

  if (category === "estimators") {
    return user.role === "admin" || user.role === "project_manager"
  }

  return user.role === "crew_member"
}

function buildDefaultNotifyUserIds(users: UserOption[], settings: DailyLogSettings) {
  const notifyCategories: Array<"internal" | "estimators" | "installers"> = []

  if (settings.notifyInternalUsersByDefault) {
    notifyCategories.push("internal")
  }
  if (settings.notifyEstimatorsByDefault) {
    notifyCategories.push("estimators")
  }
  if (settings.notifyInstallersByDefault) {
    notifyCategories.push("installers")
  }

  if (notifyCategories.length === 0) {
    return []
  }

  return uniqueStrings(
    users
      .filter((user) => notifyCategories.some((category) => userMatchesNotifyCategory(user, category)))
      .map((user) => user.id),
  )
}

function buildDefaultForm(jobId: string, settings: DailyLogSettings, users: UserOption[]): FormValues {
  return {
    jobId,
    logDate: todayString(),
    title: "",
    notes: settings.defaultNotes,
    tags: [],
    tagInput: "",
    shareInternalUsers: settings[dailyLogShareDefaults.shareInternalUsers],
    shareClient: settings[dailyLogShareDefaults.shareClient],
    shareSubsVendors: settings[dailyLogShareDefaults.shareSubsVendors],
    isPrivate: false,
    notifyUserIds: buildDefaultNotifyUserIds(users, settings),
    includeWeather: settings.includeWeatherByDefault,
    includeWeatherNotes: settings.includeWeatherNotesByDefault,
    weatherNotes: "",
    weatherData: null,
    customFieldValues: {},
  }
}

function formFromDetail(log: DailyLogDetail): FormValues {
  return {
    jobId: log.jobId || "",
    logDate: log.logDate,
    title: log.title || "",
    notes: log.notes || "",
    tags: log.tags,
    tagInput: "",
    shareInternalUsers: !!log.shareInternalUsers,
    shareClient: !!log.shareClient,
    shareSubsVendors: !!log.shareSubsVendors,
    isPrivate: !!log.isPrivate,
    notifyUserIds: log.notifyUserIds,
    includeWeather: !!log.includeWeather,
    includeWeatherNotes: !!log.includeWeatherNotes,
    weatherNotes: log.weatherNotes || "",
    weatherData: normalizeWeatherData(log.weatherData),
    customFieldValues: normalizeCustomFieldValues(log.customFieldValues),
  }
}

function buildLocationStamp(job: JobOption | null | undefined) {
  const address = buildAddress(job)
  return address ? `Location: ${address}` : ""
}

function buildPersistedNotes(
  notes: string,
  settings: DailyLogSettings,
  job: JobOption | null,
  includeStamp: boolean,
) {
  const trimmedNotes = notes.trim()

  if (!includeStamp || !settings.stampLocation) {
    return trimmedNotes
  }

  const locationStamp = buildLocationStamp(job)

  if (!locationStamp) {
    return trimmedNotes
  }

  if (trimmedNotes.startsWith(locationStamp)) {
    return trimmedNotes
  }

  return [locationStamp, trimmedNotes].filter(Boolean).join("\n\n")
}

function formatCustomFieldValue(value: CustomFieldScalar) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }

  if (value === null || value === "") {
    return "—"
  }

  return String(value)
}

function filterLogs(logs: DailyLogListItem[], filters: FilterValues) {
  return logs.filter((log) => {
    if (filters.standardFilter === "published" && log.status !== "published") return false
    if (filters.standardFilter === "draft" && log.status !== "draft") return false
    if (filters.standardFilter === "with_attachments" && log.attachmentCount < 1) return false
    if (filters.standardFilter === "weather_included" && !log.includeWeather) return false
    if (filters.tags.length > 0 && !filters.tags.every((tag) => log.tags.includes(tag))) return false
    return true
  })
}

function activeFilterCount(filters: FilterValues) {
  return [
    filters.standardFilter !== "all",
    filters.sharedWith !== "all",
    filters.keywords.trim().length > 0,
    filters.createdBy !== "all",
    filters.datePreset !== "all",
    filters.from,
    filters.to,
    filters.tags.length > 0,
  ].filter(Boolean).length
}

function AvatarLabel({
  name,
  avatarUrl,
  subtitle,
  className,
}: {
  name: string | null | undefined
  avatarUrl?: string | null
  subtitle?: string | null
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Avatar className="size-9 border border-slate-200 bg-slate-50">
        <AvatarImage src={avatarUrl || undefined} alt={name || "User"} />
        <AvatarFallback className="bg-slate-100 text-xs font-semibold text-slate-700">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900">{name || "Unknown user"}</div>
        {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
      </div>
    </div>
  )
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-14 text-center">
      <CloudSun className="mx-auto size-10 text-slate-400" />
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{description}</p>
      {actionLabel && onAction ? (
        <Button className="mt-5" onClick={onAction}>
          <Plus className="size-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

function TagEditor({
  tags,
  input,
  onInputChange,
  onAddTag,
  onRemoveTag,
}: {
  tags: string[]
  input: string
  onInputChange: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-900">Tags</div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onAddTag}>
            Add
          </Button>
          <Button type="button" size="sm" variant="outline">
            Edit
          </Button>
        </div>
      </div>
      {tags.length === 0 ? (
        <div className="text-sm text-slate-500">No tags</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
              {tag}
              <button type="button" onClick={() => onRemoveTag(tag)}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="Type a tag and press Add"
        />
        <Button type="button" variant="outline" onClick={onAddTag}>
          Add
        </Button>
      </div>
    </div>
  )
}

function TeamPicker({
  label,
  tooltip,
  users,
  selectedIds,
  onChange,
}: {
  label: string
  tooltip?: string
  users: UserOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState("")

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return users
    return users.filter((user) => user.fullName.toLowerCase().includes(normalized))
  }, [query, users])

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold text-slate-950">{label}</div>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-slate-400">
                <Info className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search team members" />
      <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
        {filteredUsers.map((user) => (
          <label key={user.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{user.fullName}</div>
              <div className="truncate text-xs capitalize text-slate-500">{user.role.replaceAll("_", " ")}</div>
            </div>
            <Checkbox
              checked={selectedIds.includes(user.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? uniqueStrings([...selectedIds, user.id])
                    : selectedIds.filter((id) => id !== user.id),
                )
              }
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function SettingsDialog({
  open,
  onOpenChange,
  settings,
  customFields,
  onSave,
  saving,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: DailyLogSettings
  customFields: DailyLogCustomField[]
  onSave: (settings: DailyLogSettings, customFields: DailyLogCustomField[]) => Promise<void>
  saving: boolean
}) {
  const [draft, setDraft] = useState(settings)
  const [draftFields, setDraftFields] = useState<DailyLogCustomField[]>(customFields)
  const [showNewFieldForm, setShowNewFieldForm] = useState(false)
  const [newField, setNewField] = useState<DailyLogCustomField>({
    id: "new",
    name: "",
    fieldType: "text",
    options: [],
    displayOrder: 0,
  })
  const [newFieldOptions, setNewFieldOptions] = useState("")

  useEffect(() => {
    if (open) {
      setDraft(settings)
      setDraftFields(customFields)
      setShowNewFieldForm(false)
      setNewField({
        id: "new",
        name: "",
        fieldType: "text",
        options: [],
        displayOrder: customFields.length,
      })
      setNewFieldOptions("")
    }
  }, [customFields, open, settings])

  function updateDraftField(fieldId: string, updater: (field: DailyLogCustomField) => DailyLogCustomField) {
    setDraftFields((current) => current.map((field) => (field.id === fieldId ? updater(field) : field)))
  }

  function appendCustomField() {
    if (!newField.name.trim()) {
      toast.error("Custom field name is required")
      return
    }

    if (newField.fieldType === "dropdown" && newFieldOptions.trim().length === 0) {
      toast.error("Dropdown custom fields require at least one option")
      return
    }

    setDraftFields((current) => [
      ...current,
      {
        ...newField,
        id: `draft-${Date.now()}`,
        name: newField.name.trim(),
        options:
          newField.fieldType === "dropdown"
            ? uniqueStrings(newFieldOptions.split(","))
            : [],
        displayOrder: current.length,
      },
    ])
    setShowNewFieldForm(false)
    setNewField({
      id: "new",
      name: "",
      fieldType: "text",
      options: [],
      displayOrder: draftFields.length + 1,
    })
    setNewFieldOptions("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Daily Log Settings</DialogTitle>
          <DialogDescription>Configure default notes, weather behavior, sharing defaults, and custom fields for daily logs.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-950">Daily Log Setup</div>
              <div className="text-sm text-slate-500">Choose whether new logs stamp the job address and start with a notes template.</div>
            </div>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">Stamp Location</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-slate-400">
                      <Info className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Automatically stamps the job&apos;s address/location on each daily log.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Checkbox
                checked={draft.stampLocation}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, stampLocation: !!checked }))
                }
              />
            </label>
            <div className="space-y-2">
              <Label>Default Daily Log Notes</Label>
              <Textarea
                rows={5}
                value={draft.defaultNotes}
                onChange={(event) => setDraft((current) => ({ ...current, defaultNotes: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-950">Weather</div>
              <div className="text-sm text-slate-500">Control whether new daily logs auto-fetch weather and weather notes by default.</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span className="text-sm text-slate-700">Include Weather Conditions</span>
                <Checkbox
                  checked={draft.includeWeatherByDefault}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, includeWeatherByDefault: !!checked }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span className="text-sm text-slate-700">Include Weather Condition Notes</span>
                <Checkbox
                  checked={draft.includeWeatherNotesByDefault}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, includeWeatherNotesByDefault: !!checked }))
                  }
                />
              </label>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-950">Default Daily Log Share Settings</div>
              <div className="text-sm text-slate-500">Choose which audiences are shared and notified by default for new logs.</div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[minmax(0,1fr)_88px_88px] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                <div>Audience</div>
                <div className="text-center">Share</div>
                <div className="text-center">Notify</div>
              </div>
              {[
                {
                  label: "Internal Users",
                  shareKey: "shareInternalUsersByDefault" as const,
                  notifyKey: "notifyInternalUsersByDefault" as const,
                },
                {
                  label: "Estimators",
                  shareKey: "shareEstimatorsByDefault" as const,
                  notifyKey: "notifyEstimatorsByDefault" as const,
                },
                {
                  label: "Installers",
                  shareKey: "shareInstallersByDefault" as const,
                  notifyKey: "notifyInstallersByDefault" as const,
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center border-t border-slate-200 px-4 py-3 first:border-t-0"
                >
                  <div className="text-sm text-slate-700">{row.label}</div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={draft[row.shareKey]}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({ ...current, [row.shareKey]: !!checked }))
                      }
                    />
                  </div>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={draft[row.notifyKey]}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({ ...current, [row.notifyKey]: !!checked }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-950">Daily Logs Custom Fields</div>
                <div className="text-sm text-slate-500">Add structured fields that appear after the standard fields on create and edit.</div>
              </div>
              <Button type="button" variant="outline" onClick={() => setShowNewFieldForm((current) => !current)}>
                <Plus className="size-4" />
                Custom field
              </Button>
            </div>

            {showNewFieldForm ? (
              <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Field name</Label>
                    <Input
                      value={newField.name}
                      onChange={(event) => setNewField((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Crew on Site"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Field type</Label>
                    <Select
                      value={newField.fieldType}
                      onValueChange={(value) =>
                        setNewField((current) => ({
                          ...current,
                          fieldType: value as DailyLogCustomFieldType,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="dropdown">Dropdown</SelectItem>
                        <SelectItem value="checkbox">Checkbox</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {newField.fieldType === "dropdown" ? (
                  <div className="space-y-2">
                    <Label>Dropdown values</Label>
                    <Input
                      value={newFieldOptions}
                      onChange={(event) => setNewFieldOptions(event.target.value)}
                      placeholder="Ready, Delayed, Waiting on Material"
                    />
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setShowNewFieldForm(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={appendCustomField}>
                    Add Field
                  </Button>
                </div>
              </div>
            ) : null}

            {draftFields.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No custom fields. Custom fields have not been added. Add data to your Daily Logs using custom fields.
              </div>
            ) : (
              <div className="space-y-3">
                {draftFields.map((field) => (
                  <div key={field.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                          value={field.name}
                          onChange={(event) =>
                            updateDraftField(field.id, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={field.fieldType}
                          onValueChange={(value) =>
                            updateDraftField(field.id, (current) => ({
                              ...current,
                              fieldType: value as DailyLogCustomFieldType,
                              options: value === "dropdown" ? current.options : [],
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                            <SelectItem value="dropdown">Dropdown</SelectItem>
                            <SelectItem value="checkbox">Checkbox</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setDraftFields((current) => current.filter((entry) => entry.id !== field.id))}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                    {field.fieldType === "dropdown" ? (
                      <div className="space-y-2">
                        <Label>Dropdown values</Label>
                        <Input
                          value={field.options.join(", ")}
                          onChange={(event) =>
                            updateDraftField(field.id, (current) => ({
                              ...current,
                              options: uniqueStrings(event.target.value.split(",")),
                            }))
                          }
                          placeholder="Option 1, Option 2"
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void onSave(draft, draftFields)}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FilterSheet({
  open,
  onOpenChange,
  filters,
  onApply,
  onClear,
  users,
  availableTags,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: FilterValues
  onApply: (filters: FilterValues) => void
  onClear: () => void
  users: UserOption[]
  availableTags: string[]
}) {
  const [draft, setDraft] = useState(filters)

  useEffect(() => {
    if (open) {
      setDraft(filters)
    }
  }, [open, filters])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto border-slate-200 bg-white">
        <SheetHeader>
          <SheetTitle>Daily Log Filters</SheetTitle>
          <SheetDescription>Refine logs by permissions, keywords, creator, date, and tags.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label>Standard Filter</Label>
            <Select
              value={draft.standardFilter}
              onValueChange={(value) => setDraft((current) => ({ ...current, standardFilter: value as FilterValues["standardFilter"] }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All logs</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="with_attachments">With attachments</SelectItem>
                <SelectItem value="weather_included">Weather included</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Shared with</Label>
            <Select
              value={draft.sharedWith}
              onValueChange={(value) => setDraft((current) => ({ ...current, sharedWith: value as FilterValues["sharedWith"] }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="estimators">Estimators</SelectItem>
                <SelectItem value="installers">Installers</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Keywords</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-slate-400">
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Searches title and notes content</TooltipContent>
              </Tooltip>
            </div>
            <Input
              value={draft.keywords}
              onChange={(event) => setDraft((current) => ({ ...current, keywords: event.target.value }))}
              placeholder="Search title and notes"
            />
          </div>

          <div className="space-y-2">
            <Label>Created by</Label>
            <Select
              value={draft.createdBy}
              onValueChange={(value) => setDraft((current) => ({ ...current, createdBy: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <Select
              value={draft.datePreset}
              onValueChange={(value) => {
                const nextPreset = value as FilterPreset
                const range = getDateRangeForPreset(nextPreset)
                setDraft((current) => ({
                  ...current,
                  datePreset: nextPreset,
                  from: range ? range.from : current.from,
                  to: range ? range.to : current.to,
                }))
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESET_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.datePreset === "custom" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">From</Label>
                  <Input
                    type="date"
                    value={draft.from}
                    onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">To</Label>
                  <Input
                    type="date"
                    value={draft.to}
                    onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
              {availableTags.length === 0 ? (
                <div className="text-sm text-slate-500">No tags found yet.</div>
              ) : (
                availableTags.map((tag) => (
                  <label key={tag} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1">
                    <span className="text-sm text-slate-700">{tag}</span>
                    <Checkbox
                      checked={draft.tags.includes(tag)}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          tags: checked
                            ? uniqueStrings([...current.tags, tag])
                            : current.tags.filter((entry) => entry !== tag),
                        }))
                      }
                    />
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setDraft(DEFAULT_FILTERS)
                onClear()
                onOpenChange(false)
              }}
            >
              Clear all
            </Button>
            <Button
              onClick={() => {
                const range = draft.datePreset === "custom" ? null : getDateRangeForPreset(draft.datePreset)
                onApply({
                  ...draft,
                  from: range ? range.from : draft.from,
                  to: range ? range.to : draft.to,
                })
                onOpenChange(false)
              }}
            >
              Apply filter
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CommentsSheet({
  open,
  onOpenChange,
  log,
  users,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  log: DailyLogDetail | null
  users: UserOption[]
  onChanged: () => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [comments, setComments] = useState<CommentRecord[]>([])
  const [body, setBody] = useState("")
  const [linkValue, setLinkValue] = useState("")
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [formatHint, setFormatHint] = useState(false)
  const [replyTo, setReplyTo] = useState<CommentRecord | null>(null)
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([])
  const [attachments, setAttachments] = useState<CommentDraftAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function loadComments() {
    if (!log) return
    setLoading(true)
    try {
      const response = await api.get<{ comments: CommentRecord[] }>(`/daily-logs/${log.id}/comments`)
      setComments(response.data.comments)
    } catch (error) {
      toast.error(apiError(error, "Failed to load comments"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && log) {
      void loadComments()
    }
    if (!open) {
      setBody("")
      setLinkValue("")
      setShowLinkInput(false)
      setReplyTo(null)
      setSelectedMentionIds([])
      setAttachments([])
      setFormatHint(false)
    }
  }, [open, log?.id])

  const mentionQuery = useMemo(() => {
    const match = body.match(/(^|\s)@([\w-]*)$/)
    return match ? match[2].toLowerCase() : ""
  }, [body])

  const mentionResults = useMemo(() => {
    if (!mentionQuery) return []
    return users.filter((user) => user.fullName.toLowerCase().includes(mentionQuery)).slice(0, 6)
  }, [mentionQuery, users])

  async function fileToDataUrl(file: File) {
    return new Promise<CommentDraftAttachment>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error("Unable to read image."))
      reader.onload = () =>
        resolve({
          name: file.name,
          url: typeof reader.result === "string" ? reader.result : "",
          mimeType: file.type || null,
        })
      reader.readAsDataURL(file)
    })
  }

  async function handleCommentFiles(files: FileList | null) {
    const list = Array.from(files || [])
    if (list.length === 0) return
    try {
      const next = await Promise.all(list.map(fileToDataUrl))
      setAttachments((current) => [...current, ...next.filter((item) => item.url)])
    } catch {
      toast.error("Failed to attach one or more images.")
    }
  }

  function insertMention(user: UserOption) {
    setBody((current) => current.replace(/(^|\s)@([\w-]*)$/, `$1@${user.fullName} `))
    setSelectedMentionIds((current) => uniqueStrings([...current, user.id]))
  }

  async function submitComment() {
    if (!log || (!body.trim() && attachments.length === 0 && !linkValue.trim())) return
    setSending(true)
    try {
      const response = await api.post<{ comments: CommentRecord[] }>(`/daily-logs/${log.id}/comments`, {
        body: body.trim() || "Shared an attachment",
        parentCommentId: replyTo?.id ?? null,
        mentions: selectedMentionIds,
        attachments,
        links: linkValue.trim() ? [linkValue.trim()] : [],
      })
      setComments(response.data.comments)
      setBody("")
      setAttachments([])
      setLinkValue("")
      setShowLinkInput(false)
      setReplyTo(null)
      setSelectedMentionIds([])
      await onChanged()
    } catch (error) {
      toast.error(apiError(error, "Failed to add comment"))
    } finally {
      setSending(false)
    }
  }

  async function toggleReaction(commentId: string, emoji: string) {
    if (!log) return
    try {
      const response = await api.post<{ comments: CommentRecord[] }>(
        `/daily-logs/${log.id}/comments/${commentId}/reactions`,
        { emoji },
      )
      setComments(response.data.comments)
      await onChanged()
    } catch (error) {
      toast.error(apiError(error, "Failed to update reaction"))
    }
  }

  function renderComment(comment: CommentRecord, depth = 0) {
    return (
      <div key={comment.id} className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-4", depth > 0 && "ml-6 bg-slate-50")}>
        <div className="flex items-start justify-between gap-3">
          <AvatarLabel name={comment.author.fullName} avatarUrl={comment.author.avatarUrl} subtitle={formatDateTime(comment.createdAt)} />
          <Button variant="ghost" size="sm" onClick={() => setReplyTo(comment)}>
            Reply
          </Button>
        </div>
        <div className="whitespace-pre-wrap text-sm text-slate-700">{comment.body}</div>
        {comment.links.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {comment.links.map((link) => (
              <a
                key={link}
                href={link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
              >
                <Link2 className="size-3.5" />
                {link}
              </a>
            ))}
          </div>
        ) : null}
        {comment.attachments.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {comment.attachments.map((attachment) => (
              <a
                key={`${comment.id}-${attachment.url}`}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
              >
                {attachment.mimeType?.startsWith("image/") ? (
                  <img src={attachment.url} alt={attachment.name} className="h-36 w-full object-cover" />
                ) : (
                  <div className="flex h-36 items-center justify-center text-slate-400">
                    <FileText className="size-8" />
                  </div>
                )}
                <div className="truncate border-t border-slate-200 px-3 py-2 text-xs text-slate-600">{attachment.name}</div>
              </a>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(comment.reactions).map(([emoji, userIds]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => void toggleReaction(comment.id, emoji)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                userIds.length > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-600",
              )}
            >
              <span>{emoji}</span>
              <span>{userIds.length}</span>
            </button>
          ))}
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={`${comment.id}-${emoji}`}
              type="button"
              onClick={() => void toggleReaction(comment.id, emoji)}
              className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-slate-300"
            >
              {emoji}
            </button>
          ))}
        </div>
        {comment.replies.length > 0 ? comment.replies.map((reply) => renderComment(reply, depth + 1)) : null}
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full max-w-xl flex-col overflow-hidden border-slate-200 bg-white">
        <SheetHeader className="border-b border-slate-200 pb-4">
          <SheetTitle>Comments</SheetTitle>
          <SheetDescription>Internal</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto py-5">
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)
          ) : comments.length === 0 ? (
            <EmptyState title="No comments yet" description="Start the discussion for this daily log." />
          ) : (
            comments.map((comment) => renderComment(comment))
          )}
        </div>

        <div className="border-t border-slate-200 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Smile className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {COMMENT_EMOJIS.map((emoji) => (
                    <DropdownMenuItem key={emoji} onClick={() => setBody((current) => `${current}${emoji}`)}>
                      {emoji}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" onClick={() => setShowLinkInput((current) => !current)}>
                <Link2 className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFormatHint((current) => !current)}>
                Aa
              </Button>
            </div>
            {replyTo ? (
              <button type="button" className="text-xs text-blue-600" onClick={() => setReplyTo(null)}>
                Replying to {replyTo.author.fullName || "comment"} · Cancel
              </button>
            ) : null}
          </div>

          {showLinkInput ? (
            <Input
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder="Paste a URL"
              className="mb-3"
            />
          ) : null}
          {formatHint ? (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Plain text comments are supported. Use line breaks and attachments for field updates.
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div key={attachment.url} className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                  <Paperclip className="size-3.5" />
                  <span className="max-w-[180px] truncate">{attachment.name}</span>
                  <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.url !== attachment.url))}>
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleCommentFiles(event.target.files)
              event.target.value = ""
            }}
          />

          <div className="relative">
            <Textarea
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Add a comment"
            />
            {mentionResults.length > 0 ? (
              <div className="absolute bottom-full left-0 mb-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {mentionResults.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
                    onClick={() => insertMention(user)}
                  >
                    <Avatar className="size-8 border border-slate-200">
                      <AvatarImage src={user.avatarUrl || undefined} />
                      <AvatarFallback className="bg-slate-100 text-[10px] font-semibold text-slate-700">
                        {getInitials(user.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-sm font-medium text-slate-900">{user.fullName}</div>
                      <div className="text-xs capitalize text-slate-500">{user.role.replaceAll("_", " ")}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex justify-end">
            <Button onClick={() => void submitComment()} disabled={sending}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DailyLogDialog({
  open,
  onOpenChange,
  jobId,
  jobs,
  users,
  settings,
  customFields,
  logId,
  onSaved,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  jobs: JobOption[]
  users: UserOption[]
  settings: DailyLogSettings
  customFields: DailyLogCustomField[]
  logId: string | null
  onSaved: (logId: string) => Promise<void>
  onDeleted: () => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherMessage, setWeatherMessage] = useState("")
  const [values, setValues] = useState<FormValues>(buildDefaultForm(jobId, settings, users))
  const [currentLog, setCurrentLog] = useState<DailyLogDetail | null>(null)
  const [existingAttachments, setExistingAttachments] = useState<DailyLogAttachment[]>([])
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === values.jobId) || jobs.find((job) => job.id === jobId) || null,
    [jobs, jobId, values.jobId],
  )
  const locationStampPreview = useMemo(() => buildLocationStamp(selectedJob), [selectedJob])

  async function loadLog(nextLogId: string) {
    const response = await api.get<{ log: DailyLogDetail }>(`/daily-logs/${nextLogId}`)
    const normalized = {
      ...response.data.log,
      weatherData: normalizeWeatherData(response.data.log.weatherData),
      customFieldValues: normalizeCustomFieldValues(response.data.log.customFieldValues),
    }
    setCurrentLog(normalized)
    setValues(formFromDetail(normalized))
    setExistingAttachments(normalized.attachments)
    setRemovedAttachmentIds([])
    setPendingFiles([])
  }

  useEffect(() => {
    if (!open) return

    if (!logId) {
      setCurrentLog(null)
      setValues(buildDefaultForm(jobId, settings, users))
      setExistingAttachments([])
      setRemovedAttachmentIds([])
      setPendingFiles([])
      setWeatherMessage("")
      return
    }

    setLoading(true)
    void loadLog(logId)
      .catch((error) => toast.error(apiError(error, "Failed to load daily log")))
      .finally(() => setLoading(false))
  }, [open, logId, jobId, settings, users])

  useEffect(() => {
    if (!open || !values.includeWeather || !selectedJob) return

    if (
      currentLog &&
      values.weatherData &&
      values.jobId === (currentLog.jobId || "") &&
      values.logDate === currentLog.logDate
    ) {
      return
    }

    const address = buildAddress(selectedJob)
    if (!address) {
      setWeatherMessage("Add a job address to auto-fetch weather conditions")
      setValues((current) => ({ ...current, weatherData: null }))
      return
    }

    setWeatherLoading(true)
    setWeatherMessage("")

    const timeout = window.setTimeout(() => {
      void api
        .get<{ weather: WeatherSnapshot }>("/weather", {
          params: {
            address,
            date: values.logDate,
          },
        })
        .then((response) => {
          setValues((current) => ({
            ...current,
            weatherData: normalizeWeatherData(response.data.weather),
          }))
        })
        .catch((error) => {
          setValues((current) => ({ ...current, weatherData: null }))
          setWeatherMessage(apiError(error, "Weather unavailable right now"))
        })
        .finally(() => setWeatherLoading(false))
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [open, values.includeWeather, values.logDate, values.jobId, selectedJob?.streetAddress, selectedJob?.city, selectedJob?.state, selectedJob?.zipCode])

  const onDrop = useDropzone({
    onDrop: (files) => setPendingFiles((current) => [...current, ...files]),
    noClick: true,
    noKeyboard: true,
  })

  async function uploadPendingFiles(targetLogId: string) {
    if (pendingFiles.length === 0) return
    const formData = new FormData()
    pendingFiles.forEach((file) => formData.append("files", file))
    await api.post(`/daily-logs/${targetLogId}/attachments`, formData)
  }

  async function deleteRemovedFiles(targetLogId: string) {
    if (removedAttachmentIds.length === 0) return
    for (const attachmentId of removedAttachmentIds) {
      await api.delete(`/daily-logs/${targetLogId}/attachments/${attachmentId}`)
    }
  }

  async function persist(publishAfterCreate: boolean) {
    setSaving(true)
    try {
      const payload = {
        jobId: values.jobId,
        logDate: values.logDate,
        title: values.title || null,
        notes: buildPersistedNotes(values.notes, settings, selectedJob, !currentLog),
        weatherData: values.includeWeather ? values.weatherData : null,
        includeWeather: values.includeWeather,
        includeWeatherNotes: values.includeWeatherNotes,
        weatherNotes: values.includeWeatherNotes ? values.weatherNotes || null : null,
        customFieldValues: values.customFieldValues,
        shareInternalUsers: values.shareInternalUsers,
        shareClient: values.shareClient,
        shareSubsVendors: values.shareSubsVendors,
        isPrivate: values.isPrivate,
        notifyUserIds: values.notifyUserIds,
        tags: values.tags,
      }

      const response = currentLog
        ? await api.put<{ log: DailyLogDetail }>(`/daily-logs/${currentLog.id}`, payload)
        : await api.post<{ log: DailyLogDetail }>(`/jobs/${values.jobId}/daily-logs`, payload)

      const savedId = response.data.log.id
      await uploadPendingFiles(savedId)
      await deleteRemovedFiles(savedId)
      if (!currentLog && publishAfterCreate) {
        await api.post(`/daily-logs/${savedId}/publish`)
      }
      toast.success(currentLog ? "Daily log saved" : "Daily log published")
      await onSaved(savedId)
      onOpenChange(false)
    } catch (error) {
      toast.error(apiError(error, currentLog ? "Failed to save daily log" : "Failed to publish daily log"))
    } finally {
      setSaving(false)
    }
  }

  async function deleteLog() {
    if (!currentLog) return
    setDeleting(true)
    try {
      await api.delete(`/daily-logs/${currentLog.id}`)
      toast.success("Daily log deleted")
      onOpenChange(false)
      await onDeleted()
    } catch (error) {
      toast.error(apiError(error, "Failed to delete daily log"))
    } finally {
      setDeleting(false)
    }
  }

  const combinedAttachments = [
    ...existingAttachments
      .filter((attachment) => !removedAttachmentIds.includes(attachment.id))
      .map((attachment) => ({
        key: attachment.id,
        name: attachment.originalName,
        existing: true,
        mimeType: attachment.mimeType,
      })),
    ...pendingFiles.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      existing: false,
      mimeType: file.type || null,
    })),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-[1080px] overflow-y-auto border-slate-200 bg-white">
        <DialogHeader>
          <DialogTitle>{currentLog ? "Edit Daily Log" : "Create Daily Log"}</DialogTitle>
          <DialogDescription>Capture the day’s notes, weather, attachments, permissions, and notifications.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
            <Skeleton className="h-[620px] rounded-2xl" />
            <Skeleton className="h-[620px] rounded-2xl" />
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-4 text-sm font-semibold text-slate-950">Daily Log Information</div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Job</Label>
                      <Select value={values.jobId} onValueChange={(value) => setValues((current) => ({ ...current, jobId: value }))}>
                        <SelectTrigger>
                          <SelectValue />
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
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={values.logDate}
                        onChange={(event) => setValues((current) => ({ ...current, logDate: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        value={values.title}
                        onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
                        placeholder="Kitchen Counter Install"
                      />
                    </div>
                    <TagEditor
                      tags={values.tags}
                      input={values.tagInput}
                      onInputChange={(value) => setValues((current) => ({ ...current, tagInput: value }))}
                      onAddTag={() => {
                        const nextTag = values.tagInput.trim()
                        if (!nextTag) return
                        setValues((current) => ({
                          ...current,
                          tags: uniqueStrings([...current.tags, nextTag]),
                          tagInput: "",
                        }))
                      }}
                      onRemoveTag={(tag) =>
                        setValues((current) => ({
                          ...current,
                          tags: current.tags.filter((entry) => entry !== tag),
                        }))
                      }
                    />

                    {customFields.length > 0 ? (
                      <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                        <div className="text-sm font-medium text-slate-900">Custom Fields</div>
                        <div className="space-y-3">
                          {customFields.map((field) => {
                            const currentValue = values.customFieldValues[field.id]

                            return (
                              <div key={field.id} className="space-y-2">
                                <Label>{field.name}</Label>
                                {field.fieldType === "text" ? (
                                  <Input
                                    value={typeof currentValue === "string" ? currentValue : ""}
                                    onChange={(event) =>
                                      setValues((current) => ({
                                        ...current,
                                        customFieldValues: {
                                          ...current.customFieldValues,
                                          [field.id]: event.target.value,
                                        },
                                      }))
                                    }
                                  />
                                ) : null}
                                {field.fieldType === "number" ? (
                                  <Input
                                    type="number"
                                    value={typeof currentValue === "number" ? String(currentValue) : ""}
                                    onChange={(event) =>
                                      setValues((current) => ({
                                        ...current,
                                        customFieldValues: {
                                          ...current.customFieldValues,
                                          [field.id]:
                                            event.target.value === ""
                                              ? null
                                              : Number(event.target.value),
                                        },
                                      }))
                                    }
                                  />
                                ) : null}
                                {field.fieldType === "date" ? (
                                  <Input
                                    type="date"
                                    value={typeof currentValue === "string" ? currentValue : ""}
                                    onChange={(event) =>
                                      setValues((current) => ({
                                        ...current,
                                        customFieldValues: {
                                          ...current.customFieldValues,
                                          [field.id]: event.target.value || null,
                                        },
                                      }))
                                    }
                                  />
                                ) : null}
                                {field.fieldType === "dropdown" ? (
                                  <Select
                                    value={typeof currentValue === "string" ? currentValue : ""}
                                    onValueChange={(value) =>
                                      setValues((current) => ({
                                        ...current,
                                        customFieldValues: {
                                          ...current.customFieldValues,
                                          [field.id]: value,
                                        },
                                      }))
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select a value" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {field.options.map((option) => (
                                        <SelectItem key={option} value={option}>
                                          {option}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : null}
                                {field.fieldType === "checkbox" ? (
                                  <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3">
                                    <span className="text-sm text-slate-700">{field.name}</span>
                                    <Checkbox
                                      checked={currentValue === true}
                                      onCheckedChange={(checked) =>
                                        setValues((current) => ({
                                          ...current,
                                          customFieldValues: {
                                            ...current.customFieldValues,
                                            [field.id]: !!checked,
                                          },
                                        }))
                                      }
                                    />
                                  </label>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-1 text-sm font-semibold text-slate-950">Permissions</div>
                  <div className="mb-4 text-sm text-slate-500">Share</div>
                  <div className="space-y-3">
                    {dailyLogShareLabels.map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3">
                        <span className="text-sm text-slate-700">{label}</span>
                        <Checkbox
                          checked={values[key]}
                          onCheckedChange={(checked) =>
                            setValues((current) => ({
                              ...current,
                              [key]: !!checked,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <TeamPicker
                  label="Notify Users"
                  tooltip="Selected users will be notified when this log is published"
                  users={users}
                  selectedIds={values.notifyUserIds}
                  onChange={(notifyUserIds) => setValues((current) => ({ ...current, notifyUserIds }))}
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">Attachments</div>
                      <div className="text-sm text-slate-500">Upload documents or photos, or drop files anywhere in this section.</div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const file = new File([""], `Daily Log ${values.logDate}.txt`, { type: "text/plain" })
                          setPendingFiles((current) => [...current, file])
                        }}
                      >
                        Create new doc
                      </Button>
                      <Button type="button" variant="outline" onClick={() => onDrop.open()}>
                        Add
                      </Button>
                    </div>
                  </div>
                  <div
                    {...onDrop.getRootProps()}
                    className={cn(
                      "rounded-2xl border border-dashed px-4 py-6 text-center",
                      onDrop.isDragActive ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50",
                    )}
                  >
                    <input {...onDrop.getInputProps()} />
                    <Paperclip className="mx-auto size-5 text-slate-400" />
                    <div className="mt-2 text-sm text-slate-600">Drag and drop files here, or use Add.</div>
                  </div>
                  <div className="space-y-2">
                    {combinedAttachments.length === 0 ? (
                      <div className="text-sm text-slate-500">No attachments yet.</div>
                    ) : (
                      combinedAttachments.map((attachment) => (
                        <div key={attachment.key} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <FileText className="size-4 text-slate-400" />
                            <div className="truncate text-sm text-slate-700">{attachment.name}</div>
                          </div>
                          <button
                            type="button"
                            className="text-slate-400 hover:text-red-600"
                            onClick={() => {
                              if (attachment.existing) {
                                setRemovedAttachmentIds((current) => uniqueStrings([...current, attachment.key]))
                              } else {
                                setPendingFiles((current) =>
                                  current.filter(
                                    (file) => `${file.name}-${file.size}-${file.lastModified}` !== attachment.key,
                                  ),
                                )
                              }
                            }}
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-2 rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-950">Notes</div>
                  {!currentLog && settings.stampLocation && locationStampPreview ? (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                      Location stamp will be added on publish: <span className="font-medium">{locationStampPreview}</span>
                    </div>
                  ) : null}
                  <Textarea
                    rows={8}
                    value={values.notes}
                    onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Describe what happened on site today."
                  />
                </div>

                <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-950">Weather</div>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                    <div>
                      <div className="font-medium text-slate-900">Include Weather Conditions</div>
                      <div className="text-sm text-slate-500">Auto-populates weather data for the selected job and date.</div>
                    </div>
                    <Checkbox
                      checked={values.includeWeather}
                      onCheckedChange={(checked) =>
                        setValues((current) => ({
                          ...current,
                          includeWeather: !!checked,
                          weatherData: checked ? current.weatherData : null,
                        }))
                      }
                    />
                  </label>

                  {!values.includeWeather ? null : weatherLoading ? (
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      <Loader2 className="size-4 animate-spin text-blue-600" />
                      Fetching weather conditions…
                    </div>
                  ) : values.weatherData ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <div className="mb-4 flex items-center gap-3 text-amber-800">
                        {getWeatherIcon(deriveWeatherIcon(values.weatherData), "size-6")}
                        <div>
                          <div className="font-semibold">{values.weatherData.condition}</div>
                          <div className="text-xs text-amber-700">{formatDateTime(values.weatherData.fetchedAt)}</div>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="text-sm text-slate-700">High: <span className="font-semibold">{values.weatherData.temperatureHigh ?? "—"}°F</span></div>
                        <div className="text-sm text-slate-700">Low: <span className="font-semibold">{values.weatherData.temperatureLow ?? "—"}°F</span></div>
                        <div className="text-sm text-slate-700">Wind: <span className="font-semibold">{values.weatherData.windMph ?? "—"} mph</span></div>
                        <div className="text-sm text-slate-700">Humidity: <span className="font-semibold">{values.weatherData.humidity ?? "—"}%</span></div>
                        <div className="text-sm text-slate-700 sm:col-span-2">
                          Total Precip: <span className="font-semibold">{values.weatherData.precipitation ?? 0}"</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      {weatherMessage || "Weather data is unavailable for this log."}
                    </div>
                  )}

                  <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                    <div>
                      <div className="font-medium text-slate-900">Include Weather Notes</div>
                      <div className="text-sm text-slate-500">Capture any manual notes about weather conditions.</div>
                    </div>
                    <Checkbox
                      checked={values.includeWeatherNotes}
                      onCheckedChange={(checked) =>
                        setValues((current) => ({ ...current, includeWeatherNotes: !!checked }))
                      }
                    />
                  </label>
                  {values.includeWeatherNotes ? (
                    <Textarea
                      rows={3}
                      value={values.weatherNotes}
                      onChange={(event) => setValues((current) => ({ ...current, weatherNotes: event.target.value }))}
                      placeholder="Weather notes"
                    />
                  ) : null}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-2 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">
                {currentLog ? "Save updates to keep this daily log current." : "Publish creates and publishes the log immediately."}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {currentLog ? (
                  <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => void deleteLog()} disabled={deleting || saving}>
                    {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
                    Delete
                  </Button>
                ) : null}
                <Button onClick={() => void persist(!currentLog)} disabled={saving || deleting}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {currentLog ? "Save" : "Publish"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function JobDailyLogsPage() {
  const { job, jobId } = useOutletContext<JobContext>()
  const currentUser = useAuthStore((state) => state.user)
  const [settings, setSettings] = useState<DailyLogSettings>(DEFAULT_SETTINGS)
  const [customFields, setCustomFields] = useState<DailyLogCustomField[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [logs, setLogs] = useState<DailyLogListItem[]>([])
  const [selectedLog, setSelectedLog] = useState<DailyLogDetail | null>(null)
  const [editingLogId, setEditingLogId] = useState<string | null>(null)
  const [searchValue, setSearchValue] = useState("")
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>(DEFAULT_FILTERS)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const availableTags = useMemo(
    () => uniqueStrings(logs.flatMap((log) => log.tags)).sort((a, b) => a.localeCompare(b)),
    [logs],
  )

  const filteredLogs = useMemo(() => filterLogs(logs, appliedFilters), [logs, appliedFilters])
  const selectedLogCustomFields = useMemo(() => {
    if (!selectedLog) {
      return []
    }

    return customFields
      .map((field) => ({
        field,
        value: selectedLog.customFieldValues[field.id],
      }))
      .filter(
        (entry) =>
          entry.value !== null &&
          entry.value !== undefined &&
          !(typeof entry.value === "string" && entry.value.trim() === ""),
      )
  }, [customFields, selectedLog])
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE))
  const pagedLogs = useMemo(
    () => filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredLogs, page],
  )

  async function loadReferenceData() {
    try {
      const [usersResponse, jobsResponse, settingsResponse, customFieldsResponse] = await Promise.all([
        api.get<{ users: UserOption[] }>("/users"),
        api.get<{ jobs: JobOption[] }>("/jobs", {
          params: {
            page: 1,
            pageSize: 100,
          },
        }),
        api.get<{ settings: DailyLogSettings }>("/daily-logs/settings"),
        api.get<{ fields: DailyLogCustomField[] }>("/daily-logs/custom-fields"),
      ])
      setUsers(usersResponse.data.users)
      setJobs(jobsResponse.data.jobs ?? [])
      setSettings(normalizeDailyLogSettings(settingsResponse.data.settings))
      setCustomFields(normalizeDailyLogCustomFields(customFieldsResponse.data.fields))
    } catch (error) {
      toast.error(apiError(error, "Failed to load daily log settings, jobs, or team members"))
    }
  }

  async function handleSaveSettings(nextSettings: DailyLogSettings, nextCustomFields: DailyLogCustomField[]) {
    setSettingsSaving(true)

    try {
      const normalizedSettings = normalizeDailyLogSettings(nextSettings)
      const normalizedFields = nextCustomFields
        .map((field, index) => ({
          ...field,
          name: field.name.trim(),
          options: field.fieldType === "dropdown" ? uniqueStrings(field.options) : [],
          displayOrder: index,
        }))
        .filter((field) => field.name.length > 0)

      const currentFieldsById = new Map(customFields.map((field) => [field.id, field]))
      const nextFieldIds = new Set(normalizedFields.filter((field) => !field.id.startsWith("draft-")).map((field) => field.id))

      await api.put("/daily-logs/settings", normalizedSettings)

      for (const field of customFields) {
        if (!nextFieldIds.has(field.id)) {
          await api.delete(`/daily-logs/custom-fields/${field.id}`)
        }
      }

      for (const field of normalizedFields) {
        const payload = {
          name: field.name,
          fieldType: field.fieldType,
          options: field.options,
          displayOrder: field.displayOrder,
        }

        if (field.id.startsWith("draft-")) {
          await api.post("/daily-logs/custom-fields", payload)
          continue
        }

        const existing = currentFieldsById.get(field.id)
        if (!existing) {
          continue
        }

        const existingOptions = existing.fieldType === "dropdown" ? uniqueStrings(existing.options) : []
        if (
          existing.name !== field.name ||
          existing.fieldType !== field.fieldType ||
          existing.displayOrder !== field.displayOrder ||
          existingOptions.join("|") !== payload.options.join("|")
        ) {
          await api.put(`/daily-logs/custom-fields/${field.id}`, payload)
        }
      }

      setSettings(normalizedSettings)
      setCustomFields(normalizedFields)
      await loadReferenceData()
      setSettingsOpen(false)
      toast.success("Daily log settings saved")
    } catch (error) {
      toast.error(apiError(error, "Failed to save daily log settings"))
    } finally {
      setSettingsSaving(false)
    }
  }

  async function loadLogs() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "200",
      })
      if (appliedFilters.keywords.trim()) params.set("keywords", appliedFilters.keywords.trim())
      if (appliedFilters.createdBy !== "all") params.set("createdBy", appliedFilters.createdBy)
      if (appliedFilters.sharedWith !== "all") params.set("sharedWith", appliedFilters.sharedWith)
      if (appliedFilters.from) params.set("from", appliedFilters.from)
      if (appliedFilters.to) params.set("to", appliedFilters.to)
      if (appliedFilters.tags.length > 0) params.set("tags", appliedFilters.tags.join(","))

      const response = await api.get<{ logs: DailyLogListItem[] }>(`/jobs/${jobId}/daily-logs?${params.toString()}`)
      setLogs(
        (response.data.logs || []).map((log) => ({
          ...log,
          weatherData: normalizeWeatherData(log.weatherData),
          customFieldValues: normalizeCustomFieldValues(log.customFieldValues),
        })),
      )
    } catch (error) {
      toast.error(apiError(error, "Failed to load daily logs"))
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(logId: string) {
    setDetailLoading(true)
    try {
      const response = await api.get<{ log: DailyLogDetail }>(`/daily-logs/${logId}`)
      setSelectedLog({
        ...response.data.log,
        weatherData: normalizeWeatherData(response.data.log.weatherData),
        customFieldValues: normalizeCustomFieldValues(response.data.log.customFieldValues),
      })
    } catch (error) {
      toast.error(apiError(error, "Failed to load daily log"))
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshAll(preserveDetailId?: string | null) {
    await loadLogs()
    if (preserveDetailId) {
      await loadDetail(preserveDetailId)
    }
  }

  useEffect(() => {
    void loadReferenceData()
  }, [])

  useEffect(() => {
    setPage(1)
    void loadLogs()
  }, [jobId, appliedFilters])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  function openCreateDialog() {
    setEditingLogId(null)
    setDialogOpen(true)
  }

  function openEditDialog(logId: string) {
    setEditingLogId(logId)
    setDialogOpen(true)
  }

  async function handleToggleLike() {
    if (!selectedLog) return
    try {
      await api.post(`/daily-logs/${selectedLog.id}/like`)
      await refreshAll(selectedLog.id)
    } catch (error) {
      toast.error(apiError(error, "Failed to update like"))
    }
  }

  async function handleAddTodo(title: string) {
    if (!selectedLog || !title.trim()) return
    try {
      await api.post(`/daily-logs/${selectedLog.id}/todos`, { title: title.trim() })
      await refreshAll(selectedLog.id)
    } catch (error) {
      toast.error(apiError(error, "Failed to add to-do"))
    }
  }

  async function handleToggleTodo(todo: DailyLogTodo) {
    if (!selectedLog) return
    try {
      await api.post(`/daily-logs/${selectedLog.id}/todos/${todo.id}/toggle`, {
        isComplete: !todo.isComplete,
      })
      await refreshAll(selectedLog.id)
    } catch (error) {
      toast.error(apiError(error, "Failed to update to-do"))
    }
  }

  const startItem = filteredLogs.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const endItem = Math.min(page * PAGE_SIZE, filteredLogs.length)

  function runPrint(scope: "list" | "detail") {
    const cleanup = () => {
      delete document.body.dataset.printPage
      delete document.body.dataset.printScope
    }

    document.body.dataset.printPage = "daily-logs"
    document.body.dataset.printScope = scope
    window.addEventListener("afterprint", cleanup, { once: true })
    window.print()
    window.setTimeout(cleanup, 1000)
  }

  async function handlePrintDetail(logId: string) {
    if (!selectedLog || selectedLog.id !== logId) {
      await loadDetail(logId)
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => runPrint("detail"))
    })
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-5" data-print-root="daily-logs">
        <div className="hidden rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm" data-print-only="true">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{job?.title || "Project"}</div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Daily Logs</h1>
          {selectedLog ? (
            <div className="mt-2 text-sm text-slate-500">{titleForLog(selectedLog.logDate, selectedLog.title)}</div>
          ) : null}
        </div>

        <div data-print-hide="true" className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{job?.title || "Project"}</div>
            <h1 className="text-2xl font-semibold text-slate-950">Daily Logs</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => runPrint("list")}>
              <Printer className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFilterOpen(true)}>
              <Filter className="size-4" />
              {activeFilterCount(appliedFilters) > 0 ? (
                <Badge variant="outline" className="ml-1 border-blue-200 bg-blue-50 text-blue-700">
                  {activeFilterCount(appliedFilters)}
                </Badge>
              ) : null}
            </Button>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="size-4" />
              Daily Log
            </Button>
          </div>
        </div>

        {!selectedLog ? (
          <div data-print-list-only="true">
            <div data-print-hide="true" className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchValue}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setSearchValue(nextValue)
                  if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
                  searchDebounceRef.current = setTimeout(() => {
                    setAppliedFilters((current) => ({ ...current, keywords: nextValue }))
                  }, 250)
                }}
                placeholder="Search logs"
                className="pl-9"
              />
            </div>

            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-48 rounded-2xl" />
                ))}
              </div>
            ) : pagedLogs.length === 0 ? (
              <EmptyState
                title="No daily logs yet"
                description="Create a daily log to capture site progress, observations, and weather conditions."
                actionLabel="Daily Log"
                onAction={openCreateDialog}
              />
            ) : (
              <>
                <div className="space-y-4">
                  {pagedLogs.map((log) => (
                    <div key={log.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              className="min-w-0 text-left"
                              onClick={() => void loadDetail(log.id)}
                            >
                              <div className="truncate text-lg font-semibold text-slate-950 hover:text-blue-700">
                                {titleForLog(log.logDate, log.title)}
                              </div>
                            </button>
                            <div data-print-hide="true" className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => void handlePrintDetail(log.id)}>
                                <Printer className="size-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openEditDialog(log.id)}>
                                <Pencil className="size-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <AvatarLabel name={log.createdByName} className="mr-1" />
                            <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-slate-700">
                              <Users className="size-3.5" />
                              {log.visibilityLabel || "Internal"}
                            </Badge>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-500">
                            <div className="inline-flex items-center gap-1.5">
                              <Heart className="size-4" />
                              {log.likesCount}
                            </div>
                            <div className="inline-flex items-center gap-1.5">
                              <MessageSquare className="size-4" />
                              {log.commentsCount}
                            </div>
                            <div className="inline-flex items-center gap-1.5">
                              <FileText className="size-4" />
                              {log.attachmentCount}
                            </div>
                          </div>

                          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 line-clamp-2">{truncateText(log.notes, 220)}</p>
                        </div>

                        <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                          {getWeatherIcon(deriveWeatherIcon(log.weatherData), "size-5")}
                          <div className="text-sm font-medium">
                            {(log.weatherData?.temperatureHigh ?? "—")}°F↑ {(log.weatherData?.temperatureLow ?? "—")}°F↓
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div data-print-hide="true" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                  <div className="text-sm text-slate-500">
                    {startItem}–{endItem} of {filteredLogs.length} items
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div data-print-detail-only="true" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <button data-print-hide="true" type="button" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800" onClick={() => setSelectedLog(null)}>
                  <ChevronLeft className="size-4" />
                  <span>{job?.title || "Project"} / Daily Logs</span>
                </button>
                {detailLoading ? (
                  <div className="mt-5 space-y-4">
                    <Skeleton className="h-8 w-2/3" />
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-3">
                        <h2 className="text-2xl font-semibold text-slate-950">{titleForLog(selectedLog.logDate, selectedLog.title)}</h2>
                        <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-slate-700">
                          <Users className="size-3.5" />
                          {selectedLog.visibilityLabel || "Internal"}
                        </Badge>
                      </div>
                      <div data-print-hide="true" className="flex items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => runPrint("detail")}>
                              <Printer className="size-4" />
                              Print
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={async () => {
                                try {
                                  await api.delete(`/daily-logs/${selectedLog.id}`)
                                  toast.success("Daily log deleted")
                                  setSelectedLog(null)
                                  await loadLogs()
                                } catch (error) {
                                  toast.error(apiError(error, "Failed to delete daily log"))
                                }
                              }}
                            >
                              <X className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="outline" size="sm" onClick={() => setCommentsOpen(true)}>
                          <MessageSquare className="size-4" />
                          {selectedLog.commentsCount}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(selectedLog.id)}>
                          <Pencil className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <button
                        data-print-hide="true"
                        type="button"
                        onClick={() => void handleToggleLike()}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium",
                          selectedLog.likedByCurrentUser
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-slate-200 text-slate-700",
                        )}
                      >
                        <Heart className={cn("size-4", selectedLog.likedByCurrentUser && "fill-current")} />
                        {selectedLog.likesCount}
                      </button>
                      <AvatarLabel name={selectedLog.createdByName} subtitle={formatDateTime(selectedLog.createdAt)} />
                    </div>

                    <div className="mt-8 space-y-3">
                      <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Notes</div>
                      <div className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-7 text-slate-700">
                        {selectedLog.notes || "No notes entered for this log."}
                      </div>
                    </div>

                    {selectedLogCustomFields.length > 0 ? (
                      <div className="mt-8 space-y-3">
                        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Custom Fields</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {selectedLogCustomFields.map(({ field, value }) => (
                            <div key={field.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">{field.name}</div>
                              <div className="mt-2 text-sm font-medium text-slate-800">{formatCustomFieldValue(value)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selectedLog.attachments.length > 0 ? (
                      <div className="mt-8 space-y-3">
                        <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Attachments</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {selectedLog.attachments.map((attachment) => (
                            <a
                              key={attachment.id}
                              href={attachment.fileId ? `/api/files/${attachment.fileId}/download` : attachment.fileUrl || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-300"
                            >
                              <div className="flex items-center gap-3">
                                <FileText className="size-5 text-slate-400" />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-slate-900">{attachment.originalName}</div>
                                  <div className="text-xs text-slate-500">{attachment.uploadedByName || "Unknown"} · {formatDateTime(attachment.createdAt)}</div>
                                </div>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 text-amber-800">
                    {getWeatherIcon(deriveWeatherIcon(selectedLog.weatherData), "size-10")}
                    <div>
                      <div className="text-3xl font-semibold">{selectedLog.weatherData?.temperatureHigh ?? "—"}°</div>
                      <div className="text-sm text-amber-700">{selectedLog.weatherData?.temperatureLow ?? "—"}° low</div>
                    </div>
                  </div>
                  <Info className="size-4 text-amber-700" />
                </div>
                <div className="mt-4 space-y-1 text-sm text-amber-900">
                  <div>Condition: <span className="font-medium">{selectedLog.weatherData?.condition || "Unavailable"}</span></div>
                  <div>Wind: <span className="font-medium">{selectedLog.weatherData?.windMph ?? "—"} mph</span></div>
                  <div>Humidity: <span className="font-medium">{selectedLog.weatherData?.humidity ?? "—"}%</span></div>
                  <div>Total precipitation: <span className="font-medium">{selectedLog.weatherData?.precipitation ?? 0}"</span></div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-950">To-Do&apos;s</div>
                    <div className="text-sm text-slate-500">Linked action items based on today&apos;s updates.</div>
                  </div>
                  <AddTodoButton onAdd={handleAddTodo} />
                </div>
                {selectedLog.todos.length === 0 ? (
                  <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    <FileText className="mx-auto mb-2 size-6 text-slate-400" />
                    Add To-Do&apos;s quickly based on today&apos;s updates
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {selectedLog.todos.map((todo) => (
                      <label key={todo.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3">
                        <Checkbox checked={!!todo.isComplete} onCheckedChange={() => void handleToggleTodo(todo)} />
                        <div className="min-w-0">
                          <div className={cn("text-sm font-medium text-slate-900", todo.isComplete && "line-through text-slate-400")}>{todo.title}</div>
                          <div className="text-xs text-slate-500">{todo.createdByName || "Unknown"} · {formatDateTime(todo.createdAt)}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        customFields={customFields}
        saving={settingsSaving}
        onSave={handleSaveSettings}
      />

      <FilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filters={appliedFilters}
        onApply={(filters) => {
          setAppliedFilters(filters)
          setSearchValue(filters.keywords)
          setPage(1)
        }}
        onClear={() => {
          setAppliedFilters(DEFAULT_FILTERS)
          setSearchValue("")
          setPage(1)
        }}
        users={users}
        availableTags={availableTags}
      />

      <DailyLogDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        jobId={jobId}
        jobs={jobs.length > 0 ? jobs : job ? [job] : []}
        users={users}
        settings={settings}
        customFields={customFields}
        logId={editingLogId}
        onSaved={async (savedLogId) => {
          await refreshAll(savedLogId)
          setEditingLogId(null)
        }}
        onDeleted={async () => {
          setEditingLogId(null)
          if (selectedLog?.id === editingLogId) {
            setSelectedLog(null)
          }
          await loadLogs()
        }}
      />

      <CommentsSheet
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        log={selectedLog}
        users={users}
        onChanged={async () => {
          if (selectedLog) {
            await refreshAll(selectedLog.id)
          } else {
            await loadLogs()
          }
        }}
      />
    </TooltipProvider>
  )
}

function AddTodoButton({ onAdd }: { onAdd: (title: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")

  return open ? (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Add to-do"
        className="h-9 w-44"
      />
      <Button
        size="sm"
        onClick={async () => {
          if (!value.trim()) return
          await onAdd(value)
          setValue("")
          setOpen(false)
        }}
      >
        <Check className="size-4" />
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
        <X className="size-4" />
      </Button>
    </div>
  ) : (
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
      <Plus className="size-4" />
      Add
    </Button>
  )
}
