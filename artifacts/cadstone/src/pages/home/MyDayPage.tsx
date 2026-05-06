import { Link } from "react-router-dom"
import { CalendarDays, CheckCircle2, ClipboardList, CloudSun, MapPin } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { CrewHome } from "./types"

function formatTime(t: string | null): string | null {
  if (!t) return null
  // schedule_items.start_time is "HH:MM:SS" — render as "h:mm AM"
  const [h, m] = t.split(":").map(Number)
  if (Number.isNaN(h)) return null
  const ampm = h >= 12 ? "PM" : "AM"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`
}

export default function MyDayPage({ data }: { data: CrewHome }) {
  const { schedule, todos, weather, latestLog, today } = data
  const hasWork = schedule.items.length > 0 || todos.length > 0

  return (
    <div className="space-y-5" data-testid="home-my-day">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My Day</h1>
        <p className="mt-1 text-sm text-slate-500">{prettyDate(today)}</p>
      </div>

      {weather ? (
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
