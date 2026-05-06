import { useEffect, useState } from "react"
import { Bell, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  useUsersGetUsersMeNotificationPrefs,
  useUsersPutUsersMeNotificationPrefs,
} from "@workspace/api-client-react"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { toastApiError } from "@/lib/api-errors"

type NotificationEvent = {
  key: string
  label: string
  description: string
  /**
   * When true, sending emails for this event isn't wired up yet — we
   * still persist the user's preference so the toggle "remembers" their
   * intent the day the backend ships.
   */
  comingSoon?: boolean
  defaultValue?: boolean
}

const EVENTS: NotificationEvent[] = [
  {
    key: "daily_log_mention",
    label: "Daily log mentions",
    description: "Email me when someone mentions me in a daily log entry.",
    defaultValue: true,
    comingSoon: true,
  },
  {
    key: "schedule_change",
    label: "Schedule changes",
    description: "Email me when a job schedule item I own changes.",
    defaultValue: true,
    comingSoon: true,
  },
  {
    key: "schedule_assignment",
    label: "Schedule assignments",
    description: "Email me when I'm newly assigned to a schedule item.",
    defaultValue: true,
    comingSoon: true,
  },
  {
    key: "invoice_paid",
    label: "Invoice paid",
    description: "Email me when a client pays an invoice I created.",
    defaultValue: true,
    comingSoon: true,
  },
  {
    key: "lead_won",
    label: "Lead won",
    description: "Email me when a lead I'm a salesperson on is marked won.",
    defaultValue: true,
    comingSoon: true,
  },
  {
    key: "weekly_summary",
    label: "Weekly summary",
    description: "Send me a Monday-morning digest of last week's activity.",
    defaultValue: false,
    comingSoon: true,
  },
]

export default function NotificationsSection() {
  useDocumentTitle("Notifications · Settings")
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const { data, isLoading: loading, error } = useUsersGetUsersMeNotificationPrefs()
  const putMutation = useUsersPutUsersMeNotificationPrefs()

  useEffect(() => {
    if (data?.prefs) setPrefs(data.prefs)
  }, [data])

  useEffect(() => {
    if (error) toastApiError(error, "Failed to load notifications")
  }, [error])

  const valueFor = (event: NotificationEvent): boolean => {
    if (Object.prototype.hasOwnProperty.call(prefs, event.key)) {
      return prefs[event.key]
    }
    return event.defaultValue ?? false
  }

  const handleToggle = async (event: NotificationEvent, next: boolean) => {
    const previous = valueFor(event)
    setPrefs((p) => ({ ...p, [event.key]: next }))
    setSavingKey(event.key)
    try {
      const result = await putMutation.mutateAsync({
        data: { prefs: { [event.key]: next } },
      })
      setPrefs(result.prefs ?? {})
      toast.success(`${event.label}: ${next ? "on" : "off"}`)
    } catch (err: unknown) {
      // Roll back optimistic state on failure.
      setPrefs((p) => ({ ...p, [event.key]: previous }))
      toastApiError(err, "Failed to update notification preference")
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
      <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center gap-2.5">
        <Bell className="size-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">Email notifications</h2>
      </div>

      <div className="px-6 py-6">
        <p className="text-sm text-slate-600">
          Control which events trigger an email to {""}
          <span className="font-medium text-slate-800">your inbox</span>. Most of these
          events are not yet sending mail — your preferences here will take effect once
          they go live.
        </p>

        {loading ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded-md bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-slate-100">
            {EVENTS.map((event) => {
              const checked = valueFor(event)
              const isSaving = savingKey === event.key
              return (
                <li
                  key={event.key}
                  className="flex items-start justify-between gap-4 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">{event.label}</p>
                      {event.comingSoon ? (
                        <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 text-[11px] font-normal">
                          Coming soon
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{event.description}</p>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    {isSaving ? (
                      <Loader2 className="size-3.5 animate-spin text-slate-400" />
                    ) : null}
                    <Switch
                      checked={checked}
                      onCheckedChange={(v) => handleToggle(event, v)}
                      disabled={isSaving}
                      aria-label={`${event.label}: ${checked ? "on" : "off"}`}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
