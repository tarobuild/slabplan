import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { APP_NAME } from "@/lib/brand"

declare const __APP_RELEASE_SHA__: string

const APP_UPDATE_POLL_INTERVAL_MS = 60_000

type HealthzResponse = {
  releaseSha?: string | null
}

export function getCurrentAppReleaseSha(): string {
  return typeof __APP_RELEASE_SHA__ === "string" ? __APP_RELEASE_SHA__ : ""
}

export function isNewerReleaseAvailable(
  currentReleaseSha: string,
  liveReleaseSha: string | null | undefined,
): boolean {
  return Boolean(currentReleaseSha && liveReleaseSha && currentReleaseSha !== liveReleaseSha)
}

export async function fetchLiveReleaseSha(signal?: AbortSignal): Promise<string | null> {
  const response = await fetch("/api/healthz", {
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
    signal,
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as HealthzResponse
  return typeof data.releaseSha === "string" && data.releaseSha ? data.releaseSha : null
}

export function AppUpdateNotice() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    const currentReleaseSha = getCurrentAppReleaseSha()
    if (!currentReleaseSha || typeof window === "undefined") {
      return
    }

    let disposed = false
    let checking = false
    let controller: AbortController | null = null

    async function checkForUpdate() {
      if (disposed || checking) return

      checking = true
      controller?.abort()
      controller = new AbortController()

      try {
        const liveReleaseSha = await fetchLiveReleaseSha(controller.signal)
        if (!disposed && isNewerReleaseAvailable(currentReleaseSha, liveReleaseSha)) {
          setUpdateAvailable(true)
        }
      } catch {
        // Network failures should never interrupt active work.
      } finally {
        checking = false
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate()
      }
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkForUpdate()
      }
    }, APP_UPDATE_POLL_INTERVAL_MS)

    window.addEventListener("focus", checkWhenVisible)
    window.addEventListener("online", checkWhenVisible)
    document.addEventListener("visibilitychange", checkWhenVisible)
    void checkForUpdate()

    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(interval)
      window.removeEventListener("focus", checkWhenVisible)
      window.removeEventListener("online", checkWhenVisible)
      document.removeEventListener("visibilitychange", checkWhenVisible)
    }
  }, [])

  if (!updateAvailable) {
    return null
  }

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-xl items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <span className="font-medium">A {APP_NAME} update is available.</span>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Reload
      </button>
    </div>
  )
}
