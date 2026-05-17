// Default React import is only required by the classic JSX transform
// (used by the `tsx --test` runner via Node's loader). Vite uses the
// automatic runtime in production where this import is a no-op.
import React, { Component, type ErrorInfo, type ReactNode } from "react"
void React
import * as Sentry from "@sentry/react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api-origin"
import { Card, CardContent } from "@/components/ui/card"

type Props = {
  children: ReactNode
  title?: string
}

type State = {
  hasError: boolean
}

/**
 * Top-level error boundary. Wraps the route tree so a thrown render
 * error doesn't blank the entire app — the user sees a recoverable
 * "Reload" / "Go home" panel and we both log the error to the console
 * and best-effort POST it to /api/_client-error for triage. Lives at
 * the App level (above <RouterProvider/>) so it also catches errors
 * raised from lazy-loaded route chunks, and again per-route inside
 * AppLayout so the shell stays navigable when one page blows up.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App ErrorBoundary caught an error", error, info)
    // Forward render errors to Sentry with the React component stack
    // attached as a context. The Sentry SDK is a no-op when init was
    // skipped (no DSN), so this is safe in every environment.
    try {
      Sentry.withScope((scope) => {
        scope.setContext("react", {
          componentStack: info?.componentStack ?? null,
        })
        Sentry.captureException(error)
      })
    } catch {
      /* swallow — Sentry must never break the boundary */
    }
    // Best-effort error reporting. We swallow any failure (the endpoint
    // may not exist in every environment) so reporting can never itself
    // crash the boundary.
    try {
      // Shape mirrors the zod schema on the server (see
      // `artifacts/api-server/src/routes/client-errors.ts`). Keep these in
      // lockstep — drift here means every reported crash 400s and the sink
      // sees nothing.
      const payload = JSON.stringify({
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
        componentStack: info?.componentStack ?? null,
        url:
          typeof window !== "undefined" && window.location?.href
            ? window.location.href
            : "unknown",
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        releaseSha:
          (import.meta as unknown as { env?: Record<string, string | undefined> })
            ?.env?.VITE_RELEASE_SHA ?? null,
      })
      if (typeof fetch === "function") {
        void fetch(apiUrl("/api/_client-error"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Required by the server's CSRF gate for state-changing requests.
            "X-Requested-With": "XMLHttpRequest",
          },
          body: payload,
          keepalive: true,
          credentials: "same-origin",
        }).catch(() => {
          /* swallow — reporting is best-effort */
        })
      }
    } catch {
      /* swallow */
    }
  }

  handleRetry = () => {
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.assign("/")
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
        <Card className="w-full max-w-md border-[#E5E7EB] shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="rounded-full border border-red-200 bg-red-50 p-3 text-red-600">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-950">
                {this.props.title || "Something went wrong"}
              </h2>
              <p className="max-w-md text-sm text-slate-500">
                The page hit an unexpected error. Reload to try again, or
                head back to the dashboard — your session and unsaved
                server-side data are unaffected.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" onClick={this.handleRetry}>
                Reload
              </Button>
              <Button type="button" variant="outline" onClick={this.handleGoHome}>
                Go home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}

export default ErrorBoundary
