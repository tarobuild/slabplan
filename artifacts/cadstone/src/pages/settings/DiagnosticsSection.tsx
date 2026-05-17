import { useState } from "react"
import { Activity, CheckCircle2, Send, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { Sentry } from "@/lib/sentry"

export default function DiagnosticsSection() {
  useDocumentTitle("Diagnostics · Settings")
  const [lastEventId, setLastEventId] = useState<string | null>(null)

  function sendSentryTest() {
    const eventId = Sentry.captureException(
      new Error("SlabPlan web Sentry diagnostics test"),
      { tags: { diagnostics: "true", surface: "settings" } },
    )
    setLastEventId(eventId ?? null)
    toast.success("Diagnostic event sent")
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-[#E5E7EB] px-6 py-5">
          <Activity className="size-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">Diagnostics</h2>
        </div>

        <div className="space-y-5 px-6 py-6">
          <Alert>
            <ShieldAlert className="size-4" />
            <AlertTitle>Admin diagnostics</AlertTitle>
            <AlertDescription>
              Use this page to verify production browser monitoring without exposing
              customer data.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Browser error monitoring
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Sends a controlled test exception to the web Sentry project.
              </p>
            </div>
            <Button type="button" onClick={sendSentryTest}>
              <Send className="size-4" />
              Send test event
            </Button>
          </div>

          {lastEventId ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="size-4" />
              <span>Sent event {lastEventId.slice(0, 8)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
