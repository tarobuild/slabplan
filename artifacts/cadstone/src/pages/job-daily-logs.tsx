import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import {
  CalendarDays,
  Clock,
  Cloud,
  Loader2,
  Plus,
  Search,
  Thermometer,
  Wind,
} from "lucide-react"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

type DailyLog = {
  id: string
  logDate: string
  title: string | null
  notes: string | null
  weatherNotes: string | null
  isPrivate: boolean
  publishedAt: string | null
  createdAt: string
  createdByName: string | null
  tags: string[]
}

type Pagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

type WeatherData = {
  temperature: string
  condition: string
  windSpeed: string
  humidity: string
}

type CreateForm = {
  logDate: string
  title: string
  tags: string
  notes: string
  isPrivate: boolean
  shareInternalUsers: boolean
  shareSubsVendors: boolean
  shareClient: boolean
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function getApiError(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    return e.response?.data?.message ?? e.message ?? fallback
  }
  return fallback
}

function weatherCodeToCondition(code: number): string {
  if (code === 0) return "Clear sky"
  if (code === 1) return "Mainly clear"
  if (code === 2) return "Partly cloudy"
  if (code === 3) return "Overcast"
  if (code >= 45 && code <= 48) return "Foggy"
  if (code >= 51 && code <= 55) return "Drizzle"
  if (code >= 56 && code <= 57) return "Freezing drizzle"
  if (code >= 61 && code <= 65) return "Rainy"
  if (code >= 66 && code <= 67) return "Freezing rain"
  if (code >= 71 && code <= 75) return "Snowy"
  if (code === 77) return "Snow grains"
  if (code >= 80 && code <= 82) return "Rain showers"
  if (code >= 85 && code <= 86) return "Snow showers"
  if (code === 95) return "Thunderstorm"
  if (code >= 96 && code <= 99) return "Thunderstorm with hail"
  return "Unknown"
}

const emptyForm: CreateForm = {
  logDate: todayStr(),
  title: "",
  tags: "",
  notes: "",
  isPrivate: false,
  shareInternalUsers: true,
  shareSubsVendors: false,
  shareClient: false,
}

const emptyWeather: WeatherData = {
  temperature: "",
  condition: "",
  windSpeed: "",
  humidity: "",
}

