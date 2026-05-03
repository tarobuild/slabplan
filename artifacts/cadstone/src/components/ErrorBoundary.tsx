// Default React import is only required by the classic JSX transform
// (used by the `tsx --test` runner via Node's loader). Vite uses the
// automatic runtime in production where this import is a no-op.
import React, { Component, type ErrorInfo, type ReactNode } from "react"
void React
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
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
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App ErrorBoundary caught an error", error, info)
    // Best-effort error reporting. We swallow any failure (the endpoint
    // may not exist in every environment) so reporting can never itself
    // crash the boundary.
    try {
      const payload = JSON.stringify({
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
        componentStack: info?.componentStack ?? null,
        url: typeof window !== "undefined" ? window.location.href : null,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        ts: new Date().toISOString(),
      })
      if (typeof fetch === "function") {
        void fetch("/api/_client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
