import { Calculator, CalendarDays, CreditCard, Mail, Plug } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useDocumentTitle } from "@/hooks/use-document-title"

type Integration = {
  key: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  status: "connected" | "available"
  vendor: string
}

const INTEGRATIONS: Integration[] = [
  {
    key: "email",
    name: "Email delivery",
    vendor: "Resend",
    description:
      "Transactional email for invites, password resets, and (eventually) notification emails.",
    icon: Mail,
    status: "connected",
  },
  {
    key: "calendar",
    name: "Calendar",
    vendor: "Google Calendar",
    description: "Two-way sync of job schedule items with team calendars.",
    icon: CalendarDays,
    status: "available",
  },
  {
    key: "accounting",
    name: "Accounting",
    vendor: "QuickBooks",
    description: "Push invoices, payments, and contract values into QuickBooks Online.",
    icon: Calculator,
    status: "available",
  },
  {
    key: "payments",
    name: "Payments",
    vendor: "Stripe",
    description: "Accept card payments on invoices and surface paid status in Financials.",
    icon: CreditCard,
    status: "available",
  },
]

export default function IntegrationsSection() {
  useDocumentTitle("Integrations · Settings")

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center gap-2.5">
          <Plug className="size-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">Integrations</h2>
        </div>

        <div className="px-6 py-6 space-y-4">
          <p className="text-sm text-slate-600">
            Connect CAD Stone Networks to the tools your business already uses. Only admins can
            manage integrations.
          </p>

          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {INTEGRATIONS.map((integration) => {
              const Icon = integration.icon
              const isConnected = integration.status === "connected"
              return (
                <li
                  key={integration.key}
                  className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="grid size-9 place-items-center rounded-md bg-slate-100">
                        <Icon className="size-4 text-slate-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{integration.name}</p>
                        <p className="text-xs text-slate-500">{integration.vendor}</p>
                      </div>
                    </div>
                    {isConnected ? (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                        Connected
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                        Available
                      </Badge>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-slate-600 flex-1">{integration.description}</p>
                  <div className="mt-4 flex justify-end">
                    {isConnected ? (
                      <Button type="button" variant="outline" size="sm" disabled>
                        Connected
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled
                        title="Contact us to enable this integration"
                      >
                        Contact us
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