export default function JobDailyLogsPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1,
  })
  const [keywords, setKeywords] = useState("")
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm)
  const [weather, setWeather] = useState<WeatherData>(emptyWeather)
  const [fetchingWeather, setFetchingWeather] = useState(false)
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchLogs = (kw = keywords, p = 1) => {
    if (!jobId) return
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), pageSize: "10" })
    if (kw) params.set("keywords", kw)
    api
      .get(`/jobs/${jobId}/daily-logs?${params}`)
      .then((r) => {
        setLogs(r.data.logs ?? r.data.dailyLogs ?? [])
        if (r.data.pagination) setPagination(r.data.pagination)
      })
      .catch(() => toast.error("Failed to load daily logs"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchLogs()
  }, [jobId])

  const handleSearch = (v: string) => {
    setKeywords(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchLogs(v, 1), 300)
  }

  const handlePage = (p: number) => fetchLogs(keywords, p)

  const handleFetchWeather = async () => {
    if (!jobId || !form.logDate) return
    setFetchingWeather(true)
    try {
      const { data: jobData } = await api.get(`/jobs/${jobId}`)
      const job = jobData.job ?? jobData
      const city: string | null = job.city ?? null
      const state: string | null = job.state ?? null

      if (!city && !state) {
        toast.error("Job has no city or state set. Edit the job to add a location.")
        return
      }

      const query = [city, state].filter(Boolean).join(", ")
      const geoResp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
        { headers: { "User-Agent": "CadStoneNetworks/1.0" } },
      )
      const geoData: Array<{ lat: string; lon: string }> = await geoResp.json()

      if (!geoData?.length) {
        toast.error("Could not find coordinates for this job's location.")
        return
      }

      const lat = geoData[0].lat
      const lon = geoData[0].lon

      const logDate = new Date(form.logDate + "T00:00:00")
      const now = new Date()
      const daysDiff = Math.floor(
        (now.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24),
      )

      let weatherUrl: string
      if (daysDiff > 5) {
        weatherUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${form.logDate}&end_date=${form.logDate}&daily=weathercode,temperature_2m_max,windspeed_10m_max&hourly=relativehumidity_2m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`
      } else {
        weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,windspeed_10m_max&hourly=relativehumidity_2m&start_date=${form.logDate}&end_date=${form.logDate}&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`
      }

      const wResp = await fetch(weatherUrl)
      const wData = await wResp.json()

      if (!wData.daily) {
        toast.error("No weather data available for this date and location.")
        return
      }

      const temp: number | undefined = wData.daily.temperature_2m_max?.[0]
      const windSpeed: number | undefined = wData.daily.windspeed_10m_max?.[0]
      const weatherCode: number | undefined = wData.daily.weathercode?.[0]
      const humidityArr: number[] = wData.hourly?.relativehumidity_2m ?? []
      const humidity =
        humidityArr.length > 0
          ? Math.round(humidityArr.reduce((a, b) => a + b, 0) / humidityArr.length)
          : null

      setWeather({
        temperature: temp != null ? String(Math.round(temp)) : "",
        condition: weatherCode != null ? weatherCodeToCondition(weatherCode) : "",
        windSpeed: windSpeed != null ? String(Math.round(windSpeed)) : "",
        humidity: humidity != null ? String(humidity) : "",
      })

      toast.success("Weather data loaded")
    } catch {
      toast.error("Failed to fetch weather data")
    } finally {
      setFetchingWeather(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobId) return
    setSaving(true)
    try {
      const tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)

      const hasWeather =
        weather.temperature || weather.condition || weather.windSpeed || weather.humidity

      const weatherData: Record<string, string | number> | null = hasWeather
        ? {
            temperature: weather.temperature,
            condition: weather.condition,
            windSpeed: weather.windSpeed,
            humidity: weather.humidity,
          }
        : null

      await api.post(`/jobs/${jobId}/daily-logs`, {
        logDate: form.logDate,
        title: form.title || null,
        notes: form.notes || null,
        isPrivate: form.isPrivate,
        shareInternalUsers: form.shareInternalUsers,
        shareSubsVendors: form.shareSubsVendors,
        shareClient: form.shareClient,
        weatherData,
        includeWeather: !!hasWeather,
        tags,
      })

      toast.success("Daily log created")
      setCreateOpen(false)
      setForm({ ...emptyForm, logDate: todayStr() })
      setWeather(emptyWeather)
      fetchLogs()
    } catch (err: unknown) {
      toast.error(getApiError(err, "Failed to create log"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Daily Logs</h1>
        <Button
          size="sm"
          onClick={() => {
            setForm({ ...emptyForm, logDate: todayStr() })
            setWeather(emptyWeather)
            setCreateOpen(true)
          }}
        >
          <Plus className="mr-1.5 size-3.5" />
          New Log
        </Button>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
        <Input
          value={keywords}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search logs…"
          className="pl-8 h-9"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center">
          <CalendarDays className="mx-auto mb-3 size-8 text-slate-300" />
          <p className="text-sm text-slate-400">No daily logs yet.</p>
          <button
            onClick={() => {
              setForm({ ...emptyForm, logDate: todayStr() })
              setWeather(emptyWeather)
              setCreateOpen(true)
            }}
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            Create the first one
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-lg border border-[#E5E7EB] bg-white p-4 hover:border-blue-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                      <CalendarDays className="size-3.5" />
                      {fmtDate(log.logDate)}
                    </span>
                    {log.isPrivate && (
                      <Badge
                        variant="outline"
                        className="text-xs text-slate-500 border-slate-200"
                      >
                        Private
                      </Badge>
                    )}
                    {log.publishedAt && (
                      <Badge
                        variant="outline"
                        className="text-xs text-green-700 border-green-200 bg-green-50"
                      >
                        Published
                      </Badge>
                    )}
                    {log.tags?.map((t) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className="text-xs text-blue-600 border-blue-200 bg-blue-50"
                      >
                        {t}
                      </Badge>
                    ))}
                  </div>
                  {log.title && (
                    <p className="mt-1.5 font-medium text-slate-900">{log.title}</p>
                  )}
                  {log.notes && (
                    <p className="mt-1 text-sm text-slate-600 line-clamp-2">{log.notes}</p>
                  )}
                  {log.weatherNotes && (
                    <p className="mt-1 text-xs text-slate-400 italic">{log.weatherNotes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {log.createdByName && (
                    <p className="text-xs text-slate-400">{log.createdByName}</p>
                  )}
                  <p className="text-xs text-slate-400 flex items-center gap-1 justify-end mt-0.5">
                    <Clock className="size-3" />
                    {new Date(log.createdAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && pagination.totalItems > pagination.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of{" "}
            {pagination.totalItems}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePage(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setWeather(emptyWeather)
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Daily Log</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="grid sm:grid-cols-2 gap-6 py-4">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dl-date">Log Date *</Label>
                  <Input
                    id="dl-date"
                    type="date"
                    value={form.logDate}
                    onChange={(e) => setForm((f) => ({ ...f, logDate: e.target.value }))}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dl-title">Title</Label>
                  <Input
                    id="dl-title"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Installation Day 1"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dl-tags">Tags</Label>
                  <Input
                    id="dl-tags"
                    value={form.tags}
                    onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="inspection, concrete (comma separated)"
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Sharing
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.shareInternalUsers}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, shareInternalUsers: e.target.checked }))
                      }
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-600">Share with internal team</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.shareSubsVendors}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, shareSubsVendors: e.target.checked }))
                      }
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-600">Share with subs / vendors</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.shareClient}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, shareClient: e.target.checked }))
                      }
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-600">Share with client</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isPrivate}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, isPrivate: e.target.checked }))
                      }
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-600">Private (internal only)</span>
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dl-notes">Notes</Label>
                  <Textarea
                    id="dl-notes"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Describe what happened on site today…"
                    rows={5}
                    className="resize-none"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                      <Cloud className="size-3.5" />
                      Weather
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleFetchWeather}
                      disabled={fetchingWeather || !form.logDate}
                      className="h-7 text-xs"
                    >
                      {fetchingWeather && <Loader2 className="mr-1 size-3 animate-spin" />}
                      {fetchingWeather ? "Fetching…" : "Fetch Weather"}
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1 text-slate-500">
                        <Thermometer className="size-3" />
                        Temperature (°F)
                      </Label>
                      <Input
                        value={weather.temperature}
                        onChange={(e) =>
                          setWeather((w) => ({ ...w, temperature: e.target.value }))
                        }
                        placeholder="72"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1 text-slate-500">
                        <Cloud className="size-3" />
                        Condition
                      </Label>
                      <Input
                        value={weather.condition}
                        onChange={(e) =>
                          setWeather((w) => ({ ...w, condition: e.target.value }))
                        }
                        placeholder="Partly cloudy"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1 text-slate-500">
                        <Wind className="size-3" />
                        Wind Speed (mph)
                      </Label>
                      <Input
                        value={weather.windSpeed}
                        onChange={(e) =>
                          setWeather((w) => ({ ...w, windSpeed: e.target.value }))
                        }
                        placeholder="8"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-500">Humidity (%)</Label>
                      <Input
                        value={weather.humidity}
                        onChange={(e) =>
                          setWeather((w) => ({ ...w, humidity: e.target.value }))
                        }
                        placeholder="55"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                Create Log
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
