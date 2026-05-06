import { Building2 } from "lucide-react"
import { useDocumentTitle } from "@/hooks/use-document-title"

export default function CompanySection() {
  useDocumentTitle("Company · Settings")

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center gap-2.5">
          <Building2 className="size-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">Company defaults</h2>
        </div>

        <div className="px-6 py-6 space-y-4">
          <p className="text-sm text-slate-600">
            Workspace-wide defaults that apply to new jobs, schedules, and daily logs. Only
            admins can change these.
          </p>
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-700">Coming soon</p>
            <p className="mt-1 text-xs text-slate-500">
              Company name, default working days, default schedule colors, and default daily-log
              custom fields will live here once their schema lands. We're keeping this slot ready.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
