import { useCallback, useEffect, useState } from "react"
import { Bell, CheckCheck, Loader2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api"
import { toastApiError } from "@/lib/api-errors"
import { cn } from "@/lib/utils"

type AppNotification = {
  id: string
  title: string
  body: string | null
  url: string | null
  readAt: string | null
  createdAt: string
}

type NotificationsResponse = {
  notifications: AppNotification[]
  unreadCount: number
}

function compactTime(value: string) {
  const created = new Date(value).getTime()
  const deltaMs = Date.now() - created
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000))
  if (minutes < 1) return "Now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (options?: { quiet?: boolean }) => {
    setLoading(true)
    try {
      const response = await api.get<NotificationsResponse>("/notifications?limit=10")
      setItems(response.data.notifications)
      setUnreadCount(response.data.unreadCount)
    } catch (error: unknown) {
      if (!options?.quiet) {
        toastApiError(error, "Failed to load notifications")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      void load({ quiet: true })
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  const markRead = async (item: AppNotification) => {
    if (item.readAt) return
    await api.patch(`/notifications/${item.id}/read`)
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry,
      ),
    )
    setUnreadCount((count) => Math.max(0, count - 1))
  }

  const handleOpen = async (item: AppNotification) => {
    try {
      await markRead(item)
      if (item.url) navigate(item.url)
    } catch (error: unknown) {
      toastApiError(error, "Failed to open notification")
    }
  }

  const handleMarkAllRead = async () => {
    setSaving(true)
    try {
      await api.post("/notifications/read-all")
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => ({ ...item, readAt })))
      setUnreadCount(0)
    } catch (error: unknown) {
      toastApiError(error, "Failed to update notifications")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative ml-1 flex items-center justify-center rounded p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Open notifications"
          title="Notifications"
        >
          <Bell className="size-5" />
          {unreadCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-[#E85D04] px-1 text-center text-[10px] font-semibold leading-4 text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="mt-1 w-80 border-[#E5E7EB] p-0 shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
          <p className="text-sm font-semibold text-slate-900">Notifications</p>
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            disabled={saving || unreadCount === 0}
            className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-40"
            aria-label="Mark all notifications read"
            title="Mark all read"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
          </button>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-slate-400" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            No notifications
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto py-1">
            {items.map((item, index) => (
              <div key={item.id}>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    void handleOpen(item)
                  }}
                  className="flex cursor-pointer items-start gap-3 rounded-none px-3 py-3"
                >
                  <span
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      item.readAt ? "bg-transparent" : "bg-[#E85D04]",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {item.title}
                    </span>
                    {item.body ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-slate-500">
                        {item.body}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {compactTime(item.createdAt)}
                  </span>
                </DropdownMenuItem>
                {index < items.length - 1 ? <DropdownMenuSeparator /> : null}
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
