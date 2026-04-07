import { useEffect, useMemo, useRef, useState } from "react"
import {
  CloudSun,
  Filter,
  HelpCircle,
  MoreHorizontal,
  Plus,
  Printer,
  Settings2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { useOutletContext, useSearchParams } from "react-router-dom"
import { api } from "@/lib/api"
import {
  apiErrorMessage,
  draftStatusClass,
  formatDate,
  formatDateTime,
  JobShellContext,
  type PaginationMeta,
  titleCaseStatus,
  truncateText,
  type UserOption,
} from "@/feature-utils"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

type DailyLogListItem = {
  id: string
  jobId: string | null
  logDate: string
  title: string | null
  notes: string
  weatherData: Record<string, unknown> | null
  includeWeather: boolean | null
  includeWeatherNotes: boolean | null
  weatherNotes: string | null
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
  status: "draft" | "published"
}

type DailyLogDetail = {
  id: string
  jobId: string | null
  logDate: string
  title: string | null
  notes: string
  weatherData: Record<string, unknown> | null
  includeWeather: boolean | null
  includeWeatherNotes: boolean | null
  weatherNotes: string | null
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
  notifyUsers: UserOption[]
  tags: string[]
  attachments: Array<{
    id: string
    fileId: string
    originalName: string
    fileUrl: string | null
    fileSize: number | null
    mimeType: string | null
    createdAt: string
    uploadedByName: string | null
  }>
  status: "draft" | "published"
}

type WeatherState = {
  condition: string
  temperatureHigh: number | null
  temperatureLow: number | null
  windMph: number | null
  humidity: number | null
  precipitation: number | null
}

type DailyLogFormState = {
  logDate: string
  title: string
  notes: string
  tagsInput: string
  shareInternalUsers: boolean
  shareSubsVendors: boolean
  shareClient: boolean
  isPrivate: boolean
  notifyUserIds: string[]
  includeWeather: boolean
  includeWeatherNotes: boolean
  weatherNotes: string
  weatherData: WeatherState | null
}

const defaultPagination: PaginationMeta = {
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 1,
}

function defaultForm(date: string): DailyLogFormState {
  return {
    logDate: date,
    title: "",
    notes: "",
    tagsInput: "",
    shareInternalUsers: true,
    shareSubsVendors: false,
    shareClient: false,
    isPrivate: false,
    notifyUserIds: [],
    includeWeather: true,
    includeWeatherNotes: false,
    weatherNotes: "",
    weatherData: null,
  }
}

function formFromLog(log: DailyLogDetail): DailyLogFormState {
  return {
    logDate: log.logDate,
    title: log.title || "",
    notes: log.notes,
    tagsInput: log.tags.join(", "),
    shareInternalUsers: !!log.shareInternalUsers,
    shareSubsVendors: !!log.shareSubsVendors,
    shareClient: !!log.shareClient,
    isPrivate: !!log.isPrivate,
    notifyUserIds: log.notifyUserIds,
    includeWeather: !!log.includeWeather,
    includeWeatherNotes: !!log.includeWeatherNotes,
    weatherNotes: log.weatherNotes || "",
    weatherData: (log.weatherData as WeatherState | null) || null,
  }
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-[#E5E7EB] bg-white shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <CloudSun className="size-6 text-slate-400" />
        <div className="space-y-1">
          <h3 className="font-semibold text-slate-950">{title}</h3>
          <p className="max-w-md text-sm text-slate-500">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function normalizeWeatherData(data: Record<string, unknown> | null): WeatherState | null {
  if (!data) {
    return null
  }

  return {
    condition: typeof data.condition === "string" ? data.condition : "Unavailable",
    temperatureHigh: typeof data.temperatureHigh === "number" ? data.temperatureHigh : null,
    temperatureLow: typeof data.temperatureLow === "number" ? data.temperatureLow : null,
    windMph: typeof data.windMph === "number" ? data.windMph : null,
    humidity: typeof data.humidity === "number" ? data.humidity : null,
    precipitation:
      typeof data.precipitation === "number" ? data.precipitation : null,
  }
}

async function fetchWeatherForJob(job: JobShellContext["job"]): Promise<WeatherState | null> {
  const apiKey = import.meta.env.VITE_OPENWEATHERMAP_API_KEY

  if (!apiKey || !job.city || !job.state) {
    return null
  }

  const location = [job.city, job.state, "US"].filter(Boolean).join(",")
  const url = new URL("https://api.openweathermap.org/data/2.5/weather")
  url.searchParams.set("q", location)
  url.searchParams.set("units", "imperial")
  url.searchParams.set("appid", apiKey)

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error("Weather unavailable.")
  }

  const data = (await response.json()) as {
    weather?: Array<{ main?: string; description?: string }>
    main?: { temp_max?: number; temp_min?: number; humidity?: number }
    wind?: { speed?: number }
    rain?: { "1h"?: number }
    snow?: { "1h"?: number }
  }

  return {
    condition: data.weather?.[0]?.description || data.weather?.[0]?.main || "Unavailable",
    temperatureHigh: typeof data.main?.temp_max === "number" ? data.main.temp_max : null,
    temperatureLow: typeof data.main?.temp_min === "number" ? data.main.temp_min : null,
    windMph: typeof data.wind?.speed === "number" ? data.wind.speed : null,
    humidity: typeof data.main?.humidity === "number" ? data.main.humidity : null,
    precipitation:
      typeof data.rain?.["1h"] === "number"
        ? data.rain["1h"]
        : typeof data.snow?.["1h"] === "number"
          ? data.snow["1h"]
          : null,
  }
}

function DailyLogDialog({
  open,
  onOpenChange,
  item,
  job,
  users,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: DailyLogListItem | null
  job: JobShellContext["job"]
  users: UserOption[]
  onSaved: () => Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const skipAutosaveRef = useRef(true)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentLog, setCurrentLog] = useState<DailyLogDetail | null>(null)
  const [values, setValues] = useState<DailyLogFormState>(defaultForm(new Date().toISOString().slice(0, 10)))
  const [weatherMessage, setWeatherMessage] = useState("")
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    kind: "attachment" | "log"
    id: string
    label: string
  } | null>(null)

  async function refreshCurrentLog(id: string) {
    const { data } = await api.get<{ log: DailyLogDetail }>(`/daily-logs/${id}`)
    setCurrentLog({
      ...data.log,
      weatherData: normalizeWeatherData(data.log.weatherData),
    })
    return data.log
  }

  useEffect(() => {
    if (!open) {
      setCurrentLog(null)
      setValues(defaultForm(new Date().toISOString().slice(0, 10)))
      setWeatherMessage("")
      setWeatherLoading(false)
      return
    }

    skipAutosaveRef.current = true

    if (!item) {
      setCurrentLog(null)
      setValues(defaultForm(new Date().toISOString().slice(0, 10)))
      return
    }

    let active = true
    setLoading(true)

    void api
      .get<{ log: DailyLogDetail }>(`/daily-logs/${item.id}`)
      .then((response) => {
        if (!active) {
          return
        }

        setCurrentLog({
          ...response.data.log,
          weatherData: normalizeWeatherData(response.data.log.weatherData),
        })
        setValues(formFromLog({
          ...response.data.log,
          weatherData: normalizeWeatherData(response.data.log.weatherData),
        }))
      })
      .catch((error) => {
        if (active) {
          toast.error(apiErrorMessage(error, "Unable to load the daily log."))
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
  }, [item, open])

  useEffect(() => {
    if (!open || !values.includeWeather || values.weatherData || weatherLoading) {
      return
    }

    let active = true
    setWeatherLoading(true)
    setWeatherMessage("")

    void fetchWeatherForJob(job)
      .then((weather) => {
        if (!active) {
          return
        }

        if (weather) {
          setValues((current) => ({ ...current, weatherData: weather }))
        } else {
          setWeatherMessage("Weather unavailable. Add a key at VITE_OPENWEATHERMAP_API_KEY or save job city/state.")
        }
      })
      .catch(() => {
        if (active) {
          setWeatherMessage("Weather unavailable right now.")
        }
      })
      .finally(() => {
        if (active) {
          setWeatherLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [job, open, values.includeWeather, values.weatherData, weatherLoading])

  async function saveDraft(silent = false) {
    const payload = {
      logDate: values.logDate,
      title: values.title || null,
      notes: values.notes,
      weatherData: values.weatherData,
      includeWeather: values.includeWeather,
      includeWeatherNotes: values.includeWeatherNotes,
      weatherNotes: values.weatherNotes || null,
      shareInternalUsers: values.shareInternalUsers,
      shareSubsVendors: values.shareSubsVendors,
      shareClient: values.shareClient,
      isPrivate: values.isPrivate,
      notifyUserIds: values.notifyUserIds,
      tags: values.tagsInput
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    }

    if (currentLog) {
      const { data } = await api.put<{ log: DailyLogDetail }>(`/daily-logs/${currentLog.id}`, payload)
      const normalized = {
        ...data.log,
        weatherData: normalizeWeatherData(data.log.weatherData),
      }
      setCurrentLog(normalized)

      if (!silent) {
        toast.success("Draft saved.")
      }

      await onSaved()
      return normalized
    } else {
      const { data } = await api.post<{ log: DailyLogDetail }>(`/jobs/${job.id}/daily-logs`, payload)
      const normalized = {
        ...data.log,
        weatherData: normalizeWeatherData(data.log.weatherData),
      }
      setCurrentLog(normalized)

      if (!silent) {
        toast.success("Draft saved.")
      }

      await onSaved()
      return normalized
    }
  }

  useEffect(() => {
    if (!open || skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return
    }

    if (currentLog?.publishedAt) {
      return
    }

    if (!values.title.trim() && !values.notes.trim() && !values.tagsInput.trim() && !values.weatherNotes.trim()) {
      return
    }

    const timeout = window.setTimeout(() => {
      void saveDraft(true)
    }, 1200)

    return () => window.clearTimeout(timeout)
  }, [currentLog?.publishedAt, onSaved, open, values])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] max-w-[980px] overflow-y-auto border-[#E5E7EB] bg-white">
        <DialogHeader>
          <DialogTitle>{currentLog ? "Daily Log" : "Create Daily Log"}</DialogTitle>
          <DialogDescription>
            Capture notes, weather conditions, file attachments, sharing permissions, and publish state for the selected day.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-5 p-4">
            <Skeleton className="h-10 w-full" />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
              <Skeleton className="h-80 w-full" />
              <Skeleton className="h-80 w-full" />
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
              <div className="space-y-4">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-900">Job</p>
                    <p className="text-sm text-slate-500">{job.title}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Date</label>
                  <Input
                    type="date"
                    value={values.logDate}
                    className="border-[#E5E7EB]"
                    onChange={(event) => setValues((current) => ({ ...current, logDate: event.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Title</label>
                  <Input
                    value={values.title}
                    className="border-[#E5E7EB]"
                    onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Tags</label>
                  <Input
                    value={values.tagsInput}
                    className="border-[#E5E7EB]"
                    placeholder="crew, weather, delivery"
                    onChange={(event) => setValues((current) => ({ ...current, tagsInput: event.target.value }))}
                  />
                </div>

                <div className="space-y-3 rounded-lg border border-[#E5E7EB] p-4">
                  <div>
                    <h3 className="font-semibold text-slate-950">Share permissions</h3>
                    <p className="text-sm text-slate-500">Control who sees this log when it is published.</p>
                  </div>
                  {[
                    ["shareInternalUsers", "Internal Users"],
                    ["shareSubsVendors", "Subs / Vendors"],
                    ["shareClient", "Client"],
                    ["isPrivate", "Private"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-700">{label}</span>
                      <Checkbox
                        checked={values[key as keyof DailyLogFormState] as boolean}
                        onCheckedChange={(checked) =>
                          setValues((current) => ({ ...current, [key]: !!checked }))
                        }
                      />
                    </label>
                  ))}
                </div>

                <div className="space-y-3 rounded-lg border border-[#E5E7EB] p-4">
                  <div>
                    <h3 className="font-semibold text-slate-950">Notify users</h3>
                    <p className="text-sm text-slate-500">Notifications are stubbed to the server log on publish.</p>
                  </div>
                  <div className="space-y-2">
                    {users.map((user) => (
                      <label key={user.id} className="flex items-start gap-3 rounded-md px-2 py-1 hover:bg-[#F9FAFB]">
                        <Checkbox
                          checked={values.notifyUserIds.includes(user.id)}
                          onCheckedChange={(checked) =>
                            setValues((current) => ({
                              ...current,
                              notifyUserIds: checked
                                ? [...current.notifyUserIds, user.id]
                                : current.notifyUserIds.filter((item) => item !== user.id),
                            }))
                          }
                        />
                        <div>
                          <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
                          <p className="text-xs text-slate-500">{user.role.replaceAll("_", " ")}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-3 rounded-lg border border-[#E5E7EB] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-950">Attachments</h3>
                      <p className="text-sm text-slate-500">Add photos, sketches, delivery slips, or field notes.</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-[#E5E7EB]"
                        onClick={() => toast.info("Create new document is not wired yet.")}
                      >
                        Create new doc
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-[#E5E7EB]"
                        disabled={!currentLog}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="size-4" />
                        Add
                      </Button>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={async (event) => {
                      const files = Array.from(event.target.files || [])

                      if (!currentLog || files.length === 0) {
                        return
                      }

                      const formData = new FormData()
                      files.forEach((file) => formData.append("files", file))

                      try {
                        await api.post(`/daily-logs/${currentLog.id}/attachments`, formData)
                        toast.success("Attachments uploaded.")
                        await refreshCurrentLog(currentLog.id)
                        await onSaved()
                      } catch (error) {
                        toast.error(apiErrorMessage(error, "Unable to upload attachments."))
                      } finally {
                        event.target.value = ""
                      }
                    }}
                  />
                  {!currentLog ? (
                    <p className="text-sm text-slate-500">Attachments unlock after the first draft save.</p>
                  ) : currentLog.attachments.length === 0 ? (
                    <p className="text-sm text-slate-500">No attachments yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {currentLog.attachments.map((attachment) => (
                        <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] px-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-950">{attachment.originalName}</p>
                            <p className="text-xs text-slate-500">
                              {attachment.uploadedByName || "Unknown"} • {formatDateTime(attachment.createdAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="border-[#E5E7EB]"
                              onClick={() => window.open(`/api/files/${attachment.fileId}/download`, "_blank")}
                            >
                              Download
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700"
                              onClick={() =>
                                setConfirmAction({
                                  kind: "attachment",
                                  id: attachment.id,
                                  label: attachment.originalName,
                                })
                              }
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-900">Notes</label>
                  <Textarea
                    rows={8}
                    value={values.notes}
                    className="border-[#E5E7EB]"
                    onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                  />
                </div>

                <div className="space-y-4 rounded-lg border border-[#E5E7EB] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-950">Weather</h3>
                      <p className="text-sm text-slate-500">Pull conditions from OpenWeatherMap using the job location.</p>
                    </div>
                    <Checkbox
                      checked={values.includeWeather}
                      onCheckedChange={(checked) =>
                        setValues((current) => ({ ...current, includeWeather: !!checked }))
                      }
                    />
                  </div>

                  {weatherLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-slate-500">
                      <Spinner className="size-4 text-blue-600" />
                      Fetching current weather…
                    </div>
                  ) : values.includeWeather && values.weatherData ? (
                    <div className="grid gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Condition</p>
                        <p className="font-medium text-slate-950">{values.weatherData.condition}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Temp High / Low</p>
                        <p className="font-medium text-slate-950">
                          {values.weatherData.temperatureHigh ?? "—"}° / {values.weatherData.temperatureLow ?? "—"}°
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Wind</p>
                        <p className="font-medium text-slate-950">{values.weatherData.windMph ?? "—"} mph</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Humidity</p>
                        <p className="font-medium text-slate-950">{values.weatherData.humidity ?? "—"}%</p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Precipitation</p>
                        <p className="font-medium text-slate-950">{values.weatherData.precipitation ?? 0} in</p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-slate-500">
                      {weatherMessage || "Weather unavailable. Save the draft and continue without weather if needed."}
                    </div>
                  )}

                  <label className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] px-4 py-3">
                    <div>
                      <p className="font-medium text-slate-900">Include weather notes</p>
                      <p className="text-sm text-slate-500">Add commentary about site impacts or weather delays.</p>
                    </div>
                    <Switch
                      checked={values.includeWeatherNotes}
                      onCheckedChange={(checked) =>
                        setValues((current) => ({ ...current, includeWeatherNotes: checked }))
                      }
                    />
                  </label>

                  {values.includeWeatherNotes ? (
                    <Textarea
                      rows={3}
                      value={values.weatherNotes}
                      className="border-[#E5E7EB]"
                      onChange={(event) =>
                        setValues((current) => ({ ...current, weatherNotes: event.target.value }))
                      }
                    />
                  ) : null}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 flex flex-col gap-3 border-t border-[#E5E7EB] bg-white px-1 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">Daily logs are auto-saved as drafts while you work.</p>
              <div className="flex flex-wrap justify-end gap-2">
                {currentLog ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mr-auto border-red-200 text-red-600 hover:text-red-700"
                    onClick={() =>
                      setConfirmAction({
                        kind: "log",
                        id: currentLog.id,
                        label: currentLog.title || currentLog.logDate,
                      })
                    }
                  >
                    Delete
                  </Button>
                ) : null}
                {currentLog ? (
                  <Badge variant="outline" className={draftStatusClass(currentLog.status)}>
                    {titleCaseStatus(currentLog.status)}
                  </Badge>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#E5E7EB]"
                  onClick={async () => {
                    setSaving(true)

                    try {
                      await saveDraft(false)
                    } catch (error) {
                      toast.error(apiErrorMessage(error, "Unable to save this draft."))
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  {saving ? <Spinner className="size-4" /> : null}
                  Save as Draft
                </Button>
                <Button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true)

                    try {
                      const savedLog = currentLog ?? (await saveDraft(true))
                      await api.post(`/daily-logs/${savedLog.id}/publish`)
                      toast.success("Daily log published.")
                      await refreshCurrentLog(savedLog.id)
                      await onSaved()
                    } catch (error) {
                      toast.error(apiErrorMessage(error, "Unable to publish this daily log."))
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  Publish
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>

      <AlertDialog
        open={Boolean(confirmAction)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setConfirmAction(null)
          }
        }}
      >
        <AlertDialogContent className="border-[#E5E7EB] bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.kind === "attachment" ? "Remove attachment?" : "Delete daily log?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.kind === "attachment"
                ? `${confirmAction.label} will be removed from this daily log.`
                : `${confirmAction?.label || "This daily log"} will be removed from the active log list.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#E5E7EB]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!confirmAction || !currentLog) {
                  return
                }

                try {
                  if (confirmAction.kind === "attachment") {
                    await api.delete(`/daily-logs/${currentLog.id}/attachments/${confirmAction.id}`)
                    toast.success("Attachment removed.")
                    await refreshCurrentLog(currentLog.id)
                  } else {
                    await api.delete(`/daily-logs/${currentLog.id}`)
                    toast.success("Daily log deleted.")
                    onOpenChange(false)
                  }

                  await onSaved()
                  setConfirmAction(null)
                } catch (error) {
                  toast.error(
                    apiErrorMessage(
                      error,
                      confirmAction.kind === "attachment"
                        ? "Unable to remove attachment."
                        : "Unable to delete this daily log.",
                    ),
                  )
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export function DailyLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { job } = useOutletContext<JobShellContext>()
  const [users, setUsers] = useState<UserOption[]>([])
  const [logs, setLogs] = useState<DailyLogListItem[]>([])
  const [pagination, setPagination] = useState<PaginationMeta>(defaultPagination)
  const [loading, setLoading] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [activeLog, setActiveLog] = useState<DailyLogListItem | null>(null)
  const [filters, setFilters] = useState({
    keywords: "",
    createdBy: "all",
    sharedWith: "all",
    from: "",
    to: "",
    tag: "",
  })

  async function loadUsersAndLogs(page = pagination.page) {
    setLoading(true)

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pagination.pageSize),
      })

      if (filters.keywords.trim()) {
        params.set("keywords", filters.keywords.trim())
      }

      if (filters.createdBy !== "all") {
        params.set("createdBy", filters.createdBy)
      }

      if (filters.sharedWith !== "all") {
        params.set("sharedWith", filters.sharedWith)
      }

      if (filters.from) {
        params.set("from", filters.from)
      }

      if (filters.to) {
        params.set("to", filters.to)
      }

      if (filters.tag.trim()) {
        params.set("tag", filters.tag.trim())
      }

      const [usersResponse, logsResponse] = await Promise.all([
        api.get<{ users: UserOption[] }>("/users"),
        api.get<{ logs: DailyLogListItem[]; pagination: PaginationMeta }>(`/jobs/${job.id}/daily-logs?${params.toString()}`),
      ])

      setUsers(usersResponse.data.users)
      setLogs(
        logsResponse.data.logs.map((log) => ({
          ...log,
          weatherData: normalizeWeatherData(log.weatherData),
        })),
      )
      setPagination(logsResponse.data.pagination)
    } catch (error) {
      toast.error(apiErrorMessage(error, "Unable to load daily logs."))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsersAndLogs(1)
  }, [filters, job.id])

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setActiveLog(null)
      setDialogOpen(true)
    }
  }, [searchParams])

  const activeFilterCount = useMemo(
    () =>
      [
        filters.keywords,
        filters.createdBy !== "all" ? filters.createdBy : "",
        filters.sharedWith !== "all" ? filters.sharedWith : "",
        filters.from,
        filters.to,
        filters.tag,
      ].filter(Boolean).length,
    [filters],
  )

  return (
    <>
      <Card className="border-[#E5E7EB] bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-3 border-b border-[#E5E7EB] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-xl font-semibold text-slate-950">Daily Logs</CardTitle>
            <CardDescription>
              Capture daily site notes, weather conditions, attachments, and publish state for the current job.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white text-slate-600" onClick={() => toast.info("Daily log help content is not published yet.")}>
              <HelpCircle className="size-4" />
              Help
            </Button>
            <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white text-slate-600" onClick={() => toast.info("Daily log settings are not configured yet.")}>
              <Settings2 className="size-4" />
              Settings
            </Button>
            <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white text-slate-600" onClick={() => window.print()}>
              <Printer className="size-4" />
              Print
            </Button>
            <Button type="button" variant="outline" className="h-9 border-[#E5E7EB] bg-white text-slate-600" onClick={() => setFilterOpen(true)}>
              <Filter className="size-4" />
              Filter
              {activeFilterCount > 0 ? (
                <Badge variant="outline" className="ml-1 border-blue-200 bg-blue-50 text-blue-700">
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setActiveLog(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="size-4" />
              Daily Log
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 p-6">
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="border-[#E5E7EB] shadow-none">
                  <CardContent className="space-y-3 p-5">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-12 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <EmptyPanel title="No daily logs yet" description="Create the first log to record site conditions, notes, and shared updates for this job." />
          ) : (
            <>
              <div className="space-y-4">
                {logs.map((log) => (
                  <button
                    key={log.id}
                    type="button"
                    className="w-full rounded-lg border border-[#E5E7EB] bg-white p-5 text-left transition hover:bg-[#F9FAFB]"
                    onClick={() => {
                      setActiveLog(log)
                      setDialogOpen(true)
                    }}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-slate-950">{log.title || `Daily Log • ${formatDate(log.logDate)}`}</h3>
                          <Badge variant="outline" className={draftStatusClass(log.status)}>
                            {titleCaseStatus(log.status)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                          <span>{formatDate(log.logDate)}</span>
                          <span>Created by {log.createdByName || "Unknown"}</span>
                          <span>{log.attachmentCount} attachment(s)</span>
                        </div>
                        <p className="max-w-3xl text-sm text-slate-600">{truncateText(log.notes)}</p>
                        <div className="flex flex-wrap gap-2">
                          {log.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="border-[#E5E7EB] bg-[#F9FAFB] text-slate-600">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-[#E5E7EB] bg-white"
                          onClick={(event) => {
                            event.stopPropagation()
                            setActiveLog(log)
                            setDialogOpen(true)
                          }}
                        >
                          Open
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" className="border-[#E5E7EB] bg-white" onClick={(event) => event.stopPropagation()}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={async () => {
                                try {
                                  await api.post(`/daily-logs/${log.id}/publish`)
                                  toast.success("Daily log published.")
                                  await loadUsersAndLogs(pagination.page)
                                } catch (error) {
                                  toast.error(apiErrorMessage(error, "Unable to publish this daily log."))
                                }
                              }}
                            >
                              Publish
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-sm text-slate-500">
                  Page {pagination.page} of {pagination.totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-[#E5E7EB] bg-white"
                    disabled={pagination.page <= 1}
                    onClick={() => void loadUsersAndLogs(pagination.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-[#E5E7EB] bg-white"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => void loadUsersAndLogs(pagination.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="right" className="w-full max-w-md border-[#E5E7EB] bg-white">
          <SheetHeader>
            <SheetTitle>Daily Log Filters</SheetTitle>
            <SheetDescription>Refine logs by creator, permissions, date, keyword, and tags.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Keywords</label>
              <Input value={filters.keywords} className="border-[#E5E7EB]" onChange={(event) => setFilters((current) => ({ ...current, keywords: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Created by</label>
              <Select value={filters.createdBy} onValueChange={(value) => setFilters((current) => ({ ...current, createdBy: value }))}>
                <SelectTrigger className="border-[#E5E7EB]">
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
              <label className="text-sm font-medium text-slate-900">Shared with</label>
              <Select value={filters.sharedWith} onValueChange={(value) => setFilters((current) => ({ ...current, sharedWith: value }))}>
                <SelectTrigger className="border-[#E5E7EB]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All visibility settings</SelectItem>
                  <SelectItem value="internal">Internal Users</SelectItem>
                  <SelectItem value="subs_vendors">Subs / Vendors</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">From</label>
                <Input type="date" value={filters.from} className="border-[#E5E7EB]" onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900">To</label>
                <Input type="date" value={filters.to} className="border-[#E5E7EB]" onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">Tags</label>
              <Input value={filters.tag} className="border-[#E5E7EB]" onChange={(event) => setFilters((current) => ({ ...current, tag: event.target.value }))} />
            </div>
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-[#E5E7EB]"
                onClick={() =>
                  setFilters({
                    keywords: "",
                    createdBy: "all",
                    sharedWith: "all",
                    from: "",
                    to: "",
                    tag: "",
                  })
                }
              >
                Clear all
              </Button>
              <Button type="button" onClick={() => setFilterOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <DailyLogDialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen)

          if (!nextOpen) {
            setActiveLog(null)
          }

          if (!nextOpen && searchParams.get("create") === "1") {
            const next = new URLSearchParams(searchParams)
            next.delete("create")
            setSearchParams(next, { replace: true })
          }
        }}
        item={activeLog}
        job={job}
        users={users}
        onSaved={async () => {
          await loadUsersAndLogs(pagination.page)
        }}
      />
    </>
  )
}
