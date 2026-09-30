import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { CalendarDays, CheckCircle2, ClipboardList, CloudSun, MapPin } from "lucide-react"
import PageHeader from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { APP_STORAGE_NAMESPACE } from "@/lib/brand"
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

export const FORECAST_TTL_MS = 60 * 60 * 1000
export const DEVICE_FORECAST_STORAGE_KEY = `${APP_STORAGE_NAMESPACE}:home:deviceForecast`

export type DeviceForecastState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: CrewForecast; fetchedAt: number }
  | { status: "error" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

export function isCrewForecast(value: unknown): value is CrewForecast {
  if (!isRecord(value)) return false
  return (
    isString(value.jobId) &&
    hasOwn(value, "jobTitle") &&
    isNullableString(value.jobTitle) &&
    isString(value.address) &&
    isString(value.condition) &&
    isString(value.icon) &&
    hasOwn(value, "temperatureHigh") &&
    isNullableFiniteNumber(value.temperatureHigh) &&
    hasOwn(value, "temperatureLow") &&
    isNullableFiniteNumber(value.temperatureLow) &&
    hasOwn(value, "windMph") &&
    isNullableFiniteNumber(value.windMph) &&
    hasOwn(value, "humidity") &&
    isNullableFiniteNumber(value.humidity) &&
    isFiniteNumber(value.precipitation) &&
    isString(value.fetchedAt)
  )
}

export function getDeviceForecastExpiryDelay(
  state: DeviceForecastState,
  now = Date.now(),
): number | null {
  if (state.status !== "ok") return null
  return Math.max(0, FORECAST_TTL_MS - (now - state.fetchedAt))
}

export function readStoredDeviceForecast(): DeviceForecastState {
  if (typeof window === "undefined") return { status: "idle" }
  try {
    const raw = window.sessionStorage.getItem(DEVICE_FORECAST_STORAGE_KEY)
    if (!raw) return { status: "idle" }
    const parsed = JSON.parse(raw) as unknown
    if (
      isRecord(parsed) &&
      typeof parsed.fetchedAt === "number" &&
      Number.isFinite(parsed.fetchedAt) &&
      isCrewForecast(parsed.data) &&
      Date.now() - parsed.fetchedAt < FORECAST_TTL_MS
    ) {
      return { status: "ok", fetchedAt: parsed.fetchedAt, data: parsed.data }
    }
  } catch {
    // Corrupt storage — fall through to a fresh fetch.
  }
  window.sessionStorage.removeItem(DEVICE_FORECAST_STORAGE_KEY)
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
  const shouldUseDeviceForecast = !forecast && !weather
  const deviceForecast = useDeviceForecastFallback(shouldUseDeviceForecast)
  const activeForecast =
    forecast ??
    (shouldUseDeviceForecast && deviceForecast.status === "ok" ? deviceForecast.data : null)

  return (
    <div data-testid="home-my-day">
      <PageHeader
        eyebrow={prettyDate(today)}
        title="My Day"
        description={
          hasWork
            ? `${[
                schedule.items.length > 0
                  ? `${schedule.items.length} stop${schedule.items.length === 1 ? "" : "s"}`
                  : null,
                todos.length > 0 ? `${todos.length} to-do${todos.length === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" and ")} today.`
            : "Nothing assigned to you today."
        }
      />

      {activeForecast ? (
        <ForecastStrip forecast={activeForecast} source={forecast ? "job" : "device"} />
      ) : weather ? (
        <div className="flex items-center gap-3 rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm">
          <CloudSun className="size-5 shrink-0 text-sky-700" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              Latest weather log{weather.jobTitle ? ` — ${weather.jobTitle}` : ""}
            </p>
            <p className="text-muted-foreground">
              {summarizeWeather(weather.weatherData) ||
                weather.weatherNotes ||
                "No weather details captured yet."}
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{weather.logDate}</span>
        </div>
      ) : deviceForecast.status === "loading" ? (
        <ForecastPlaceholder text="Checking today's weather…" />
      ) : null}

      {hasWork ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-5">
          <section className="min-w-0 lg:col-span-3">
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border pb-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <CalendarDays className="size-4 text-muted-foreground" />
                Today's schedule
              </h2>
              <span className="text-sm tabular-nums text-muted-foreground">{schedule.items.length}</span>
            </div>
            {schedule.items.length === 0 ? (
              <EmptyHint>You have no scheduled work for today.</EmptyHint>
            ) : (
              <ol className="divide-y divide-border">
                {schedule.items.map((item) => {
                  const start = formatTime(item.startTime)
                  const end = formatTime(item.endTime)
                  const address = [item.jobAddress, item.jobCity, item.jobState].filter(Boolean).join(", ")
                  return (
                    <li key={item.id}>
                      <Link
                        to={`/jobs/${item.jobId}/schedule`}
                        data-testid="home-schedule-item"
                        className="group flex gap-4 rounded-sm py-4 outline-offset-2"
                      >
                        <div className="w-16 shrink-0 pt-0.5 text-right">
                          <p className="text-sm font-semibold tabular-nums text-foreground">{start ?? "All day"}</p>
                          {start && end ? (
                            <p className="text-xs tabular-nums text-muted-foreground">{end}</p>
                          ) : null}
                        </div>
                        <span
                          aria-hidden
                          className="w-1 shrink-0 self-stretch rounded-full"
                          style={{ backgroundColor: item.displayColor }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground transition-colors group-hover:text-primary">{item.title}</p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {item.jobTitle ?? "Untitled job"}
                          </p>
                          {address ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                              <MapPin className="mt-px size-3.5 shrink-0" />
                              <span>{address}</span>
                            </p>
                          ) : null}
                          {item.progress > 0 || item.isComplete ? (
                            <div className="mt-2.5 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    item.isComplete ? "bg-emerald-500" : "bg-brand",
                                  )}
                                  style={{ width: `${item.isComplete ? 100 : item.progress}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                                {item.isComplete ? "Done" : `${item.progress}%`}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <section className="min-w-0 lg:col-span-2">
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border pb-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <ClipboardList className="size-4 text-muted-foreground" />
                My to-dos
              </h2>
              <span className="text-sm tabular-nums text-muted-foreground">{todos.length}</span>
            </div>
            {todos.length === 0 ? (
              <EmptyHint>Nothing on your list.</EmptyHint>
            ) : (
              <ul className="divide-y divide-border">
                {todos.map((todo) => (
                  <li key={todo.id}>
                    <Link
                      to={todo.jobId ? `/jobs/${todo.jobId}/schedule` : "/jobs"}
                      data-testid="home-todo"
                      className="group flex items-start gap-3 rounded-sm py-3.5 outline-offset-2"
                    >
                      <CheckCircle2
                        className={cn(
                          "mt-0.5 size-5 shrink-0",
                          todo.isComplete ? "text-emerald-600" : "text-muted-foreground/40",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "font-medium",
                            todo.isComplete ? "text-muted-foreground line-through" : "text-foreground",
                          )}
                        >
                          {todo.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {todo.jobTitle ?? "Personal"}
                          {todo.scheduleItemTitle ? ` — ${todo.scheduleItemTitle}` : ""}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        // One calm panel on a quiet day instead of two empty lists.
        <section className="mt-8">
          <div className="flex min-h-10 items-center gap-2 border-b border-border pb-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <CalendarDays className="size-4 text-muted-foreground" />
              Today's schedule
            </h2>
          </div>
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="size-6" />
            </span>
            <p className="mt-4 text-base font-semibold text-foreground">You're all clear today</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              No scheduled work or to-dos are assigned to you.
              {latestLog ? (
                <>
                  {" "}Last activity:{" "}
                  <Link
                    to={`/jobs/${latestLog.jobId}/daily-logs`}
                    className="font-medium text-primary hover:underline"
                  >
                    {latestLog.title || latestLog.jobTitle || "daily log"}
                  </Link>
                </>
              ) : null}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/jobs">Open my jobs</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/daily-logs/mine">My daily logs</Link>
              </Button>
            </div>
          </div>
        </section>
      )}
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
    <div
      className="flex items-center gap-3 rounded-lg border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm"
      data-testid="home-weather-forecast"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card text-sky-700 shadow-xs">
        <CloudSun className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{forecast.condition} — {where}</p>
        <p className="text-muted-foreground">
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
      <span className="shrink-0 text-xs font-medium text-muted-foreground">Today</span>
    </div>
  )
}

function ForecastPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <CloudSun className="size-5 text-muted-foreground/70" />
      {text}
    </div>
  )
}

function useDeviceForecastFallback(shouldFetch: boolean): DeviceForecastState {
  const [state, setState] = useState<DeviceForecastState>(() => readStoredDeviceForecast())

  useEffect(() => {
    if (!shouldFetch) return
    const expiryDelay = getDeviceForecastExpiryDelay(state)
    if (expiryDelay === null) return
    const timeout = window.setTimeout(() => {
      window.sessionStorage.removeItem(DEVICE_FORECAST_STORAGE_KEY)
      setState({ status: "idle" })
    }, expiryDelay)
    return () => window.clearTimeout(timeout)
  }, [shouldFetch, state])

  useEffect(() => {
    if (!shouldFetch) return
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
    // necessary; the cached `state` lets us avoid re-prompting for location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldFetch])

  return state
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>
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
