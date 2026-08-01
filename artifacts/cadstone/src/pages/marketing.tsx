import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ClipboardCheck,
  FileStack,
  HardHat,
  Images,
  LayoutDashboard,
  LockKeyhole,
  MessageSquareText,
  ReceiptText,
  Users,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useAuthStore } from "@/store/auth"

const features = [
  {
    icon: LayoutDashboard,
    title: "One operating view",
    description:
      "See jobs, priorities, team activity, risks, and next actions without stitching together spreadsheets.",
  },
  {
    icon: Users,
    title: "Leads and clients",
    description:
      "Move opportunities into active jobs while keeping contacts, notes, scope, and history connected.",
  },
  {
    icon: CalendarDays,
    title: "Scheduling that reaches the field",
    description:
      "Coordinate crews, milestones, installs, and job-level schedules from one shared calendar.",
  },
  {
    icon: ClipboardCheck,
    title: "Daily logs and accountability",
    description:
      "Capture progress, issues, labor, weather, and field updates while the details are still fresh.",
  },
  {
    icon: Images,
    title: "Project files and media",
    description:
      "Keep documents, photos, and videos private, organized, and attached to the right customer and job.",
  },
  {
    icon: ReceiptText,
    title: "Financial workflows",
    description:
      "Track estimates, contracts, change orders, invoices, retention, and job financial progress.",
  },
  {
    icon: BarChart3,
    title: "Reports that drive action",
    description:
      "Monitor pipeline, revenue, aging, job stage, and payment velocity with export-ready reporting.",
  },
  {
    icon: Bot,
    title: "AI-assisted operations",
    description:
      "Use document parsing and an operations assistant to turn project information into faster decisions.",
  },
]

const outcomes = [
  "All SlabPlan features included",
  "Up to 25 team members",
  "Private project storage",
  "Office and field workflows",
  "AI-assisted document workflows",
  "Priority onboarding and support",
]

