import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate } from "react-router-dom"
import {
  Briefcase,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
  UserPlus,
  X,
} from "lucide-react"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type SearchResultType = "job" | "lead" | "file" | "schedule"

type SearchResult = {
  id: string
  type: SearchResultType
  title: string
  subtitle?: string
  href: string
}

type SearchResponse = {
  results: SearchResult[]
  pagination: { page: number; pageSize: number; hasMore: boolean }
}

const PAGE_SIZE = 10
const MIN_QUERY_LENGTH = 2

const TYPE_META: Record<
  SearchResultType,
  { label: string; icon: typeof Search; tone: string }
> = {
  job: {
    label: "Job",
    icon: Briefcase,
    tone: "bg-orange-100 text-orange-700",
  },
  lead: {
    label: "Lead",
    icon: UserPlus,
    tone: "bg-blue-100 text-blue-700",
  },
  file: {
    label: "File",
    icon: FileText,
    tone: "bg-emerald-100 text-emerald-700",
  },
  schedule: {
    label: "Schedule",
    icon: CalendarClock,
    tone: "bg-violet-100 text-violet-700",
  },
}

function getApiErrorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err)) {
    const message = (err.response?.data as { message?: string } | undefined)
      ?.message
    if (typeof message === "string" && message.length > 0) {
      return message
    }
  }

  if (err instanceof Error && err.message) {
    return err.message
  }

  return fallback
}

type GlobalSearchProps = {
  /**
   * Visual treatment for the input.
   * - "topbar" (default): dark glass styling for the desktop top bar.
   * - "panel": light styling for use inside a sheet/modal (mobile).
   */
  variant?: "topbar" | "panel"
  /**
   * When true, focuses the input on mount. Used by the mobile sheet so the
   * keyboard pops up automatically when the search is opened.
   */
  autoFocus?: boolean
  /**
   * Called after the user picks a result and we have navigated to it. Used
   * by the mobile sheet to close itself in addition to navigating.
   */
  onResultSelected?: () => void
}

export default function GlobalSearch({
  variant = "topbar",
  autoFocus = false,
  onResultSelected,
}: GlobalSearchProps = {}) {
  const navigate = useNavigate()
  const inputId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isPanel = variant === "panel"

  // In the panel variant the dropdown is always visible (the sheet provides
  // the open/close affordance). In the top-bar variant the dropdown opens on
  // focus and closes on outside click / Escape.
  const [open, setOpen] = useState(isPanel)
  const [rawQuery, setRawQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [page, setPage] = useState(1)
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedQuery = useMemo(() => debouncedQuery.trim(), [debouncedQuery])
  const queryReady = trimmedQuery.length >= MIN_QUERY_LENGTH

  // Auto-focus the input on mount when requested (mobile sheet).
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  // Debounce the query and reset to page 1 when the user types something new.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(rawQuery)
      setPage(1)
    }, 250)

    return () => {
      window.clearTimeout(handle)
    }
  }, [rawQuery])

  // Fetch results whenever the debounced query or page changes while open.
  useEffect(() => {
    if (!open) return
    if (!queryReady) {
      setResponse(null)
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api
      .get<SearchResponse>("/search", {
        params: { q: trimmedQuery, page, pageSize: PAGE_SIZE },
        signal: controller.signal,
      })
      .then((res) => {
        setResponse(res.data)
      })
      .catch((err: unknown) => {
        if (isAxiosError(err) && err.code === "ERR_CANCELED") {
          return
        }
        setResponse(null)
        setError(getApiErrorMessage(err, "Could not load search results."))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [open, trimmedQuery, queryReady, page])

  // Close on outside click — top-bar variant only. In panel mode the parent
  // sheet handles dismiss.
  useEffect(() => {
    if (isPanel) return
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (containerRef.current && containerRef.current.contains(target)) {
        return
      }
      setOpen(false)
    }

    window.addEventListener("mousedown", handlePointerDown)
    return () => {
      window.removeEventListener("mousedown", handlePointerDown)
    }
  }, [isPanel, open])

  // Close on Escape — top-bar variant only.
  useEffect(() => {
    if (isPanel) return
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isPanel, open])

  const goToResult = useCallback(
    (result: SearchResult) => {
      if (!isPanel) {
        setOpen(false)
      }
      navigate(result.href)
      onResultSelected?.()
    },
    [isPanel, navigate, onResultSelected],
  )

  const handleClear = useCallback(() => {
    setRawQuery("")
    setDebouncedQuery("")
    setPage(1)
    setResponse(null)
    setError(null)
    inputRef.current?.focus()
  }, [])

  const results = response?.results ?? []
  const hasMore = response?.pagination?.hasMore ?? false
  const showDropdown = open
  const showPager = queryReady && response !== null && (page > 1 || hasMore)

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full",
        isPanel ? "max-w-none" : "max-w-md",
      )}
    >
      <div className="relative">
        <Search
          className={cn(
            "pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2",
            isPanel ? "text-slate-400" : "text-white/60",
          )}
        />
        <input
          id={inputId}
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Search jobs, leads, files, schedule…"
          value={rawQuery}
          onFocus={() => {
            if (!isPanel) setOpen(true)
          }}
          onChange={(event) => {
            setRawQuery(event.target.value)
            if (!open) setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !isPanel) {
              // Browsers clear `<input type="search">` on Escape natively, but
              // we want a single Escape press to also close the dropdown so the
              // user is not left looking at a stray empty-state panel.
              event.preventDefault()
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
          aria-label="Global search"
          aria-expanded={showDropdown}
          aria-controls={`${inputId}-results`}
          className={cn(
            "w-full rounded-md pl-9 pr-9 text-sm outline-none transition-colors",
            isPanel
              ? "h-10 border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
              : "h-8 border border-white/15 bg-white/10 text-white placeholder:text-white/50 focus:border-white/40 focus:bg-white/15",
          )}
        />
        {rawQuery.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={handleClear}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1",
              isPanel
                ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                : "text-white/60 hover:bg-white/10 hover:text-white",
            )}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div
          id={`${inputId}-results`}
          role="listbox"
          className={cn(
            "z-40 overflow-hidden bg-white text-slate-900",
            isPanel
              ? "mt-3 flex flex-1 min-h-0 flex-col rounded-md border border-slate-200"
              : "absolute left-0 right-0 top-full mt-2 max-h-[28rem] rounded-md border border-slate-200 shadow-lg",
          )}
        >
          <div
            className={cn(
              "overflow-y-auto",
              isPanel ? "flex-1" : "max-h-80",
            )}
          >
            {!queryReady ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">
                Type at least {MIN_QUERY_LENGTH} characters to search
                everything you can see.
              </p>
            ) : loading && response === null ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
                <Spinner className="size-4 text-orange-600" />
                Searching…
              </div>
            ) : error ? (
              <p className="px-4 py-6 text-center text-sm text-rose-600">
                {error}
              </p>
            ) : results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                No matches for “{trimmedQuery}”.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((result) => {
                  const meta = TYPE_META[result.type]
                  const Icon = meta?.icon ?? Search
                  return (
                    <li key={`${result.type}:${result.id}`}>
                      <button
                        type="button"
                        role="option"
                        onClick={() => goToResult(result)}
                        className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded",
                            meta?.tone ?? "bg-slate-100 text-slate-600",
                          )}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900">
                              {result.title}
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              {meta?.label ?? result.type}
                            </span>
                          </span>
                          {result.subtitle ? (
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {result.subtitle}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {showPager ? (
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <span>
                Page {response?.pagination.page ?? page}
                {loading ? " • loading…" : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  Prev
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={!hasMore || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
