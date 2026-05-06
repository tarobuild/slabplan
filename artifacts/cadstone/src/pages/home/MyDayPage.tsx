import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { CalendarDays, CheckCircle2, ClipboardList, CloudSun, MapPin } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { CrewForecast, CrewHome } from "./types"

function formatTime(t: string | null): string | null {
  if (!t) return null
  // schedule_items.start_time is "HH:MM:SS" — render as "h:mm AM"
  const [h, m] = t.split(":").map(Number)
  if (Number.isNaN(h)) return null
  const ampm = h >= 12 ? "PM" : "AM"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`
}

const FORECAST_TTL_MS = 60 * 60 * 1000
const DEVICE_FORECAST_STORAGE_KEY = "cadstone:home:deviceForecast"

type DeviceForecastState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: CrewForecast; fetchedAt: number }
  | { status: "error" }

function readStoredDeviceForecast(): DeviceForecastState {
  if (typeof window === "undefined") return { status: "idle" }
  try {
    const raw = window.sessionStorage.getItem(DEVICE_FORECAST_STORAGE_KEY)
    if (!raw) return { status: "idle" }
    const parsed = JSON.parse(raw) as { fetchedAt?: number; data?: CrewForecast }
    if (
      typeof parsed.fetchedAt === "number" &&
      parsed.data &&
      Date.now() - parsed.fetchedAt < FORECAST_TTL_MS
    ) {
      return { status: "ok", fetchedAt: parsed.fetchedAt, data: parsed.data }
    }
  } catch {
    // Corrupt storage — fall through to a fresh fetch.
  }
  return { status: "idle" }
}

function writeStoredDeviceForecast(data: CrewForecast, fetchedAt: number) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      DEVICE_FORECAST_STORAGE_KEY,
      JSON.stringify({ data, fetchedAt }),
    )
  } catch {
    // Storage may be disabled (private mode, quota, etc.) — non-fatal.
  }
}

export default function MyDayPage({ data }: { data: CrewHome }) {
  const { schedule, todos, weather, forecast, latestLog, today } = data
  const hasWork = schedule.items.length > 0 || todos.length > 0
  const deviceForecast = useDeviceForecastFallback(forecast)
  const activeForecast = forecast ?? (deviceForecast.status === "ok" ? deviceForecast.data : null)

  return (
    <div className="space-y-5" data-testid="home-my-day">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My Day</h1>
        <p className="mt-1 text-sm text-slate-500">{prettyDate(today)}</p>
      </div>

      {activeForecast ? (
        <ForecastStrip forecast={activeForecast} source={forecast ? "job" : "device"} />
      ) : weather ? (
        <Card className="border-[#E5E7EB] bg-gradient-to-r from-sky-50 to-white">
          <CardContent className="flex items-center gap-3 py-3 text-sm">
            <CloudSun className="size-5 text-sky-600" />
            <div className="flex-1">
              <p className="font-medium text-slate-900">
                Latest weather log{weather.jobTitle ? ` — ${weather.jobTitle}` : ""}
              </p>
              <p className="text-slate-600">
                {summarizeWeather(weather.weatherData) ||
                  weather.weatherNotes ||
                  "No weather details captured yet."}
              </p>
            </div>
            <span className="text-xs text-slate-500">{weather.logDate}</span>
          </CardContent>
        </Card>
      ) : deviceForecast.status === "loading" ? (
        <ForecastPlaceholder text="Checking today's weather…" />
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="border-[#E5E7EB]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4 text-orange-600" />
              Today's schedule
            </CardTitle>
            <Badge variant="secondary">{schedule.items.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {schedule.items.length === 0 ? (
              <EmptyHint>You have no scheduled work for today.</EmptyHint>
            ) : (
              schedule.items.map((item) => (
                <Link
                  key={item.id}
                  to={`/jobs/${item.jobId}/schedule`}
                  data-testid="home-schedule-item"
                  className="block rounded-lg border border-[#E5E7EB] p-3 transition hover:border-orange-300 hover:bg-orange-50/40"
                >
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1 inline-block size-2 rounded-full"
                      style={{ backgroundColor: item.displayColor }}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">{item.title}</p>
                        {formatTime(item.startTime) ? (
                          <span className="text-xs text-slate-500">
                            {formatTime(item.startTime)}
                            {formatTime(item.endTime) ? ` – ${formatTime(item.endTime)}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.jobTitle ?? "Untitled job"}
                      </p>
                      {item.jobAddress || item.jobCity ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="size-3" />
                          {[item.jobAddress, item.jobCity, item.jobState]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      ) : null}
                      {item.progress > 0 || item.isComplete ? (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                item.isComplete ? "bg-emerald-500" : "bg-orange-500",
                              )}
                              style={{ width: `${item.isComplete ? 100 : item.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {item.isComplete ? "Done" : `${item.progress}%`}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-[#E5E7EB]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="size-4 text-orange-600" />
              My todos
            </CardTitle>
            <Badge variant="secondary">{todos.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {todos.length === 0 ? (
              <EmptyHint>Nothing on your plate. Nice.</EmptyHint>
            ) : (
              todos.map((todo) => (
                <Link
                  key={todo.id}
                  to={todo.jobId ? `/jobs/${todo.jobId}/schedule` : "/jobs"}
                  data-testid="home-todo"
                  className="flex items-start gap-2 rounded-lg border border-[#E5E7EB] p-3 transition hover:border-orange-300 hover:bg-orange-50/40"
                >
                  <CheckCircle2
                    className={cn(
                      "mt-0.5 size-4",
                      todo.isComplete ? "text-emerald-500" : "text-slate-300",
                    )}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{todo.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {todo.jobTitle ?? "Personal"}
                      {todo.scheduleItemTitle ? ` — ${todo.scheduleItemTitle}` : ""}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {!hasWork ? (
        <Card className="border-[#E5E7EB]">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            No assignments today.{" "}
            {latestLog ? (
              <>
                Last activity:{" "}
                <Link
                  to={`/jobs/${latestLog.jobId}/daily-logs`}
                  className="text-orange-600 hover:underline"
                >
                  {latestLog.title || latestLog.jobTitle || "daily log"}
                </Link>
                .
              </>
            ) : (
              "Browse your jobs to find something to do."
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function ForecastStrip({
  forecast,
  source,
}: {
  forecast: CrewForecast
  source: "job" | "device"
}) {
  const high = forecast.temperatureHigh
  const low = forecast.temperatureLow
  const tempLabel =
    high !== null && low !== null
      ? `H ${Math.round(high)}° · L ${Math.round(low)}°F`
      : high !== null
        ? `${Math.round(high)}°F`
        : low !== null
          ? `${Math.round(low)}°F`
          : null
  const where =
    source === "job"
      ? forecast.jobTitle || forecast.address || "Today's job site"
      : "Your current location"

  return (
    <Card
      className="border-[#E5E7EB] bg-gradient-to-r from-sky-50 to-white"
      data-testid="home-weather-forecast"
    >
      <CardContent className="flex items-center gap-3 py-3 text-sm">
        <CloudSun className="size-5 text-sky-600" />
        <div className="flex-1">
          <p className="font-medium text-slate-900">{forecast.condition} — {where}</p>
          <p className="text-slate-600">
            {[
              tempLabel,
              forecast.windMph !== null ? `${forecast.windMph} mph wind` : null,
              forecast.precipitation > 0
                ? `${forecast.precipitation.toFixed(2)}″ precip`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Forecast available"}
          </p>
        </div>
        <span className="text-xs text-slate-500">Today</span>
      </CardContent>
    </Card>
  )
}

function ForecastPlaceholder({ text }: { text: string }) {
  return (
    <Card className="border-[#E5E7EB] bg-gradient-to-r from-slate-50 to-white">
      <CardContent className="flex items-center gap-3 py-3 text-sm text-slate-500">
        <CloudSun className="size-5 text-slate-400" />
        {text}
      </CardContent>
    </Card>
  )
}

function useDeviceForecastFallback(serverForecast: CrewForecast | null): DeviceForecastState {
  const [state, setState] = useState<DeviceForecastState>(() => readStoredDeviceForecast())

  useEffect(() => {
    if (serverForecast) return
    if (typeof navigator === "undefined" || !navigator.geolocation) return
    if (state.status === "ok" && Date.now() - state.fetchedAt < FORECAST_TTL_MS) return
    if (state.status === "loading") return

    let cancelled = false
    setState({ status: "loading" })

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await api.get<{ weather: Omit<CrewForecast, "jobId" | "jobTitle" | "address"> }>(
            "/weather",
            {
              params: {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              },
            },
          )
          if (cancelled) return
          const fetchedAt = Date.now()
          const data: CrewForecast = {
            jobId: "",
            jobTitle: null,
            address: "",
            ...res.data.weather,
          }
          writeStoredDeviceForecast(data, fetchedAt)
          setState({ status: "ok", fetchedAt, data })
        } catch {
          if (!cancelled) setState({ status: "error" })
        }
      },
      () => {
        if (!cancelled) setState({ status: "error" })
      },
      { maximumAge: FORECAST_TTL_MS, timeout: 10000 },
    )

    return () => {
      cancelled = true
    }
    // We intentionally only re-run when the server-side forecast becomes
    // unavailable; the cached `state` lets us avoid re-prompting for location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverForecast])

  return state
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-[#E5E7EB] p-3 text-center text-xs text-slate-500">{children}</p>
}

function prettyDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

function summarizeWeather(data: Record<string, unknown> | null): string {
  if (!data || typeof data !== "object") return ""
  const tempF = pickNumber(data, ["tempF", "temperatureF", "temperature_f"])
  const condition = pickString(data, ["condition", "summary", "description"])
  const parts: string[] = []
  if (condition) parts.push(condition)
  if (tempF !== null) parts.push(`${Math.round(tempF)}°F`)
  return parts.join(" · ")
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return null
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.length > 0) return v
  }
  return null
}
