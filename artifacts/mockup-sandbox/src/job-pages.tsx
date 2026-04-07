import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router-dom"
import {
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderClosed,
  FolderCog,
  FolderKanban,
  FolderPlus,
  Grid2X2,
  HelpCircle,
  History,
  ImageIcon,
  List,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  PlayCircle,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  Trash2,
  Upload,
  Video,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Progress } from "@/components/ui/progress"
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

type MediaType = "document" | "photo" | "video"
type JobStatus = "open" | "closed" | "archived"

type JobRecord = {
  id: string
  title: string
  status: JobStatus
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

type PaginationMeta = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

type JobShellContext = {
  job: JobRecord
  refreshJob: () => Promise<JobRecord | null>
  setJob: Dispatch<SetStateAction<JobRecord | null>>
}

type FolderRecord = {
  id: string
  jobId: string | null
  parentFolderId: string | null
  title: string
  mediaType: MediaType
  isGlobal: boolean
  viewingPermissions: Record<string, unknown> | null
  uploadingPermissions: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  childFolderCount?: number
  fileCount?: number
}

type FileRecord = {
  id: string
  folderId: string | null
  filename: string
  originalName: string
  fileUrl: string | null
  fileSize: number | null
  mimeType: string | null
  uploadedBy: string | null
  uploadedByName?: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
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

type JobFormValues = {
  title: string
  status: JobStatus
  streetAddress: string
  city: string
  state: string
  zipCode: string
  contractPrice: string
  jobType: string
  projectedStart: string
  projectedCompletion: string
  actualStart: string
  actualCompletion: string
  workDays: string[]
}

type ConfirmAction =
  | {
      kind: "delete-folder"
      folder: FolderRecord
    }
  | {
      kind: "delete-file"
      file: FileRecord
    }
  | {
      kind: "purge-folder"
      folder: FolderRecord
    }
  | {
      kind: "purge-file"
      file: FileRecord
    }
  | {
      kind: "empty-trash"
    }

type RenameTarget =
  | {
      kind: "folder"
      folder: FolderRecord
    }
  | {
      kind: "file"
      file: FileRecord
    }

type MediaConfig = {
  label: string
  route: "documents" | "photos" | "videos"
  emptyTitle: string
  emptyDescription: string
  sectionDescription: string
  supportsNestedFolders: boolean
  rootSystemFolderTitle: string | null
  allowedTypesText: string
}

const weekdayOptions = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
] as const

const mediaConfigs: Record<MediaType, MediaConfig> = {
  document: {
    label: "Documents",
    route: "documents",
    emptyTitle: "No documents yet",
    emptyDescription: "Create a folder or upload files to start organizing job documents.",
    sectionDescription: "Contracts, drawings, specs, permits, and internal job paperwork.",
    supportsNestedFolders: true,
    rootSystemFolderTitle: "Global Documents",
    allowedTypesText: "PDF, Office, text, and spreadsheet files",
  },
  photo: {
    label: "Photos",
    route: "photos",
    emptyTitle: "No photos yet",
    emptyDescription: "Create a photo folder, then upload image files to build the project photo record.",
    sectionDescription: "Flat image folders for install progress, punch lists, and site reference.",
    supportsNestedFolders: false,
    rootSystemFolderTitle: null,
    allowedTypesText: "JPG, PNG, GIF, and WEBP images",
  },
  video: {
    label: "Videos",
    route: "videos",
    emptyTitle: "No videos yet",
    emptyDescription: "Open a folder and upload job videos to keep footage organized by milestone.",
    sectionDescription: "Video folders for walkthroughs, install captures, and issue documentation.",
    supportsNestedFolders: false,
    rootSystemFolderTitle: "Global Videos",
    allowedTypesText: "MP4, MOV, AVI, and WEBM videos",
  },
}

function toNullable(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatCurrency(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value))
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatFileSize(value: number | null | undefined) {
  if (!value) {
    return "—"
  }

  if (value < 1024) {
    return `${value} B`
  }

  const units = ["KB", "MB", "GB", "TB"]
  let size = value / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDuration(seconds: number | null) {
  if (!seconds || Number.isNaN(seconds)) {
    return "00:00"
  }

  const totalSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase()

  if (normalized === "open") {
    return "border-blue-200 bg-blue-50 text-blue-700"
  }

  if (normalized === "closed" || normalized === "archived") {
    return "border-slate-200 bg-slate-100 text-slate-700"
  }

  return "border-slate-200 bg-slate-100 text-slate-700"
}

function getLocationLabel(job: JobRecord) {
  const parts = [job.streetAddress, job.city, job.state, job.zipCode].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : "—"
}

function createJobFormValues(job?: JobRecord | null): JobFormValues {
  return {
    title: job?.title ?? "",
    status: job?.status ?? "open",
    streetAddress: job?.streetAddress ?? "",
    city: job?.city ?? "",
    state: job?.state ?? "",
    zipCode: job?.zipCode ?? "",
    contractPrice: job?.contractPrice ?? "",
    jobType: job?.jobType ?? "",
    projectedStart: job?.projectedStart ?? "",
    projectedCompletion: job?.projectedCompletion ?? "",
    actualStart: job?.actualStart ?? "",
    actualCompletion: job?.actualCompletion ?? "",
    workDays: job?.workDays ?? ["mon", "tue", "wed", "thu", "fri"],
  }
}

function buildJobPayload(values: JobFormValues) {
  return {
    title: values.title.trim(),
    status: values.status,
    streetAddress: toNullable(values.streetAddress),
    city: toNullable(values.city),
    state: toNullable(values.state.toUpperCase()),
    zipCode: toNullable(values.zipCode),
    contractPrice: toNullable(values.contractPrice.replaceAll(",", "").replaceAll("$", "")),
    jobType: toNullable(values.jobType),
    projectedStart: toNullable(values.projectedStart),
    projectedCompletion: toNullable(values.projectedCompletion),
    actualStart: toNullable(values.actualStart),
    actualCompletion: toNullable(values.actualCompletion),
    workDays: values.workDays.length > 0 ? values.workDays : null,
  }
}

function fileExtension(filename: string) {
  const parts = filename.split(".")
  return parts.length > 1 ? `.${parts.at(-1)?.toLowerCase()}` : ""
}

function fileCategory(file: FileRecord) {
  const extension = fileExtension(file.originalName)
  const mime = file.mimeType?.toLowerCase() ?? ""

  if (mime.startsWith("image/") || [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(extension)) {
    return "image"
  }

  if (mime.startsWith("video/") || [".mp4", ".mov", ".avi", ".webm", ".m4v"].includes(extension)) {
    return "video"
  }

  if ([".xls", ".xlsx", ".csv"].includes(extension)) {
    return "spreadsheet"
  }

  return "document"
}

function fileTypeLabel(file: FileRecord) {
  const category = fileCategory(file)

  if (category === "image") {
    return "Image"
  }

  if (category === "video") {
    return "Video"
  }

  if (category === "spreadsheet") {
    return "Spreadsheet"
  }

  return "Document"
}

function fileTypeIcon(file: FileRecord) {
  const category = fileCategory(file)

  if (category === "image") {
    return ImageIcon
  }

  if (category === "video") {
    return Video
  }

  if (category === "spreadsheet") {
    return FileSpreadsheet
  }

  return FileText
}

function buildItemKey(type: "folder" | "file", id: string) {
  return `${type}:${id}`
}

function buildPublicUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path
  }

  return new URL(path, window.location.origin).toString()
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.error("Unable to copy to clipboard.")
  }
}