export default function MarketingPage() {
  useDocumentTitle("SlabPlan · Built for the stone trade")
  const user = useAuthStore((state) => state.user)
  const appHref = user ? "/dashboard" : "/register"
  const appLabel = user ? "Open SlabPlan" : "Start with SlabPlan"

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link to="/" aria-label={`${APP_NAME} home`}>
            <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-10 w-auto" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 lg:flex">
            <a href="#platform" className="transition hover:text-slate-950">Platform</a>
            <a href="#workflow" className="transition hover:text-slate-950">How it works</a>
            <a href="#pricing" className="transition hover:text-slate-950">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            {!user ? (
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link to="/login">Sign in</Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link to={appHref}>
                {appLabel}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-slate-200 bg-[#07111f] text-white">
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_75%_20%,rgba(255,102,0,.4),transparent_28%),linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:auto,44px_44px,44px_44px]" />
          <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-20 lg:grid-cols-[1.02fr_.98fr] lg:px-8 lg:py-28">
            <div className="flex flex-col justify-center">
              <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">
                <HardHat className="size-3.5" />
                Built for the stone trade
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] !text-white sm:text-6xl">
                Run every stone project from lead to final payment.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                SlabPlan brings customers, jobs, schedules, crews, field logs,
                files, financials, and reporting into one focused operating
                system.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 px-6 text-base">
                  <Link to={appHref}>
                    {appLabel}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 border-white/20 bg-white/5 px-6 text-base text-white hover:bg-white/10 hover:text-white"
                >
                  <a href="#platform">Explore the platform</a>
                </Button>
              </div>
              <p className="mt-4 text-sm text-slate-400">
                Full platform access for $250 per company, per month.
              </p>
            </div>

            <div className="relative">
              <div className="absolute -inset-8 rounded-full bg-orange-500/15 blur-3xl" />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 text-slate-950">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Operations</p>
                    <p className="mt-1 font-semibold">Today at a glance</p>
                  </div>
                  <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
                    Illustrative preview
                  </span>
                </div>
                <div className="grid gap-3 bg-slate-50 p-4 sm:grid-cols-3">
                  {[
                    ["Active jobs", "18", "+3 this month"],
                    ["This week", "12", "install milestones"],
                    ["Pipeline", "$428k", "qualified value"],
                  ].map(([label, value, detail]) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 text-slate-950">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="mt-2 text-2xl font-semibold">{value}</p>
                      <p className="mt-1 text-xs text-slate-500">{detail}</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 border-t border-slate-200 bg-white p-5 text-slate-950 sm:grid-cols-[1.1fr_.9fr]">
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">Project pulse</p>
                      <span className="text-xs text-slate-500">7-day view</span>
                    </div>
                    <div className="mt-5 flex h-40 items-end gap-2">
                      {[42, 61, 48, 78, 67, 91, 82].map((height, index) => (
                        <div key={index} className="flex flex-1 flex-col justify-end">
                          <div
                            className="rounded-t bg-orange-500"
                            style={{ height: `${height}%`, opacity: 0.45 + index * 0.07 }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-950 p-4 text-white">
                    <p className="text-sm font-semibold">Next actions</p>
                    <div className="mt-4 space-y-3">
                      {[
                        "Confirm field measurements",
                        "Review pending change order",
                        "Close today’s daily logs",
                      ].map((item) => (
                        <div key={item} className="flex gap-2 text-xs text-slate-300">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-orange-400" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">The complete platform</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
              The work stays connected from the first call to the final invoice.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Every workflow shares the same customers, jobs, team, files, and
              reporting context—so information doesn’t disappear between the
              office and the field.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, description }) => (
              <article key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex size-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[.82fr_1.18fr] lg:px-8 lg:py-28">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">One shared workflow</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
                Make the handoffs feel automatic.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                SlabPlan gives every role a focused view while the underlying
                project record stays complete.
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
              {[
                [MessageSquareText, "Capture", "Qualify a lead and preserve every customer conversation."],
                [FileStack, "Plan", "Build the job record, scope, files, and financial structure."],
                [CalendarDays, "Execute", "Coordinate the schedule, crew, field media, and daily progress."],
                [BarChart3, "Improve", "Use reporting and AI assistance to spot risks and make faster decisions."],
              ].map(([Icon, title, copy]) => {
                const StepIcon = Icon as typeof MessageSquareText
                return (
                  <div key={title as string} className="bg-white p-6">
                    <StepIcon className="size-5 text-orange-600" />
                    <h3 className="mt-4 font-semibold">{title as string}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{copy as string}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
          <div className="overflow-hidden rounded-2xl bg-[#07111f] text-white shadow-xl">
            <div className="grid lg:grid-cols-[1fr_.8fr]">
              <div className="p-8 sm:p-12">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-400">Simple pricing</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] !text-white sm:text-5xl">
                  One plan. The full platform.
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
                  Give your team one system without deciding which essential
                  workflows to leave behind.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {outcomes.map((outcome) => (
                    <div key={outcome} className="flex gap-2 text-sm text-slate-200">
                      <Check className="mt-0.5 size-4 shrink-0 text-orange-400" />
                      <span>{outcome}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-center border-t border-white/10 bg-white/5 p-8 sm:p-12 lg:border-l lg:border-t-0">
                <p className="text-sm text-slate-300">SlabPlan Full Access</p>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-5xl font-semibold">$250</span>
                  <span className="pb-1 text-slate-300">/company/month</span>
                </div>
                <p className="mt-3 text-sm text-slate-400">
                  Secure card checkout and self-serve billing through Stripe.
                </p>
                <Button asChild size="lg" className="mt-7 h-12">
                  <Link to={appHref}>
                    {appLabel}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                  <LockKeyhole className="size-3.5" />
                  SlabPlan never stores raw payment card details.
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-8 w-auto" />
          <p>© {new Date().getFullYear()} SlabPlan. Built for the stone trade.</p>
        </div>
      </footer>
    </div>
  )
}
