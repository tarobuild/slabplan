import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { useAuthStore } from "@/store/auth"

export const FOCUS_GLOBAL_SEARCH_EVENT = "cadstone:focus-global-search"

type ShortcutDef = {
  keys: string[]
  label: string
}

type ShortcutGroup = {
  heading: string
  shortcuts: ShortcutDef[]
}

// "Create a new job" is admin-only (post-#277). Non-admins don't see the
// `n` shortcut in the help overlay and the keydown handler ignores it.
function buildShortcutGroups(isAdmin: boolean): ShortcutGroup[] {
  const actions: ShortcutDef[] = [
    { keys: ["/"], label: "Focus the global search" },
  ]
  if (isAdmin) {
    actions.push({ keys: ["n"], label: "Create a new job" })
  }
  actions.push({ keys: ["?"], label: "Show this shortcut overlay" })
  return [
    {
      heading: "Navigation",
      shortcuts: [
        { keys: ["g", "d"], label: "Go to Dashboard" },
        { keys: ["g", "j"], label: "Go to Jobs" },
        { keys: ["g", "c"], label: "Go to Clients" },
        { keys: ["g", "l"], label: "Go to Leads" },
      ],
    },
    { heading: "Actions", shortcuts: actions },
  ]
}

// Returns true when the user is typing into an input-like element so we don't
// hijack their keystrokes. Accounts for shadcn Dialog/Select children which
// render with role=dialog/listbox/combobox, and contenteditable surfaces.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true

  // Shadcn Select / Combobox render their trigger as a button that is itself
  // not a typing target, but their open content is a listbox. We want
  // shortcuts to keep working from idle buttons (e.g. tab focus parked on
  // "Cancel") so we only block when an open listbox/dialog descendant has
  // focus.
  if (target.closest('[role="listbox"], [role="combobox"], [role="menu"]')) {
    return true
  }
  return false
}

// Open shadcn Dialog or AlertDialog set their `aria-hidden` on the rest of
// the page. We can detect "modal is open" by looking for an open dialog
// element so navigation shortcuts don't yank the user out of a modal flow.
function isModalOpen(): boolean {
  if (typeof document === "undefined") return false
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ),
  )
}

// Sequence buffer timeout (ms) for two-key shortcuts like `g j`.
const SEQUENCE_TIMEOUT_MS = 1200

export function KeyboardShortcuts() {
  const navigate = useNavigate()
  const isAdmin = useAuthStore((s) => s.user?.role === "admin")
  const shortcutGroups = useMemo(() => buildShortcutGroups(isAdmin), [isAdmin])
  const [helpOpen, setHelpOpen] = useState(false)
  const pendingPrefix = useRef<string | null>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPending = useCallback(() => {
    pendingPrefix.current = null
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current)
      pendingTimer.current = null
    }
  }, [])

  useEffect(() => () => clearPending(), [clearPending])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Ignore modifier-amplified keystrokes — those belong to the browser /
      // OS / other handlers (Cmd+K, Ctrl+F, etc.).
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      const key = event.key

      // `?` opens the help overlay even while a modal is open so users can
      // see what shortcuts exist; everything else respects modal focus.
      if (key === "?") {
        event.preventDefault()
        clearPending()
        setHelpOpen((current) => !current)
        return
      }

      if (isModalOpen() || helpOpen) {
        return
      }

      // Handle two-key sequences (g j, g d, g c, g l).
      if (pendingPrefix.current === "g") {
        const route =
          key === "j"
            ? "/jobs"
            : key === "d"
              ? "/dashboard"
              : key === "c"
                ? "/clients"
                : key === "l"
                  ? "/leads"
                  : null
        clearPending()
        if (route) {
          event.preventDefault()
          navigate(route)
        }
        return
      }

      if (key === "g") {
        event.preventDefault()
        pendingPrefix.current = "g"
        pendingTimer.current = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS)
        return
      }

      if (key === "/") {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent(FOCUS_GLOBAL_SEARCH_EVENT))
        return
      }

      if (key === "n" && isAdmin) {
        event.preventDefault()
        navigate("/jobs", { state: { openCreate: true } })
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [navigate, clearPending, helpOpen, isAdmin])

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-1">
          {shortcutGroups.map((group) => (
            <div key={group.heading}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {group.heading}
              </p>
              <ul className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-sm text-slate-700">
                      {shortcut.label}
                    </span>
                    <KbdGroup>
                      {shortcut.keys.map((key) => (
                        <Kbd key={key} className="border border-slate-200">
                          {key}
                        </Kbd>
                      ))}
                    </KbdGroup>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-slate-400">
            Shortcuts are disabled while you&apos;re typing in a text field or
            an open menu has focus.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default KeyboardShortcuts