async function downloadBlobFromApi(path: string, fallbackName: string) {
  const response = await api.get(path, {
    responseType: "blob",
  })

  const blob = response.data as Blob
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  const disposition = response.headers["content-disposition"]
  const filenameMatch =
    typeof disposition === "string"
      ? disposition.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i)
      : null

  anchor.href = url
  anchor.download = filenameMatch?.[1]?.replace(/"/g, "") || fallbackName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}

function sectionTabs(jobId: string, current: MediaConfig["route"]) {
  return (
    <Tabs value={current}>
      <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1">
        <TabsTrigger value="documents" asChild>
          <Link to={`/jobs/${jobId}/files/documents`}>Documents</Link>
        </TabsTrigger>
        <TabsTrigger value="photos" asChild>
          <Link to={`/jobs/${jobId}/files/photos`}>Photos</Link>
        </TabsTrigger>
        <TabsTrigger value="videos" asChild>
          <Link to={`/jobs/${jobId}/files/videos`}>Videos</Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

function SectionHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-[#E5E7EB] px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

function EmptyPanel({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="rounded-full border border-[#E5E7EB] bg-slate-50 p-3 text-slate-500">
          {icon ?? <FolderKanban className="size-5" />}
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

function VideoThumbnail({ src }: { src: string }) {
  const [duration, setDuration] = useState<number | null>(null)

  return (
    <div className="relative overflow-hidden rounded-lg border border-[#E5E7EB] bg-slate-950">
      <video
        className="h-40 w-full object-cover opacity-80"
        src={src}
        preload="metadata"
        muted
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration)
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
      <div className="absolute inset-x-3 bottom-3 flex items-center justify-between">
        <span className="rounded-full bg-white/15 px-2 py-1 text-xs font-medium text-white backdrop-blur">
          {formatDuration(duration)}
        </span>
        <PlayCircle className="size-7 text-white" />
      </div>
    </div>
  )
}

function MediaPreview({ file }: { file: FileRecord }) {
  const category = fileCategory(file)

  if (category === "image" && file.fileUrl) {
    return (
      <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-slate-50">
        <img
          src={buildPublicUrl(file.fileUrl)}
          alt={file.originalName}
          className="h-40 w-full object-cover"
        />
      </div>
    )
  }

  if (category === "video" && file.fileUrl) {
    return <VideoThumbnail src={buildPublicUrl(file.fileUrl)} />
  }

  const Icon = fileTypeIcon(file)

  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-[#E5E7EB] bg-slate-50">
      <Icon className="size-10 text-slate-400" />
    </div>
  )
}

function JobFormFields({
  values,
  onChange,
  onToggleWorkDay,
  showActualDates,
}: {
  values: JobFormValues
  onChange: (field: keyof JobFormValues, value: string) => void
  onToggleWorkDay: (day: string) => void
  showActualDates: boolean
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 lg:col-span-2">
          <label className="text-sm font-medium text-slate-900">Job Title</label>
          <Input
            value={values.title}
            onChange={(event) => onChange("title", event.target.value)}
            placeholder="Aspen Ridge Residence"
            className="border-[#E5E7EB]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Status</label>
          <Select value={values.status} onValueChange={(value) => onChange("status", value)}>
            <SelectTrigger className="border-[#E5E7EB]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Type</label>
          <Input
            value={values.jobType}
            onChange={(event) => onChange("jobType", event.target.value)}
            placeholder="Residential Remodel"
            className="border-[#E5E7EB]"
          />
        </div>

        <div className="space-y-2 lg:col-span-2">
          <label className="text-sm font-medium text-slate-900">Street Address</label>
          <Input
            value={values.streetAddress}
            onChange={(event) => onChange("streetAddress", event.target.value)}
            placeholder="1234 Elm Street"
            className="border-[#E5E7EB]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">City</label>
          <Input
            value={values.city}
            onChange={(event) => onChange("city", event.target.value)}
            placeholder="Denver"
            className="border-[#E5E7EB]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">State</label>
          <Input
            value={values.state}
            onChange={(event) => onChange("state", event.target.value)}
            placeholder="CO"
            maxLength={2}
            className="border-[#E5E7EB] uppercase"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Zip Code</label>
          <Input
            value={values.zipCode}
            onChange={(event) => onChange("zipCode", event.target.value)}
            placeholder="80202"
            className="border-[#E5E7EB]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Contract Price</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
              $
            </span>
            <Input
              value={values.contractPrice}
              onChange={(event) => onChange("contractPrice", event.target.value)}
              placeholder="85000"
              className="border-[#E5E7EB] pl-7"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Projected Start</label>
          <Input
            type="date"
            value={values.projectedStart}
            onChange={(event) => onChange("projectedStart", event.target.value)}
            className="border-[#E5E7EB]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-900">Projected Completion</label>
          <Input
            type="date"
            value={values.projectedCompletion}
            onChange={(event) => onChange("projectedCompletion", event.target.value)}
            className="border-[#E5E7EB]"
          />
        </div>

        {showActualDates ? (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Actual Start</label>
              <Input
                type="date"
                value={values.actualStart}
                onChange={(event) => onChange("actualStart", event.target.value)}
                className="border-[#E5E7EB]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Actual Completion</label>
              <Input
                type="date"
                value={values.actualCompletion}
                onChange={(event) => onChange("actualCompletion", event.target.value)}
                className="border-[#E5E7EB]"
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-900">Work Days</label>
          <p className="text-sm text-slate-500">Choose the regular workweek for schedule defaults.</p>
        </div>
        <div className="flex flex-wrap gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
          {weekdayOptions.map((option) => {
            const checked = values.workDays.includes(option.value)

            return (
              <label
                key={option.value}
                className="flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-slate-700"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onToggleWorkDay(option.value)}
                />
                {option.label}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function fileFiltersForMediaType(mediaType: MediaType) {
  if (mediaType === "document") {
    return [
      { value: "pdf", label: "PDF" },
      { value: "word", label: "Word" },
      { value: "excel", label: "Excel/CSV" },
      { value: "images", label: "Images" },
      { value: "video", label: "Video" },
      { value: "other", label: "Other" },
    ]
  }

  if (mediaType === "photo") {
    return [{ value: "images", label: "Images" }]
  }

  return [{ value: "video", label: "Video" }]
}

function FolderGridCard({
  folder,
  selected,
  onSelect,
  onOpen,
  actions,
}: {
  folder: FolderRecord
  selected: boolean
  onSelect: (checked: boolean) => void
  onOpen: () => void
  actions: ReactNode
}) {
  return (
    <Card
      className="group cursor-pointer border-[#E5E7EB] bg-white shadow-sm transition-colors hover:border-blue-300"
      onClick={onOpen}
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <label
            className="flex items-center gap-2"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <Checkbox checked={selected} onCheckedChange={(checked) => onSelect(Boolean(checked))} />
          </label>
          <div
            className="flex items-center gap-2"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            {actions}
          </div>
        </div>

        <div className="rounded-xl bg-blue-50 p-4 text-blue-700">
          <FolderClosed className="size-8" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="line-clamp-2 font-medium text-slate-950">{folder.title}</h3>
            {folder.isGlobal ? (
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                Global
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-slate-500">
            {(folder.childFolderCount ?? 0) > 0 ? `${folder.childFolderCount} folders` : "No subfolders"}
            {" • "}
            {(folder.fileCount ?? 0) > 0 ? `${folder.fileCount} files` : "No files"}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function FileGridCard({
  file,
  selected,
  onSelect,
  onPreview,
  actions,
}: {
  file: FileRecord
  selected: boolean
  onSelect: (checked: boolean) => void
  onPreview: () => void
  actions: ReactNode
}) {
  return (
    <Card
      className="group cursor-pointer border-[#E5E7EB] bg-white shadow-sm transition-colors hover:border-blue-300"
      onClick={onPreview}
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <label
            className="flex items-center gap-2"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <Checkbox checked={selected} onCheckedChange={(checked) => onSelect(Boolean(checked))} />
          </label>
          <div
            className="flex items-center gap-2"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            {actions}
          </div>
        </div>

        <MediaPreview file={file} />

        <div className="space-y-1">
          <h3 className="line-clamp-2 font-medium text-slate-950">{file.originalName}</h3>
          <p className="text-sm text-slate-500">
            {file.uploadedByName || "Unknown"} • {formatFileSize(file.fileSize)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function FileManagerPage({ mediaType }: { mediaType: MediaType }) {
  const { job } = useOutletContext<JobShellContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const config = mediaConfigs[mediaType]
  const currentFolderId = searchParams.get("folder")
  const [folderData, setFolderData] = useState<{
    currentFolder: FolderRecord | null
    breadcrumb: FolderRecord[]
    folders: FolderRecord[]
  }>({
    currentFolder: null,
    breadcrumb: [],
    folders: [],
  })
  const [files, setFiles] = useState<FileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<"grid" | "list">(
    mediaType === "document" ? "list" : "grid",
  )
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState("modified_newest")
  const [uploadedBy, setUploadedBy] = useState("all")
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [newFolderTitle, setNewFolderTitle] = useState("")
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([])
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashData, setTrashData] = useState<{ folders: FolderRecord[]; files: FileRecord[] }>({
    folders: [],
    files: [],
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [moveTarget, setMoveTarget] = useState<FolderRecord | null>(null)
  const [moveDestinationId, setMoveDestinationId] = useState("__root__")
  const [moveOptions, setMoveOptions] = useState<FolderRecord[]>([])
  const [moveOptionsLoading, setMoveOptionsLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const folderMap = useMemo(() => {
    return new Map(moveOptions.map((folder) => [folder.id, folder]))
  }, [moveOptions])

  const refreshFoldersAndFiles = async (silent = false) => {
    if (!silent) {
      setLoading(true)
    }

    try {
      const folderResponse = await api.get<{
        currentFolder: FolderRecord | null
        breadcrumb: FolderRecord[]
        folders: FolderRecord[]
      }>(`/jobs/${job.id}/folders`, {
        params: {
          mediaType,
          ...(currentFolderId ? { parentId: currentFolderId } : {}),
        },
      })

      setFolderData(folderResponse.data)

      if (!currentFolderId) {
        setFiles([])
        return
      }

      const fileResponse = await api.get<{
        folder: FolderRecord
        files: FileRecord[]
      }>(`/folders/${currentFolderId}/files`, {
        params: {
          ...(search ? { search } : {}),
          ...(uploadedBy !== "all" ? { uploadedBy } : {}),
          ...(fileTypes.length > 0 ? { fileTypes: fileTypes.join(",") } : {}),
          ...(fromDate ? { from: fromDate } : {}),
          ...(toDate ? { to: toDate } : {}),
          sortBy,
        },
      })

      setFiles(fileResponse.data.files)
    } catch {
      if (currentFolderId) {
        const next = new URLSearchParams(searchParams)
        next.delete("folder")
        setSearchParams(next)
      } else {
        toast.error(`Unable to load ${config.label.toLowerCase()}.`)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshFoldersAndFiles()
    setSelectedKeys([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, mediaType, currentFolderId, search, uploadedBy, sortBy, fromDate, toDate, fileTypes.join(",")])

  useEffect(() => {
    if (!activityOpen) {
      return
    }

    let active = true
    setActivityLoading(true)

    void api
      .get<{ entries: ActivityEntry[] }>("/activity", {
        params: {
          jobId: job.id,
          mediaType,
          ...(folderData.currentFolder ? { folderId: folderData.currentFolder.id } : {}),
          limit: 30,
        },
      })
      .then((response) => {
        if (active) {
          setActivityEntries(response.data.entries)
        }
      })
      .catch(() => {
        if (active) {
          toast.error("Unable to load activity log.")
        }
      })
      .finally(() => {
        if (active) {
          setActivityLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [activityOpen, folderData.currentFolder, job.id, mediaType])

  useEffect(() => {
    if (!trashOpen) {
      return
    }

    let active = true
    setTrashLoading(true)

    void api
      .get<{ folders: FolderRecord[]; files: FileRecord[] }>(`/jobs/${job.id}/trash`, {
        params: { mediaType },
      })
      .then((response) => {
        if (active) {
          setTrashData(response.data)
        }
      })
      .catch(() => {
        if (active) {
          toast.error("Unable to load trash.")
        }
      })
      .finally(() => {
        if (active) {
          setTrashLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [job.id, mediaType, trashOpen])

  useEffect(() => {
    if (!moveTarget) {
      return
    }

    let active = true
    setMoveOptionsLoading(true)

    void api
      .get<{
        currentFolder: FolderRecord | null
        breadcrumb: FolderRecord[]
        folders: FolderRecord[]
      }>(`/jobs/${job.id}/folders`, {
        params: {
          mediaType,
          all: true,
        },
      })
      .then((response) => {
        if (!active) {
          return
        }

        setMoveOptions(response.data.folders)
      })
      .catch(() => {
        if (active) {
          toast.error("Unable to load destination folders.")
        }
      })
      .finally(() => {
        if (active) {
          setMoveOptionsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [job.id, mediaType, moveTarget])

  const visibleFolders = useMemo(() => {
    if (!search) {
      return folderData.folders
    }

    const query = search.toLowerCase()
    return folderData.folders.filter((folder) => folder.title.toLowerCase().includes(query))
  }, [folderData.folders, search])

  const uploadTarget =
    folderData.currentFolder ??
    folderData.folders.find((folder) =>
      config.rootSystemFolderTitle ? folder.title === config.rootSystemFolderTitle : false,
    ) ??
    null

  const visibleItemKeys = [
    ...visibleFolders.map((folder) => buildItemKey("folder", folder.id)),
    ...files.map((file) => buildItemKey("file", file.id)),
  ]

  const selectedCount = selectedKeys.length
  const allVisibleSelected =
    visibleItemKeys.length > 0 && visibleItemKeys.every((key) => selectedKeys.includes(key))
  const someVisibleSelected =
    visibleItemKeys.some((key) => selectedKeys.includes(key)) && !allVisibleSelected

  const uploaderOptions = useMemo(() => {
    const unique = new Map<string, string>()

    for (const file of files) {
      if (file.uploadedBy && file.uploadedByName) {
        unique.set(file.uploadedBy, file.uploadedByName)
      }
    }

    return Array.from(unique.entries()).map(([id, name]) => ({
      id,
      name,
    }))
  }, [files])

  const pageUrl = `${window.location.origin}${location.pathname}${currentFolderId ? `?folder=${currentFolderId}` : ""}`

  const openFolder = (folderId: string) => {
    const next = new URLSearchParams(searchParams)
    next.set("folder", folderId)
    setSearchParams(next)
  }

  const goToRoot = () => {
    const next = new URLSearchParams(searchParams)
    next.delete("folder")
    setSearchParams(next)
  }

  const toggleSelection = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      if (checked) {
        return current.includes(key) ? current : [...current, key]
      }

      return current.filter((value) => value !== key)
    })
  }

  const toggleAllVisible = (checked: boolean) => {
    if (checked) {
      setSelectedKeys((current) => Array.from(new Set([...current, ...visibleItemKeys])))
      return
    }

    setSelectedKeys((current) => current.filter((key) => !visibleItemKeys.includes(key)))
  }

  const handleCreateFolder = async () => {
    if (!newFolderTitle.trim()) {
      toast.error("Folder name is required.")
      return
    }

    setSubmitting(true)

    try {
      await api.post(`/jobs/${job.id}/folders`, {
        title: newFolderTitle.trim(),
        mediaType,
        parentFolderId: config.supportsNestedFolders ? currentFolderId : null,
      })

      toast.success("Folder created.")
      setCreateFolderOpen(false)
      setNewFolderTitle("")
      await refreshFoldersAndFiles(true)
    } catch {
      toast.error("Unable to create folder.")
    } finally {
      setSubmitting(false)
    }
  }

  const uploadFiles = async (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) {
      return
    }

    if (!uploadTarget) {
      toast.error(
        mediaType === "photo"
          ? "Create or open a photo folder before uploading."
          : "Open a folder before uploading files.",
      )
      return
    }

    const formData = new FormData()

    for (const file of incomingFiles) {
      formData.append("files", file)
    }

    setUploadProgress(0)

    try {
      await api.post(`/folders/${uploadTarget.id}/files`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total) {
            return
          }

          const value = Math.round((progressEvent.loaded / progressEvent.total) * 100)
          setUploadProgress(value)
        },
      })

      if (!currentFolderId && uploadTarget.id !== currentFolderId) {
        openFolder(uploadTarget.id)
      } else {
        await refreshFoldersAndFiles(true)
      }

      toast.success(
        incomingFiles.length === 1
          ? "File uploaded."
          : `${incomingFiles.length} files uploaded.`,
      )
    } catch {
      toast.error("Unable to upload files.")
    } finally {
      setUploadProgress(null)
      if (uploadInputRef.current) {
        uploadInputRef.current.value = ""
      }
    }
  }

  const handleFolderDownload = async (folder: FolderRecord) => {
    try {
      await downloadBlobFromApi(`/folders/${folder.id}/download`, `${folder.title}.zip`)
    } catch {
      toast.error("Unable to download folder.")
    }
  }

  const handleFileDownload = async (file: FileRecord) => {
    try {
      await downloadBlobFromApi(`/files/${file.id}/download`, file.originalName)
    } catch {
      toast.error("Unable to download file.")
    }
  }

  const handlePreview = (file: FileRecord) => {
    if (file.fileUrl) {
      window.open(buildPublicUrl(file.fileUrl), "_blank", "noopener,noreferrer")
      return
    }

    void handleFileDownload(file)
  }

  const runConfirmAction = async () => {
    if (!confirmAction) {
      return
    }

    setSubmitting(true)

    try {
      if (confirmAction.kind === "delete-folder") {
        await api.delete(`/folders/${confirmAction.folder.id}`)
        toast.success("Folder moved to trash.")
      } else if (confirmAction.kind === "delete-file") {
        await api.delete(`/files/${confirmAction.file.id}`)
        toast.success("File moved to trash.")
      } else if (confirmAction.kind === "purge-folder") {
        await api.delete(`/folders/${confirmAction.folder.id}/purge`)
        toast.success("Folder permanently deleted.")
      } else if (confirmAction.kind === "purge-file") {
        await api.delete(`/files/${confirmAction.file.id}/purge`)
        toast.success("File permanently deleted.")
      } else {
        await api.delete(`/jobs/${job.id}/trash`, {
          params: { mediaType },
        })
        toast.success("Trash emptied.")
      }

      setConfirmAction(null)
      await refreshFoldersAndFiles(true)

      if (trashOpen) {
        const refreshedTrash = await api.get<{ folders: FolderRecord[]; files: FileRecord[] }>(
          `/jobs/${job.id}/trash`,
          {
            params: { mediaType },
          },
        )
        setTrashData(refreshedTrash.data)
      }
    } catch {
      toast.error("Unable to complete that action.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) {
      toast.error("Name is required.")
      return
    }

    setSubmitting(true)

    try {
      if (renameTarget.kind === "folder") {
        await api.put(`/folders/${renameTarget.folder.id}`, {
          title: renameValue.trim(),
        })
        toast.success("Folder renamed.")
      } else {
        await api.put(`/files/${renameTarget.file.id}`, {
          originalName: renameValue.trim(),
        })
        toast.success("File renamed.")
      }

      setRenameTarget(null)
      setRenameValue("")
      await refreshFoldersAndFiles(true)
    } catch {
      toast.error("Unable to rename item.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleMoveFolder = async () => {
    if (!moveTarget) {
      return
    }

    setSubmitting(true)

    try {
      await api.put(`/folders/${moveTarget.id}/move`, {
        destinationFolderId: moveDestinationId === "__root__" ? null : moveDestinationId,
      })

      toast.success("Folder moved.")
      setMoveTarget(null)
      setMoveDestinationId("__root__")
      await refreshFoldersAndFiles(true)
    } catch {
      toast.error("Unable to move folder.")
    } finally {
      setSubmitting(false)
    }
  }

  const restoreTrashItem = async (item: FolderRecord | FileRecord, kind: "folder" | "file") => {
    setSubmitting(true)

    try {
      if (kind === "folder") {
        await api.post(`/folders/${item.id}/restore`)
      } else {
        await api.post(`/files/${item.id}/restore`)
      }

      toast.success(kind === "folder" ? "Folder restored." : "File restored.")
      const refreshedTrash = await api.get<{ folders: FolderRecord[]; files: FileRecord[] }>(
        `/jobs/${job.id}/trash`,
        {
          params: { mediaType },
        },
      )
      setTrashData(refreshedTrash.data)
      await refreshFoldersAndFiles(true)
    } catch {
      toast.error("Unable to restore item.")
    } finally {
      setSubmitting(false)
    }
  }

  const renderFolderActions = (folder: FolderRecord) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-[#E5E7EB]">
        <DropdownMenuItem
          onClick={() => {
            setRenameTarget({ kind: "folder", folder })
            setRenameValue(folder.title)
          }}
          disabled={folder.isGlobal}
        >
          <Pencil className="size-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleFolderDownload(folder)}>
          <Download className="size-4" />
          Download .zip
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setMoveTarget(folder)
            setMoveDestinationId(folder.parentFolderId ?? "__root__")
          }}
          disabled={folder.isGlobal}
        >
          <RefreshCw className="size-4" />
          Move
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            const url = `${window.location.origin}${location.pathname}?folder=${folder.id}`
            await copyText(url, "Folder link copied.")
          }}
        >
          <Copy className="size-4" />
          Copy Link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600 focus:text-red-600"
          disabled={folder.isGlobal}
          onClick={() => {
            setConfirmAction({ kind: "delete-folder", folder })
          }}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const renderFileActions = (file: FileRecord) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-[#E5E7EB]">
        <DropdownMenuItem onClick={() => handlePreview(file)}>
          <Eye className="size-4" />
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleFileDownload(file)}>
          <Download className="size-4" />
          Download
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setRenameTarget({ kind: "file", file })
            setRenameValue(file.originalName)
          }}
        >
          <Pencil className="size-4" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600 focus:text-red-600"
          onClick={() => {
            setConfirmAction({ kind: "delete-file", file })
          }}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const destinationOptions = useMemo(() => {
    return moveOptions
      .filter((folder) => folder.id !== moveTarget?.id)
      .map((folder) => {
        const parts: string[] = [folder.title]
        let parentId = folder.parentFolderId

        while (parentId) {
          const parent = folderMap.get(parentId)
          if (!parent) {
            break
          }
          parts.unshift(parent.title)
          parentId = parent.parentFolderId
        }

        return {
          id: folder.id,
          label: parts.join(" / "),
        }
      })
  }, [folderMap, moveOptions, moveTarget])

  return (
    <div className="space-y-4">
      <Card className="border-[#E5E7EB] bg-white shadow-sm">
        <SectionHeading
          title="Files"
          description={`${job.title} • ${config.sectionDescription}`}
        />
        <CardContent className="space-y-6 p-6">
          {sectionTabs(job.id, config.route)}

          <div className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="border-[#E5E7EB] bg-white"
                  onClick={() => setHelpOpen(true)}
                >
                  <HelpCircle className="size-4" />
                  Help
                </Button>
                <Button
                  variant="outline"
                  className="border-[#E5E7EB] bg-white"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 className="size-4" />
                  Settings
                </Button>
                <Button
                  variant="outline"
                  className="border-[#E5E7EB] bg-white"
                  onClick={() => setActivityOpen(true)}
                >
                  <History className="size-4" />
                  Activity
                </Button>
                <Button
                  variant="outline"
                  className="border-[#E5E7EB] bg-white"
                  onClick={() => void copyText(pageUrl, "View link copied.")}
                >
                  <Share2 className="size-4" />
                  Share
                </Button>
                <Button
                  variant="outline"
                  className="border-[#E5E7EB] bg-white"
                  onClick={() => setFilterOpen(true)}
                >
                  <Filter className="size-4" />
                  Filter
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-md border border-[#E5E7EB] bg-white">
                  <Button
                    variant="ghost"
                    className="rounded-none border-0"
                    onClick={() => setCreateFolderOpen(true)}
                  >
                    <FolderPlus className="size-4" />
                    New
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="rounded-none border-0 px-2">
                        <ChevronDown className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-[#E5E7EB]">
                      <DropdownMenuItem onClick={() => setCreateFolderOpen(true)}>
                        <FolderPlus className="size-4" />
                        Create Folder
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTrashOpen(true)}>
                        <Trash2 className="size-4" />
                        Open Trash
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void refreshFoldersAndFiles()}>
                        <RefreshCw className="size-4" />
                        Refresh View
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept={
                    mediaType === "photo"
                      ? ".jpg,.jpeg,.png,.gif,.webp"
                      : mediaType === "video"
                        ? ".mp4,.mov,.avi,.webm,.m4v"
                        : undefined
                  }
                  onChange={(event) => {
                    void uploadFiles(Array.from(event.target.files ?? []))
                  }}
                />

                <Button
                  onClick={() => {
                    if (!uploadTarget) {
                      toast.error(
                        mediaType === "photo"
                          ? "Create a folder before uploading photos."
                          : "Open a folder before uploading files.",
                      )
                      return
                    }

                    uploadInputRef.current?.click()
                  }}
                >
                  <Upload className="size-4" />
                  + Upload
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative w-full max-w-xl">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={`Search ${config.label.toLowerCase()}, folders, and files`}
                    className="border-[#E5E7EB] bg-white pl-9"
                  />
                </div>

                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full border-[#E5E7EB] bg-white sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="modified_newest">Modified: Newest</SelectItem>
                    <SelectItem value="modified_oldest">Modified: Oldest</SelectItem>
                    <SelectItem value="name_asc">Name: A to Z</SelectItem>
                    <SelectItem value="name_desc">Name: Z to A</SelectItem>
                    <SelectItem value="added_newest">Added: Newest</SelectItem>
                    <SelectItem value="added_oldest">Added: Oldest</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                {selectedCount > 0 ? (
                  <span className="text-sm text-slate-500">{selectedCount} selected</span>
                ) : null}
                <Button
                  variant={viewMode === "grid" ? "default" : "outline"}
                  className={cn(viewMode !== "grid" && "border-[#E5E7EB] bg-white")}
                  size="icon"
                  onClick={() => setViewMode("grid")}
                >
                  <Grid2X2 className="size-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "outline"}
                  className={cn(viewMode !== "list" && "border-[#E5E7EB] bg-white")}
                  size="icon"
                  onClick={() => setViewMode("list")}
                >
                  <List className="size-4" />
                </Button>
              </div>
            </div>

            {uploadProgress !== null ? (
              <div className="rounded-lg border border-blue-100 bg-white p-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-900">Uploading files</span>
                  <span className="text-slate-500">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2 bg-blue-100" />
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {folderData.currentFolder ? (
                    <BreadcrumbLink
                      asChild
                      className="cursor-pointer"
                    >
                      <button type="button" onClick={goToRoot}>
                        {config.label}
                      </button>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{config.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {folderData.breadcrumb.map((folder, index) => (
                  <div key={folder.id} className="contents">
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      {index === folderData.breadcrumb.length - 1 ? (
                        <BreadcrumbPage>{folder.title}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink
                          asChild
                          className="cursor-pointer"
                        >
                          <button type="button" onClick={() => openFolder(folder.id)}>
                            {folder.title}
                          </button>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </div>
                ))}
              </BreadcrumbList>
            </Breadcrumb>

            <div className="text-sm text-slate-500">
              {folderData.currentFolder
                ? `${visibleFolders.length} folders • ${files.length} files`
                : `${visibleFolders.length} folders`}
            </div>
          </div>

          <div
            className={cn(
              "rounded-xl border border-dashed border-[#E5E7EB] bg-white p-4 transition-colors",
              dragActive && "border-blue-400 bg-blue-50/40",
            )}
            onDragOver={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault()
              setDragActive(false)
            }}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault()
              setDragActive(false)
              void uploadFiles(Array.from(event.dataTransfer.files))
            }}
          >
            {loading ? (
              <div className="space-y-4 py-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Card key={index} className="border-[#E5E7EB] bg-white shadow-none">
                      <CardContent className="space-y-3 p-4">
                        <Skeleton className="h-28 w-full rounded-lg" />
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : visibleFolders.length === 0 && files.length === 0 ? (
              <EmptyPanel
                title={config.emptyTitle}
                description={config.emptyDescription}
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button variant="outline" className="border-[#E5E7EB]" onClick={() => setCreateFolderOpen(true)}>
                      <FolderPlus className="size-4" />
                      Create Folder
                    </Button>
                    <Button
                      onClick={() => {
                        if (!uploadTarget) {
                          toast.error(
                            mediaType === "photo"
                              ? "Create a folder before uploading photos."
                              : "Open a folder before uploading files.",
                          )
                          return
                        }

                        uploadInputRef.current?.click()
                      }}
                    >
                      <Upload className="size-4" />
                      Upload Files
                    </Button>
                  </div>
                }
              />
            ) : viewMode === "grid" ? (
              <div className="space-y-6">
                {visibleFolders.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-slate-900">Folders</h3>
                      <label className="flex items-center gap-2 text-sm text-slate-500">
                        <Checkbox
                          checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => toggleAllVisible(Boolean(checked))}
                        />
                        Select all visible
                      </label>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {visibleFolders.map((folder) => (
                        <FolderGridCard
                          key={folder.id}
                          folder={folder}
                          selected={selectedKeys.includes(buildItemKey("folder", folder.id))}
                          onSelect={(checked) => toggleSelection(buildItemKey("folder", folder.id), checked)}
                          onOpen={() => openFolder(folder.id)}
                          actions={renderFolderActions(folder)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {files.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-slate-900">Files</h3>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {files.map((file) => (
                        <FileGridCard
                          key={file.id}
                          file={file}
                          selected={selectedKeys.includes(buildItemKey("file", file.id))}
                          onSelect={(checked) => toggleSelection(buildItemKey("file", file.id), checked)}
                          onPreview={() => handlePreview(file)}
                          actions={renderFileActions(file)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">
                        <Checkbox
                          checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => toggleAllVisible(Boolean(checked))}
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead>Modified</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleFolders.map((folder) => (
                      <TableRow
                        key={folder.id}
                        className="cursor-pointer"
                        onClick={() => openFolder(folder.id)}
                      >
                        <TableCell
                          onClick={(event) => {
                            event.stopPropagation()
                          }}
                        >
                          <Checkbox
                            checked={selectedKeys.includes(buildItemKey("folder", folder.id))}
                            onCheckedChange={(checked) =>
                              toggleSelection(buildItemKey("folder", folder.id), Boolean(checked))
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium text-slate-900">
                          <div className="flex items-center gap-3">
                            <FolderClosed className="size-4 text-blue-600" />
                            <span className="text-blue-700">{folder.title}</span>
                            {folder.isGlobal ? (
                              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                                Global
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>Folder</TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>{formatDate(folder.updatedAt)}</TableCell>
                        <TableCell>
                          {(folder.childFolderCount ?? 0) + (folder.fileCount ?? 0)} items
                        </TableCell>
                        <TableCell
                          onClick={(event) => {
                            event.stopPropagation()
                          }}
                        >
                          {renderFolderActions(folder)}
                        </TableCell>
                      </TableRow>
                    ))}

                    {files.map((file) => {
                      const Icon = fileTypeIcon(file)

                      return (
                        <TableRow key={file.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedKeys.includes(buildItemKey("file", file.id))}
                              onCheckedChange={(checked) =>
                                toggleSelection(buildItemKey("file", file.id), Boolean(checked))
                              }
                            />
                          </TableCell>
                          <TableCell className="font-medium text-slate-900">
                            <button
                              type="button"
                              className="flex items-center gap-3 text-left text-blue-700 hover:text-blue-800"
                              onClick={() => handlePreview(file)}
                            >
                              <Icon className="size-4" />
                              {file.originalName}
                            </button>
                          </TableCell>
                          <TableCell>{fileTypeLabel(file)}</TableCell>
                          <TableCell>{file.uploadedByName || "Unknown"}</TableCell>
                          <TableCell>{formatDate(file.updatedAt)}</TableCell>
                          <TableCell>{formatFileSize(file.fileSize)}</TableCell>
                          <TableCell>{renderFileActions(file)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="border-[#E5E7EB] bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              {config.supportsNestedFolders && currentFolderId
                ? `This folder will be created inside ${folderData.currentFolder?.title || "the current folder"}.`
                : `Create a new ${config.label.toLowerCase()} folder for this job.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-900">Folder Name</label>
            <Input
              value={newFolderTitle}
              onChange={(event) => setNewFolderTitle(event.target.value)}
              placeholder="Punch List"
              className="border-[#E5E7EB]"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="border-[#E5E7EB]"
              onClick={() => setCreateFolderOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleCreateFolder()} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Create Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameValue("")
          }
        }}
      >
        <DialogContent className="border-[#E5E7EB] bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{renameTarget?.kind === "folder" ? "Rename Folder" : "Rename File"}</DialogTitle>
            <DialogDescription>
              Update the name shown to the Cadstone team in this workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-900">Name</label>
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="border-[#E5E7EB]"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="border-[#E5E7EB]"
              onClick={() => {
                setRenameTarget(null)
                setRenameValue("")
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleRename()} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(moveTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setMoveTarget(null)
            setMoveDestinationId("__root__")
          }
        }}
      >
        <DialogContent className="border-[#E5E7EB] bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Folder</DialogTitle>
            <DialogDescription>
              Pick a new location for {moveTarget?.title || "this folder"}.
            </DialogDescription>
          </DialogHeader>

          {moveOptionsLoading ? (
            <div className="flex items-center gap-3 py-6 text-sm text-slate-500">
              <Spinner className="size-4 text-blue-600" />
              Loading destinations…
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Destination</label>
              <Select value={moveDestinationId} onValueChange={setMoveDestinationId}>
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Root</SelectItem>
                  {destinationOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              className="border-[#E5E7EB]"
              onClick={() => {
                setMoveTarget(null)
                setMoveDestinationId("__root__")
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleMoveFolder()} disabled={submitting || moveOptionsLoading}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Move Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="border-[#E5E7EB] bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{config.label} Help</DialogTitle>
            <DialogDescription>
              Quick rules for organizing and uploading files in this section.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm text-slate-600">
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="font-medium text-slate-900">Allowed uploads</div>
              <p>{config.allowedTypesText}</p>
            </div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="font-medium text-slate-900">Navigation</div>
              <p>Use breadcrumbs to move back up the folder tree. Documents support nested folders. Photos and videos stay flat.</p>
            </div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="font-medium text-slate-900">Uploads</div>
              <p>Drag files anywhere into the workspace or use the upload button. Upload progress appears above the content list.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="border-[#E5E7EB] bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{config.label} Settings</DialogTitle>
            <DialogDescription>
              Current section and folder context for this job.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 text-sm text-slate-600 md:grid-cols-2">
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="font-medium text-slate-900">Current folder</div>
              <p>{folderData.currentFolder?.title || "Root"}</p>
            </div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="font-medium text-slate-900">Upload target</div>
              <p>{uploadTarget?.title || "No active upload target"}</p>
            </div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="font-medium text-slate-900">Nested folders</div>
              <p>{config.supportsNestedFolders ? "Allowed" : "Disabled"}</p>
            </div>
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="font-medium text-slate-900">Share link</div>
              <p className="break-all">{pageUrl}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="border-[#E5E7EB] bg-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Activity Log</DialogTitle>
            <DialogDescription>
              Recent changes for {folderData.currentFolder?.title || config.label}.
            </DialogDescription>
          </DialogHeader>

          {activityLoading ? (
            <div className="flex items-center gap-3 py-10 text-sm text-slate-500">
              <Spinner className="size-4 text-blue-600" />
              Loading activity…
            </div>
          ) : activityEntries.length === 0 ? (
            <EmptyPanel
              title="No activity yet"
              description="New uploads, restores, renames, and deletes will appear here."
              icon={<History className="size-5" />}
            />
          ) : (
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-2">
              {activityEntries.map((entry) => {
                const description =
                  entry.metadata && typeof entry.metadata.description === "string"
                    ? entry.metadata.description
                    : `${entry.action} ${entry.entityType}`

                return (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="font-medium text-slate-900">{description}</div>
                      <div className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</div>
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {entry.userName || "System"} • {entry.entityType}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="border-[#E5E7EB] bg-white sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Trash</DialogTitle>
            <DialogDescription>
              Restore items or permanently delete them from the {config.label.toLowerCase()} workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              {trashData.folders.length} folders • {trashData.files.length} files
            </div>
            <Button
              variant="outline"
              className="border-[#E5E7EB]"
              onClick={() => {
                setConfirmAction({ kind: "empty-trash" })
              }}
              disabled={trashLoading || submitting || (trashData.folders.length === 0 && trashData.files.length === 0)}
            >
              <Trash2 className="size-4" />
              Empty Trash
            </Button>
          </div>

          {trashLoading ? (
            <div className="flex items-center gap-3 py-10 text-sm text-slate-500">
              <Spinner className="size-4 text-blue-600" />
              Loading trash…
            </div>
          ) : trashData.folders.length === 0 && trashData.files.length === 0 ? (
            <EmptyPanel
              title="Trash is empty"
              description="Deleted folders and files will appear here until they are restored or purged."
              icon={<Trash2 className="size-5" />}
            />
          ) : (
            <div className="max-h-[420px] space-y-4 overflow-y-auto pr-2">
              {trashData.folders.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-slate-900">Folders</h3>
                  {trashData.folders.map((folder) => (
                    <div
                      key={folder.id}
                      className="flex flex-col gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="font-medium text-slate-900">{folder.title}</div>
                        <div className="text-sm text-slate-500">
                          Deleted {formatDateTime(folder.deletedAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="border-[#E5E7EB]"
                          onClick={() => void restoreTrashItem(folder, "folder")}
                          disabled={submitting}
                        >
                          Restore
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => setConfirmAction({ kind: "purge-folder", folder })}
                          disabled={submitting}
                        >
                          Delete Permanently
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {trashData.files.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-slate-900">Files</h3>
                  {trashData.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex flex-col gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="font-medium text-slate-900">{file.originalName}</div>
                        <div className="text-sm text-slate-500">
                          Deleted {formatDateTime(file.deletedAt)} • {formatFileSize(file.fileSize)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="border-[#E5E7EB]"
                          onClick={() => void restoreTrashItem(file, "file")}
                          disabled={submitting}
                        >
                          Restore
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => setConfirmAction({ kind: "purge-file", file })}
                          disabled={submitting}
                        >
                          Delete Permanently
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="border-[#E5E7EB] bg-white sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Narrow the current file list by type, date, and uploader.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-900">File Types</div>
              <div className="space-y-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                {fileFiltersForMediaType(mediaType).map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                    <Checkbox
                      checked={fileTypes.includes(option.value)}
                      onCheckedChange={(checked) => {
                        setFileTypes((current) => {
                          if (checked) {
                            return current.includes(option.value) ? current : [...current, option.value]
                          }

                          return current.filter((value) => value !== option.value)
                        })
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-900">Uploaded By</div>
              <Select value={uploadedBy} onValueChange={setUploadedBy}>
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Uploaders</SelectItem>
                  {uploaderOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">From Date</label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="border-[#E5E7EB]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">To Date</label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="border-[#E5E7EB]"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-[#E5E7EB]"
                onClick={() => {
                  setUploadedBy("all")
                  setFileTypes([])
                  setFromDate("")
                  setToDate("")
                }}
              >
                Clear Filters
              </Button>
              <Button className="flex-1" onClick={() => setFilterOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null)
          }
        }}
      >
        <AlertDialogContent className="border-[#E5E7EB] bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.kind === "delete-folder" && "Delete folder?"}
              {confirmAction?.kind === "delete-file" && "Delete file?"}
              {confirmAction?.kind === "purge-folder" && "Permanently delete folder?"}
              {confirmAction?.kind === "purge-file" && "Permanently delete file?"}
              {confirmAction?.kind === "empty-trash" && "Empty trash?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.kind === "delete-folder" &&
                "The folder and its contents will move to trash until someone restores them."}
              {confirmAction?.kind === "delete-file" &&
                "The file will move to trash until someone restores it."}
              {confirmAction?.kind === "purge-folder" &&
                "This permanently removes the folder and all of its contents. This cannot be undone."}
              {confirmAction?.kind === "purge-file" &&
                "This permanently removes the file. This cannot be undone."}
              {confirmAction?.kind === "empty-trash" &&
                "This permanently deletes every trashed folder and file in this section."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runConfirmAction()} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function JobsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createValues, setCreateValues] = useState<JobFormValues>(() => createJobFormValues())

  useEffect(() => {
    let active = true
    setLoading(true)

    void api
      .get<{ jobs: JobRecord[]; pagination: PaginationMeta }>("/jobs", {
        params: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          ...(search ? { search } : {}),
          ...(status !== "all" ? { status } : {}),
        },
      })
      .then((response) => {
        if (!active) {
          return
        }

        setJobs(response.data.jobs)
        setPagination((current) => ({
          ...current,
          totalItems: response.data.pagination.totalItems,
          totalPages: response.data.pagination.totalPages,
        }))
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
  }, [pagination.page, pagination.pageSize, search, status])

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return
    }

    setCreateOpen(true)
  }, [searchParams])

  const allSelected = jobs.length > 0 && jobs.every((job) => selectedJobIds.includes(job.id))
  const someSelected = jobs.some((job) => selectedJobIds.includes(job.id)) && !allSelected

  const updateCreateValue = (field: keyof JobFormValues, value: string) => {
    setCreateValues((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const toggleCreateWorkDay = (day: string) => {
    setCreateValues((current) => ({
      ...current,
      workDays: current.workDays.includes(day)
        ? current.workDays.filter((value) => value !== day)
        : [...current.workDays, day],
    }))
  }

  const submitCreateJob = async () => {
    if (!createValues.title.trim()) {
      toast.error("Job title is required.")
      return
    }

    setCreateSubmitting(true)

    try {
      const response = await api.post<{ job: JobRecord }>("/jobs", buildJobPayload(createValues))
      toast.success("Job created.")
      setCreateOpen(false)
      setCreateValues(createJobFormValues())
      setPagination((current) => ({
        ...current,
        page: 1,
      }))
      navigate(`/jobs/${response.data.job.id}`)
    } catch {
      toast.error("Unable to create job.")
    } finally {
      setCreateSubmitting(false)
    }
  }

  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <SectionHeading
        title="Jobs"
        description="Track active and archived work across the Cadstone portfolio."
        actions={
          <>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPagination((current) => ({
                    ...current,
                    page: 1,
                  }))
                }}
                placeholder="Search jobs"
                className="w-full border-[#E5E7EB] pl-9 lg:w-72"
              />
            </div>

            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value)
                setPagination((current) => ({
                  ...current,
                  page: 1,
                }))
              }}
            >
              <SelectTrigger className="w-full border-[#E5E7EB] lg:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>

            <Button onClick={() => setCreateOpen(true)}>+ Create Job</Button>
          </>
        }
      />

      <CardContent className="space-y-6 p-6">
        {loading ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
              <div className="space-y-3 p-4">
                <Skeleton className="h-10 w-full" />
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-9 w-40" />
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <EmptyPanel
            title="No jobs found"
            description="Create the first job to start organizing files, schedules, and daily logs."
            action={<Button onClick={() => setCreateOpen(true)}>Create Job</Button>}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedJobIds(jobs.map((job) => job.id))
                            return
                          }

                          setSelectedJobIds([])
                        }}
                      />
                    </TableHead>
                    <TableHead>Job Title</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created Date</TableHead>
                    <TableHead className="text-right">Contract Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    >
                      <TableCell
                        onClick={(event) => {
                          event.stopPropagation()
                        }}
                      >
                        <Checkbox
                          checked={selectedJobIds.includes(job.id)}
                          onCheckedChange={(checked) => {
                            setSelectedJobIds((current) => {
                              if (checked) {
                                return current.includes(job.id) ? current : [...current, job.id]
                              }

                              return current.filter((value) => value !== job.id)
                            })
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/jobs/${job.id}`}
                          className="font-medium text-blue-700 hover:text-blue-800"
                          onClick={(event) => {
                            event.stopPropagation()
                          }}
                        >
                          {job.title}
                        </Link>
                      </TableCell>
                      <TableCell>{getLocationLabel(job)}</TableCell>
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

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm text-slate-500">
                Showing page {pagination.page} of {pagination.totalPages} • {pagination.totalItems} jobs
              </div>
              <Pagination className="mx-0 w-auto justify-start lg:justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      className={cn(pagination.page <= 1 && "pointer-events-none opacity-50")}
                      onClick={(event) => {
                        event.preventDefault()
                        if (pagination.page <= 1) {
                          return
                        }

                        setPagination((current) => ({
                          ...current,
                          page: current.page - 1,
                        }))
                      }}
                    />
                  </PaginationItem>

                  {Array.from({ length: pagination.totalPages }, (_, index) => index + 1)
                    .slice(Math.max(0, pagination.page - 2), Math.max(3, pagination.page + 1))
                    .map((pageNumber) => (
                      <PaginationItem key={pageNumber}>
                        <PaginationLink
                          href="#"
                          isActive={pageNumber === pagination.page}
                          onClick={(event) => {
                            event.preventDefault()
                            setPagination((current) => ({
                              ...current,
                              page: pageNumber,
                            }))
                          }}
                        >
                          {pageNumber}
                        </PaginationLink>
                      </PaginationItem>
                    ))}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      className={cn(
                        pagination.page >= pagination.totalPages && "pointer-events-none opacity-50",
                      )}
                      onClick={(event) => {
                        event.preventDefault()
                        if (pagination.page >= pagination.totalPages) {
                          return
                        }

                        setPagination((current) => ({
                          ...current,
                          page: current.page + 1,
                        }))
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </>
        )}
      </CardContent>

      <Dialog
        open={createOpen}
        onOpenChange={(nextOpen) => {
          setCreateOpen(nextOpen)

          if (!nextOpen && searchParams.get("create") === "1") {
            const next = new URLSearchParams(searchParams)
            next.delete("create")
            setSearchParams(next, { replace: true })
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-[#E5E7EB] bg-white sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create Job</DialogTitle>
            <DialogDescription>
              Capture the job details now so the team can start organizing files and project activity.
            </DialogDescription>
          </DialogHeader>

          <JobFormFields
            values={createValues}
            onChange={updateCreateValue}
            onToggleWorkDay={toggleCreateWorkDay}
            showActualDates={false}
          />

          <DialogFooter>
            <Button
              variant="outline"
              className="border-[#E5E7EB]"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={() => void submitCreateJob()} disabled={createSubmitting}>
              {createSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Save Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export function JobSummaryPage() {
  const navigate = useNavigate()
  const { job, setJob } = useOutletContext<JobShellContext>()
  const [values, setValues] = useState<JobFormValues>(() => createJobFormValues(job))
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    setValues(createJobFormValues(job))
  }, [job])

  const updateValue = (field: keyof JobFormValues, value: string) => {
    setValues((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const toggleWorkDay = (day: string) => {
    setValues((current) => ({
      ...current,
      workDays: current.workDays.includes(day)
        ? current.workDays.filter((value) => value !== day)
        : [...current.workDays, day],
    }))
  }

  const saveChanges = async () => {
    if (!values.title.trim()) {
      toast.error("Job title is required.")
      return
    }

    setSaving(true)

    try {
      const response = await api.put<{ job: JobRecord }>(`/jobs/${job.id}`, buildJobPayload(values))
      setJob(response.data.job)
      toast.success("Job updated.")
    } catch {
      toast.error("Unable to save job changes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <SectionHeading
        title="Summary"
        description="Edit the core job record, address details, financials, and projected dates."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              className="border-red-200 text-red-600 hover:text-red-700"
              onClick={() => setDeleteOpen(true)}
            >
              Delete Job
            </Button>
            <Button onClick={() => void saveChanges()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save Changes
            </Button>
          </>
        }
      />

      <CardContent className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-[#E5E7EB] bg-[#F9FAFB] shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <MapPin className="mt-0.5 size-4 text-blue-700" />
              <div>
                <div className="text-sm font-medium text-slate-900">Location</div>
                <div className="text-sm text-slate-500">{getLocationLabel(job)}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#E5E7EB] bg-[#F9FAFB] shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <CircleDollarSign className="mt-0.5 size-4 text-blue-700" />
              <div>
                <div className="text-sm font-medium text-slate-900">Contract Price</div>
                <div className="text-sm text-slate-500">{formatCurrency(job.contractPrice)}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#E5E7EB] bg-[#F9FAFB] shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <CalendarRange className="mt-0.5 size-4 text-blue-700" />
              <div>
                <div className="text-sm font-medium text-slate-900">Projected Timeline</div>
                <div className="text-sm text-slate-500">
                  {formatDate(job.projectedStart)} to {formatDate(job.projectedCompletion)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <JobFormFields
          values={values}
          onChange={updateValue}
          onToggleWorkDay={toggleWorkDay}
          showActualDates
        />
      </CardContent>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="border-[#E5E7EB] bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>
              This archives the job and moves its folders and files out of active views.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#E5E7EB]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await api.delete(`/jobs/${job.id}`)
                  toast.success("Job deleted.")
                  navigate("/jobs")
                } catch {
                  toast.error("Unable to delete this job.")
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export function FilesDocumentsPage() {
  return <FileManagerPage mediaType="document" />
}

export function FilesPhotosPage() {
  return <FileManagerPage mediaType="photo" />
}

export function FilesVideosPage() {
  return <FileManagerPage mediaType="video" />
}
