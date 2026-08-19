import { useState } from "react"
import {
  ArrowRight,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  CloudSun,
  FileImage,
  FileStack,
  HardHat,
  Images,
  LayoutDashboard,
  LockKeyhole,
  MapPin,
  MessageSquareText,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRoundCheck,
  Users,
  UsersRound,
  Wrench,
  Zap,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { useAuthStore } from "@/store/auth"
import { cn } from "@/lib/utils"

type TourKey = "pipeline" | "jobs" | "field" | "financials" | "assistant"

const tourItems: Array<{
  id: TourKey
  label: string
  eyebrow: string
  title: string
  description: string
  bullets: string[]
  icon: typeof BriefcaseBusiness
}> = [
  {
    id: "pipeline",
    label: "Leads & clients",
    eyebrow: "Win the right work",
    title: "Turn a first conversation into a ready-to-run job.",
    description:
      "Keep contacts, site details, scope, notes, files, confidence, and projected value together—then convert the opportunity without re-entering the story.",
    bullets: [
      "Track every lead from open to won",
      "Keep decision-makers and attachments connected",
      "Convert qualified work into a job record",
    ],
    icon: UsersRound,
  },
  {
    id: "jobs",
    label: "Job command",
    eyebrow: "Know what is moving",
    title: "Give every project one complete operating record.",
    description:
      "Scope, team, schedule, files, daily activity, and financial progress stay attached to the same job so office and field decisions use the same facts.",
    bullets: [
      "See project health and next milestones",
      "Move between summary, schedule, logs, and files",
      "Search active work by client or location",
    ],
    icon: BriefcaseBusiness,
  },
  {
    id: "field",
    label: "Field execution",
    eyebrow: "Capture the day",
    title: "Make daily progress visible while it is still actionable.",
    description:
      "Crews and project teams can capture weather, job notes, visibility, comments, photos, videos, and supporting files from a focused daily-log workflow.",
    bullets: [
      "Role-aware My Day views",
      "Daily logs with media and comments",
      "Schedule context that reaches the field",
    ],
    icon: ClipboardCheck,
  },
  {
    id: "financials",
    label: "Financial control",
    eyebrow: "Protect the margin",
    title: "Follow contract value through change orders and payment.",
    description:
      "Track schedules of values, invoices, payments, retention, and outstanding balances without separating project execution from the money.",
    bullets: [
      "Estimate and invoice document parsing",
      "Change-order and retention tracking",
      "A/R, revenue, and payment-speed reports",
    ],
    icon: CircleDollarSign,
  },
  {
    id: "assistant",
    label: "SlabPlan assistant",
    eyebrow: "Find the answer faster",
    title: "Ask operational questions with the project context intact.",
    description:
      "The in-app assistant works alongside SlabPlan data and documents, with visible tool activity, citations, saved conversations, and per-user usage tracking.",
    bullets: [
      "Auditable tool calls and citations",
      "Saved, pinnable conversations",
      "Visible monthly usage and limits",
    ],
    icon: Bot,
  },
]

const includedFeatures = [
  "All SlabPlan workflows",
  "Up to 25 team members",
  "Private project storage",
  "Office and field views",
  "AI-assisted document workflows",
  "Role-aware team access",
]

const trustItems = [
  {
    icon: ShieldCheck,
    title: "Company-isolated workspace",
    copy: "Business records, files, roles, and billing stay scoped to your company.",
  },
  {
    icon: UserRoundCheck,
    title: "Role-aware access",
    copy: "Admins, project teams, drafters, and crew members see the tools meant for their work.",
  },
  {
    icon: LockKeyhole,
    title: "Private project files",
    copy: "Documents and media use protected storage and time-limited access links.",
  },
]

const faqs = [
  {
    question: "Who is SlabPlan built for?",
    answer:
      "SlabPlan is designed for stone fabricators, installers, and the office and field teams that move a project from lead through payment. Admin, project, drafting, and crew workflows are all part of the same company workspace.",
  },
  {
    question: "What is included in the $250 monthly plan?",
    answer:
      "The full platform is included for one company with up to 25 team members: leads, clients, jobs, scheduling, daily logs, files and media, financial workflows, reports, team management, and supported AI-assisted workflows.",
  },
  {
    question: "Can field teams use SlabPlan?",
    answer:
      "Yes. SlabPlan includes focused role-aware views for field work, daily logging, schedule visibility, comments, and project media. The responsive web app works from a phone, tablet, or desktop browser.",
  },
  {
    question: "How does signup and billing work?",
    answer:
      "Create your company workspace with an email and password, then complete secure checkout through Stripe. SlabPlan does not store raw card details, and billing can be managed through Stripe’s customer portal.",
  },
  {
    question: "Can SlabPlan help with estimates and invoices?",
    answer:
      "Yes. Supported estimate and invoice files can be parsed into financial workflows, where teams can review schedules of values, invoices, payments, change orders, retention, and job-level progress.",
  },
]

export default function MarketingPage() {
  useDocumentTitle("SlabPlan · Stone business operations, connected")
  const user = useAuthStore((state) => state.user)
  const [activeTour, setActiveTour] = useState<TourKey>("jobs")
  const appHref = user ? "/dashboard" : "/register"
  const appLabel = user ? "Open SlabPlan" : "Start with SlabPlan"
  const activeTourItem = tourItems.find((item) => item.id === activeTour) ?? tourItems[1]

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f5f6f8] text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-5 lg:px-10">
          <Link to="/" aria-label={`${APP_NAME} home`}>
            <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-10 w-auto" />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 lg:flex">
            <a href="#product-tour" className="transition hover:text-slate-950">
              Product
            </a>
            <a href="#workflow" className="transition hover:text-slate-950">
              Workflow
            </a>
            <a href="#teams" className="transition hover:text-slate-950">
              For every team
            </a>
            <a href="#pricing" className="transition hover:text-slate-950">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            {!user ? (
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link to="/login">Sign in</Link>
              </Button>
            ) : null}
            <Button asChild className="rounded-full px-5 shadow-sm">
              <Link to={appHref}>
                <span className="hidden sm:inline">{appLabel}</span>
                <span className="sm:hidden">{user ? "Open app" : "Get started"}</span>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#07111f] text-white">
          <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:radial-gradient(circle_at_70%_8%,rgba(255,107,11,.28),transparent_31%),radial-gradient(circle_at_10%_75%,rgba(83,116,160,.18),transparent_28%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,.13)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.13)_1px,transparent_1px)] [background-size:56px_56px]" />
          <div className="relative mx-auto max-w-[1440px] px-5 pb-16 pt-18 lg:px-10 lg:pb-24 lg:pt-24">
            <div className="mx-auto max-w-5xl text-center">
              <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-orange-400/25 bg-orange-400/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
                <HardHat className="size-3.5" />
                The operating system for stone teams
              </div>
              <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.045em] !text-white sm:text-6xl lg:text-[72px]">
                From first measure to final payment, keep every stone job moving.
              </h1>
              <p className="mx-auto mt-6 max-w-3xl text-balance text-lg leading-8 text-slate-300 sm:text-xl">
                SlabPlan connects sales, projects, schedules, crews, field updates, files,
                financials, and reporting in one workspace built around the way stone companies
                actually operate.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-13 rounded-full px-7 text-base shadow-[0_12px_35px_rgba(255,107,11,.25)]"
                >
                  <Link to={appHref}>
                    {appLabel}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-13 rounded-full border-white/20 bg-white/5 px-7 text-base text-white hover:bg-white/10 hover:text-white"
                >
                  <a href="#product-tour">
                    Explore the product
                    <ChevronRight className="size-4" />
                  </a>
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-orange-400" />
                  Full platform access
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-orange-400" />
                  Up to 25 team members
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-orange-400" />
                  $250 per company / month
                </span>
              </div>
            </div>

            <div className="mt-14 lg:mt-18">
              <HeroProductPreview />
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24 border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-[1440px] px-5 py-18 lg:px-10 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:items-end">
              <div>
                <Eyebrow>One connected project story</Eyebrow>
                <h2 className="mt-4 max-w-xl text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
                  Every handoff carries the context forward.
                </h2>
              </div>
              <p className="max-w-2xl text-lg leading-8 text-slate-600 lg:justify-self-end">
                A lead does not become a disconnected spreadsheet row when it is won. SlabPlan
                carries the customer, scope, files, schedule, field activity, and financial history
                through one shared job record.
              </p>
            </div>

            <div className="relative mt-12 grid gap-3 lg:grid-cols-4">
              <div className="pointer-events-none absolute left-[12%] right-[12%] top-8 hidden h-px bg-gradient-to-r from-transparent via-orange-300 to-transparent lg:block" />
              {[
                {
                  number: "01",
                  icon: MessageSquareText,
                  title: "Qualify the lead",
                  copy: "Contacts, notes, projected value, site details, and attachments stay together.",
                },
                {
                  number: "02",
                  icon: FileStack,
                  title: "Build the job",
                  copy: "Turn won work into the operating record for scope, people, files, and money.",
                },
                {
                  number: "03",
                  icon: CalendarCheck2,
                  title: "Run the work",
                  copy: "Coordinate milestones, field logs, crews, photos, and daily decisions.",
                },
                {
                  number: "04",
                  icon: TrendingUp,
                  title: "Close with clarity",
                  copy: "Follow invoices, payments, retention, and performance through completion.",
                },
              ].map(({ number, icon: Icon, title, copy }) => (
                <article
                  key={number}
                  className="relative rounded-2xl border border-slate-200 bg-[#f8f9fb] p-6"
                >
                  <div className="relative z-10 flex size-16 items-center justify-center rounded-2xl border border-orange-200 bg-white text-orange-600 shadow-sm">
                    <Icon className="size-6" />
                  </div>
                  <p className="mt-7 text-xs font-semibold tracking-[0.18em] text-orange-600">
                    {number}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="product-tour" className="scroll-mt-24 bg-[#f5f6f8]">
          <div className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
            <div className="max-w-3xl">
              <Eyebrow>Explore by workflow</Eyebrow>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
                See the product, not a list of promises.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Move through a sample workspace modeled on SlabPlan’s actual modules. The details below are illustrative; the workflows are the real product.
              </p>
            </div>

            <div className="mt-12 grid gap-6 xl:grid-cols-[.78fr_1.22fr]">
              <div
                role="tablist"
                aria-label="SlabPlan product workflows"
                className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1"
              >
                {tourItems.map(({ id, label, icon: Icon }) => {
                  const isActive = id === activeTour
                  return (
                    <button
                      key={id}
                      id={`tour-tab-${id}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`tour-panel-${id}`}
                      onClick={() => setActiveTour(id)}
                      className={cn(
                        "group flex min-h-18 items-center gap-4 rounded-xl border p-4 text-left transition duration-200",
                        isActive
                          ? "border-slate-950 bg-slate-950 text-white shadow-lg"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-lg",
                          isActive ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-600",
                        )}
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="font-semibold">{label}</span>
                      <ChevronRight
                        className={cn(
                          "ml-auto size-4 transition",
                          isActive
                            ? "translate-x-0 text-orange-400"
                            : "text-slate-400 group-hover:translate-x-0.5",
                        )}
                      />
                    </button>
                  )
                })}
              </div>

              <div className="min-w-0">
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
                    {activeTourItem.eyebrow}
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                    {activeTourItem.title}
                  </h3>
                  <p className="mt-3 max-w-3xl leading-7 text-slate-600">
                    {activeTourItem.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                    {activeTourItem.bullets.map((bullet) => (
                      <span
                        key={bullet}
                        className="flex items-center gap-2 text-sm font-medium text-slate-700"
                      >
                        <Check className="size-4 text-orange-600" />
                        {bullet}
                      </span>
                    ))}
                  </div>
                </div>
                <div
                  id={`tour-panel-${activeTour}`}
                  role="tabpanel"
                  aria-labelledby={`tour-tab-${activeTour}`}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,.12)]"
                >
                  <TourPreview active={activeTour} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="teams" className="scroll-mt-24 border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
            <div className="grid gap-14 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
              <div>
                <Eyebrow>Office and field, one source of truth</Eyebrow>
                <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
                  Each role gets focus. The company keeps the whole picture.
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
                  SlabPlan changes the starting view based on the work someone owns—without
                  fragmenting the project record underneath.
                </p>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      icon: LayoutDashboard,
                      title: "Owners & admins",
                      copy: "Business pulse, receivables, pipeline, jobs, team, and company controls.",
                    },
                    {
                      icon: BriefcaseBusiness,
                      title: "Project teams",
                      copy: "This week, milestones, job details, assignments, files, and risks.",
                    },
                    {
                      icon: Wrench,
                      title: "Drafters",
                      copy: "Focused drafting work, deadlines, project context, and files.",
                    },
                    {
                      icon: HardHat,
                      title: "Crew members",
                      copy: "My Day, schedule context, daily logs, comments, and field media.",
                    },
                  ].map(({ icon: Icon, title, copy }) => (
                    <div key={title} className="flex gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                        <Icon className="size-5" />
                      </span>
                      <div>
                        <h3 className="font-semibold">{title}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{copy}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <FieldOfficePreview />
            </div>
          </div>
        </section>

        <section className="bg-[#07111f] text-white">
          <div className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
            <div className="grid gap-10 lg:grid-cols-[.75fr_1.25fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-400">
                  The rest of the operation
                </p>
                <h2 className="mt-4 max-w-xl text-balance text-3xl font-semibold tracking-[-0.035em] !text-white sm:text-5xl">
                  The useful details are already connected.
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
                  SlabPlan is not a single dashboard with shallow add-ons. The supporting workflows
                  go all the way down to the project.
                </p>
              </div>
              <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">
                {[
                  {
                    icon: CalendarDays,
                    title: "Schedules and dependencies",
                    copy: "Milestones, progress, dependencies, workday exceptions, and CSV exports.",
                  },
                  {
                    icon: Images,
                    title: "Documents, photos, and video",
                    copy: "Private job media, previews, folders, comments, and controlled access.",
                  },
                  {
                    icon: Search,
                    title: "Global search",
                    copy: "Find the job, client, lead, file, or schedule item without hunting through tools.",
                  },
                  {
                    icon: BarChart3,
                    title: "Operational reports",
                    copy: "A/R aging, monthly revenue, pipeline, win rate, payment speed, and job stage.",
                  },
                  {
                    icon: Zap,
                    title: "At-risk views",
                    copy: "Bring missing daily logs and pending change orders into focused action queues.",
                  },
                  {
                    icon: Users,
                    title: "Team and access controls",
                    copy: "Invite teammates, manage roles, profiles, notifications, and access tokens.",
                  },
                ].map(({ icon: Icon, title, copy }) => (
                  <article key={title} className="bg-[#0b1728] p-6">
                    <Icon className="size-5 text-orange-400" />
                    <h3 className="mt-4 font-semibold !text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-[#eef1f4]">
          <div className="mx-auto max-w-[1440px] px-5 py-18 lg:px-10 lg:py-24">
            <div className="mx-auto max-w-3xl text-center">
              <Eyebrow>Built for real company boundaries</Eyebrow>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
                Your workspace is your workspace.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                SlabPlan treats company isolation and role access as operating requirements—not
                upgrade-line extras.
              </p>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {trustItems.map(({ icon: Icon, title, copy }) => (
                <article
                  key={title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-slate-950 text-orange-400">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-24 bg-white">
          <div className="mx-auto max-w-[1440px] px-5 py-20 lg:px-10 lg:py-28">
            <div className="overflow-hidden rounded-[28px] bg-[#07111f] text-white shadow-[0_30px_90px_rgba(15,23,42,.18)]">
              <div className="grid lg:grid-cols-[1.08fr_.92fr]">
                <div className="relative overflow-hidden p-8 sm:p-12 lg:p-16">
                  <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_15%_15%,rgba(255,107,11,.48),transparent_30%)]" />
                  <div className="relative">
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-400">
                      Simple, complete pricing
                    </p>
                    <h2 className="mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.035em] !text-white sm:text-5xl">
                      One company plan. No essential workflow left behind.
                    </h2>
                    <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
                      Bring the office and field into one operating system without building a stack
                      of disconnected subscriptions.
                    </p>
                    <div className="mt-9 grid gap-3 sm:grid-cols-2">
                      {includedFeatures.map((feature) => (
                        <div key={feature} className="flex gap-2 text-sm text-slate-200">
                          <Check className="mt-0.5 size-4 shrink-0 text-orange-400" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col justify-center border-t border-white/10 bg-white/[0.055] p-8 sm:p-12 lg:border-l lg:border-t-0 lg:p-16">
                  <p className="text-sm font-medium text-slate-300">SlabPlan Full Access</p>
                  <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
                    <span className="text-5xl font-semibold tracking-[-0.04em] sm:text-6xl">
                      $250
                    </span>
                    <span className="pb-1.5 text-slate-300">per company / month</span>
                  </div>
                  <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
                    Create your workspace, then complete secure card checkout and manage billing
                    through Stripe.
                  </p>
                  <Button asChild size="lg" className="mt-8 h-13 rounded-full text-base">
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
          </div>
        </section>

        <section className="border-t border-slate-200 bg-[#f5f6f8]">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 lg:grid-cols-[.72fr_1.28fr] lg:px-10 lg:py-24">
            <div>
              <Eyebrow>Questions, answered</Eyebrow>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                Know what you are signing up for.
              </h2>
            </div>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {faqs.map(({ question, answer }) => (
                <details key={question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-semibold text-slate-900">
                    {question}
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="max-w-2xl pr-10 pt-3 text-sm leading-7 text-slate-600">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-orange-600 text-white">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-7 px-5 py-12 sm:flex-row sm:items-center lg:px-10">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-100">
                Ready to connect the operation?
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] !text-white sm:text-3xl">
                Start your company workspace today.
              </h2>
            </div>
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-white px-6 text-slate-950 hover:bg-slate-100"
            >
              <Link to={appHref}>
                {appLabel}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="bg-[#07111f] text-slate-400">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-10 sm:flex-row sm:items-end sm:justify-between lg:px-10">
          <div>
            <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-9 w-auto" />
            <p className="mt-4 max-w-md text-sm leading-6">
              One operating system for the people who sell, plan, fabricate, install, and close
              stone work.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm sm:items-end">
            <div className="flex gap-5">
              <Link to="/login" className="transition hover:text-white">
                Sign in
              </Link>
              <Link to="/register" className="transition hover:text-white">
                Create account
              </Link>
              <a href="#pricing" className="transition hover:text-white">
                Pricing
              </a>
              <Link to="/terms" className="transition hover:text-white">
                Terms
              </Link>
              <Link to="/privacy" className="transition hover:text-white">
                Privacy
              </Link>
            </div>
            <p>© {new Date().getFullYear()} SlabPlan. Built for the stone trade.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">{children}</p>
  )
}

function PreviewTopBar({ title, compact = false }: { title: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-slate-200 bg-white",
        compact ? "px-4 py-3" : "px-5 py-3.5",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2 rounded-full bg-slate-200" />
          <span className="size-2 rounded-full bg-slate-200" />
          <span className="size-2 rounded-full bg-slate-200" />
        </div>
        <span className="ml-2 text-xs font-semibold text-slate-700">{title}</span>
      </div>
      <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-orange-700">
        Sample workspace
      </span>
    </div>
  )
}

function HeroProductPreview() {
  const stages = [
    ["Measure", 8],
    ["Drafting", 5],
    ["Fabrication", 7],
    ["Install", 4],
  ]

  return (
    <div className="relative mx-auto max-w-[1240px]">
      <div className="absolute -inset-10 rounded-full bg-orange-500/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white shadow-[0_32px_100px_rgba(0,0,0,.38)]">
        <PreviewTopBar title="SlabPlan · Business Pulse" />
        <div className="flex min-h-[460px] text-slate-950 lg:min-h-[540px]">
          <aside className="hidden w-52 shrink-0 flex-col bg-[#0a1525] p-4 text-slate-300 md:flex">
            <div className="flex items-center gap-2 rounded-lg bg-white/8 px-3 py-2.5 text-sm font-semibold text-white">
              <LayoutDashboard className="size-4 text-orange-400" />
              Business Pulse
            </div>
            <div className="mt-4 space-y-1 text-sm">
              {[
                [BriefcaseBusiness, "Jobs"],
                [Users, "Clients"],
                [UsersRound, "Leads"],
                [CalendarDays, "Schedule"],
                [ClipboardCheck, "Daily logs"],
                [BarChart3, "Reports"],
              ].map(([Icon, label]) => {
                const ItemIcon = Icon as typeof BriefcaseBusiness
                return (
                  <div
                    key={label as string}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-400"
                  >
                    <ItemIcon className="size-4" />
                    {label as string}
                  </div>
                )
              })}
            </div>
            <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Active company
              </p>
              <p className="mt-1 text-xs font-semibold text-white">Summit Stoneworks</p>
              <p className="mt-1 text-[10px] text-slate-500">Sample data</p>
            </div>
          </aside>

          <div className="min-w-0 flex-1 bg-[#f5f6f8] p-4 sm:p-6 lg:p-7">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                  Monday, August 3
                </p>
                <h3 className="mt-1 text-xl font-semibold sm:text-2xl">Business Pulse</h3>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-400 sm:flex">
                  <Search className="size-3.5" />
                  Search anything
                </div>
                <span className="flex size-9 items-center justify-center rounded-lg bg-orange-600 text-sm font-semibold text-white">
                  SS
                </span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                ["A/R outstanding", "$84,260", "12 open invoices", CircleDollarSign],
                ["New contracts", "$192,500", "4 this month", TrendingUp],
                ["Active jobs", "24", "6 installing", BriefcaseBusiness],
                ["Open leads", "13", "$428k pipeline", UsersRound],
              ].map(([label, value, detail, Icon]) => {
                const KpiIcon = Icon as typeof CircleDollarSign
                return (
                  <div
                    key={label as string}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <KpiIcon className="size-3.5 text-orange-600" />
                      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {label as string}
                      </p>
                    </div>
                    <p className="mt-2 text-lg font-semibold tabular-nums sm:text-xl">
                      {value as string}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-500">{detail as string}</p>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Jobs by stage</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">Live operating mix</p>
                  </div>
                  <span className="text-[10px] font-medium text-orange-700">View jobs</span>
                </div>
                <div className="mt-5 space-y-3">
                  {stages.map(([label, count], index) => (
                    <div key={label as string}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-slate-600">{label as string}</span>
                        <span className="tabular-nums text-slate-500">{count as number}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-orange-500"
                          style={{ width: `${88 - index * 14}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Next up</p>
                  <CalendarCheck2 className="size-4 text-orange-600" />
                </div>
                <div className="mt-4 space-y-2.5">
                  {[
                    ["8:00", "Templating", "Canyon View"],
                    ["10:30", "Shop review", "Palm Ridge"],
                    ["1:00", "Install", "Mesa Modern"],
                    ["3:30", "Close daily logs", "Field team"],
                  ].map(([time, action, job]) => (
                    <div
                      key={`${time}-${action}`}
                      className="flex items-start gap-3 rounded-lg bg-slate-50 p-2.5"
                    >
                      <span className="text-[10px] font-semibold tabular-nums text-orange-700">
                        {time}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold">{action}</p>
                        <p className="truncate text-[10px] text-slate-500">{job}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto h-5 w-[82%] rounded-b-[100%] bg-black/25 blur-xl" />
    </div>
  )
}

function TourPreview({ active }: { active: TourKey }) {
  return (
    <>
      <PreviewTopBar
        title={
          active === "pipeline"
            ? "Sales · Leads"
            : active === "jobs"
              ? "Jobs · Palm Ridge Residence"
              : active === "field"
                ? "My Day · Field view"
                : active === "financials"
                  ? "Job financials"
                  : "SlabPlan Assistant"
        }
        compact
      />
      <div className="min-h-[440px] bg-[#f5f6f8] p-4 sm:p-6">
        {active === "pipeline" ? <PipelinePreview /> : null}
        {active === "jobs" ? <JobPreview /> : null}
        {active === "field" ? <FieldPreview /> : null}
        {active === "financials" ? <FinancialPreview /> : null}
        {active === "assistant" ? <AssistantPreview /> : null}
      </div>
    </>
  )
}

function PipelinePreview() {
  const leads = [
    ["Palm Ridge Residence", "Qualified", "$85k–$110k", "75%"],
    ["Desert House Remodel", "Negotiation", "$42k–$58k", "60%"],
    ["Canyon View Kitchen", "Open", "$28k–$36k", "35%"],
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-lg font-semibold">Sales pipeline</p>
          <p className="text-xs text-slate-500">
            Contacts, value, scope, and next action in one place
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            $428k qualified
          </span>
          <span className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white">
            + New lead
          </span>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[1.3fr_.8fr_.9fr_.4fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
          <span>Opportunity</span>
          <span>Status</span>
          <span>Projected value</span>
          <span>Confidence</span>
        </div>
        {leads.map(([name, status, value, confidence], index) => (
          <div
            key={name}
            className="grid gap-3 border-b border-slate-100 p-4 last:border-0 sm:grid-cols-[1.3fr_.8fr_.9fr_.4fr] sm:items-center"
          >
            <div>
              <p className="text-sm font-semibold">{name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                <MapPin className="size-3" />
                {index === 0 ? "Palm Desert, CA" : "Coachella Valley, CA"}
              </p>
            </div>
            <span
              className={cn(
                "w-fit rounded-full border px-2 py-1 text-[10px] font-semibold",
                status === "Qualified"
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : status === "Negotiation"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}
            >
              {status}
            </span>
            <span className="text-sm font-medium">{value}</span>
            <span className="text-sm font-semibold text-orange-700">{confidence}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 sm:flex-row sm:items-center">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
            <BriefcaseBusiness className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-violet-950">Palm Ridge is ready to convert</p>
            <p className="mt-0.5 text-xs text-violet-700">
              Carry the scope, contacts, address, files, and salesperson into a new job.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white">
          Convert to job
        </span>
      </div>
    </div>
  )
}

function JobPreview() {
  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">Palm Ridge Residence</p>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              Open
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="size-3" />
            Palm Desert, CA · Residential
          </p>
        </div>
        <div className="flex -space-x-2">
          {["CM", "JR", "AM"].map((initials, index) => (
            <span
              key={initials}
              className="flex size-8 items-center justify-center rounded-full border-2 border-white bg-slate-900 text-[9px] font-semibold text-white"
              style={{ opacity: 1 - index * 0.16 }}
            >
              {initials}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 flex gap-1 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 text-[10px] font-medium text-slate-500">
        {["Summary", "Schedule", "Daily logs", "Documents", "Photos", "Financials"].map(
          (tab, index) => (
            <span
              key={tab}
              className={cn(
                "whitespace-nowrap rounded-md px-2.5 py-1.5",
                index === 0 && "bg-slate-950 text-white",
              )}
            >
              {tab}
            </span>
          ),
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Project health</p>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                <CheckCircle2 className="size-3" />
                On track
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                ["Schedule", "68%", "Install Aug 14"],
                ["Daily logs", "12", "All current"],
                ["Contract", "$108k", "42% billed"],
              ].map(([label, value, detail]) => (
                <div key={label} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-semibold">{value}</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">{detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold">Milestone progress</p>
            <div className="mt-4 space-y-3">
              {[
                ["Field measure", 100],
                ["Shop drawings", 100],
                ["Fabrication", 72],
                ["Installation", 18],
              ].map(([label, progress]) => (
                <div key={label as string}>
                  <div className="flex justify-between text-[10px]">
                    <span>{label as string}</span>
                    <span className="text-slate-500">{progress as number}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-orange-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-xl bg-slate-950 p-4 text-white">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Next actions</p>
            <Clock3 className="size-4 text-orange-400" />
          </div>
          <div className="mt-4 space-y-3">
            {[
              ["Approve sink cutout revision", "Today"],
              ["Confirm install crew", "Tomorrow"],
              ["Review CO-003", "Aug 7"],
              ["Close fabrication log", "Aug 8"],
            ].map(([action, date], index) => (
              <div key={action} className="flex gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    index === 0 ? "border-orange-400 bg-orange-400/15" : "border-white/20",
                  )}
                >
                  {index === 0 ? <span className="size-1.5 rounded-full bg-orange-400" /> : null}
                </span>
                <div>
                  <p className="text-[11px] font-medium text-slate-100">{action}</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">{date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldPreview() {
  return (
    <div className="grid gap-5 sm:grid-cols-[.72fr_1.28fr]">
      <div className="mx-auto w-full max-w-[250px] rounded-[28px] border-[6px] border-slate-950 bg-white shadow-xl">
        <div className="mx-auto mt-2 h-1.5 w-14 rounded-full bg-slate-900" />
        <div className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-600">
            My Day
          </p>
          <p className="mt-1 text-base font-semibold">Monday, Aug 3</p>
          <div className="mt-4 rounded-xl bg-slate-950 p-3.5 text-white">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400">Current job</span>
              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] text-emerald-300">
                On site
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold">Palm Ridge</p>
            <p className="mt-1 flex items-center gap-1 text-[9px] text-slate-400">
              <MapPin className="size-2.5" />
              Palm Desert, CA
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {[
              ["7:00 AM", "Crew arrival", true],
              ["8:00 AM", "Island installation", true],
              ["1:30 PM", "Final seams", false],
            ].map(([time, label, done]) => (
              <div
                key={label as string}
                className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5"
              >
                <CheckCircle2
                  className={cn("size-3.5", done ? "text-emerald-500" : "text-slate-300")}
                />
                <div>
                  <p className="text-[10px] font-semibold">{label as string}</p>
                  <p className="text-[8px] text-slate-500">{time as string}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-orange-600 py-2 text-center text-[10px] font-semibold text-white">
            Add daily log
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Today’s field log</p>
              <p className="text-[10px] text-slate-500">Palm Ridge Residence</p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700">
              <CloudSun className="size-3" />
              94° · Clear
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Status", "Published"],
              ["Shared with", "Internal"],
              ["Attachments", "3 photos"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-2.5">
                <p className="text-[9px] uppercase text-slate-500">{label}</p>
                <p className="mt-1 text-[11px] font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="text-[10px] font-semibold">Progress note</p>
            <p className="mt-1 text-[10px] leading-5 text-slate-600">
              Island set and leveled. Final seam work begins after lunch. Edge inspection completed
              with project manager.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Installation", "Quality check"].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-orange-50 px-2 py-1 text-[8px] font-medium text-orange-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
          <span>Attached media · 3</span>
          <span>Illustrative sample</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              label: "Install overview",
              src: "/marketing/field-install-overview.jpg",
              alt: "Illustrative field photo of an installation crew setting a stone island",
            },
            {
              label: "Island seam",
              src: "/marketing/field-seam-detail.jpg",
              alt: "Illustrative field photo of a craftsperson finishing a stone island seam",
            },
            {
              label: "Edge inspection",
              src: "/marketing/field-edge-inspection.jpg",
              alt: "Illustrative field photo of a mitered stone edge being inspected",
            },
          ].map(({ label, src, alt }) => (
            <div
              key={label}
              className="relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-200"
            >
              <img
                src={src}
                alt={alt}
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent p-2 pt-6">
                <p className="text-[8px] font-medium text-white">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FinancialPreview() {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Contract + changes", "$112,750"],
          ["Billed", "$74,600"],
          ["Outstanding", "$31,200"],
          ["Retention held", "$7,460"],
        ].map(([label, value], index) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p>
            <p
              className={cn(
                "mt-1.5 text-base font-semibold tabular-nums",
                index === 2 && "text-amber-700",
              )}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold">Schedule of values</p>
            <p className="text-[10px] text-slate-500">Palm Ridge Residence · 10% retention</p>
          </div>
          <span className="flex items-center gap-1 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[10px] font-semibold text-orange-700">
            <Sparkles className="size-3" />
            Import estimate
          </span>
        </div>
        <div className="grid grid-cols-[1.25fr_.55fr_.55fr_.45fr] gap-2 bg-slate-50 px-4 py-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Area / line item</span>
          <span>Scheduled</span>
          <span>Billed</span>
          <span>Progress</span>
        </div>
        {[
          ["Kitchen · perimeter", "$38,500", "$38,500", "100%"],
          ["Kitchen · island", "$26,250", "$19,688", "75%"],
          ["Primary bath", "$22,000", "$11,000", "50%"],
          ["Outdoor bar", "$18,500", "$5,412", "30%"],
        ].map(([item, scheduled, billed, progress]) => (
          <div
            key={item}
            className="grid grid-cols-[1.25fr_.55fr_.55fr_.45fr] gap-2 border-t border-slate-100 px-4 py-3 text-[10px]"
          >
            <span className="font-medium">{item}</span>
            <span className="tabular-nums text-slate-600">{scheduled}</span>
            <span className="tabular-nums text-slate-600">{billed}</span>
            <span className="font-semibold text-orange-700">{progress}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
          <p className="text-[10px] font-semibold uppercase text-emerald-700">
            Approved change order
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs font-semibold">CO-003 · Added backsplash</span>
            <span className="text-xs font-semibold tabular-nums">+$7,500</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <p className="text-[10px] font-semibold uppercase text-slate-500">Latest invoice</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs font-semibold">INV-1048 · Aug 1</span>
            <span className="text-xs font-semibold tabular-nums">$28,100</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssistantPreview() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-slate-950 text-orange-400">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="text-xs font-semibold">Operations assistant</p>
              <p className="text-[9px] text-slate-500">Project context enabled</p>
            </div>
          </div>
          <span className="text-[9px] text-slate-400">Saved conversation</span>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-xs leading-5 text-white">
            Which active jobs need attention before Friday?
          </div>
          <div className="max-w-[92%]">
            <div className="mb-2 flex flex-wrap gap-2">
              {[
                ["Reviewed job schedules", CalendarDays],
                ["Checked missing logs", ClipboardCheck],
                ["Checked change orders", ReceiptText],
              ].map(([label, Icon]) => {
                const ToolIcon = Icon as typeof CalendarDays
                return (
                  <span
                    key={label as string}
                    className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] text-slate-600"
                  >
                    <ToolIcon className="size-2.5 text-orange-600" />
                    {label as string}
                  </span>
                )
              })}
            </div>
            <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-700">
              <p className="font-semibold text-slate-950">Three jobs need attention:</p>
              <ol className="mt-2 space-y-2">
                <li>
                  <span className="font-semibold">1. Palm Ridge</span> — approve the sink cutout
                  revision before fabrication resumes.
                </li>
                <li>
                  <span className="font-semibold">2. Mesa Modern</span> — two field logs are still
                  open from this week.
                </li>
                <li>
                  <span className="font-semibold">3. Canyon View</span> — CO-006 is pending and the
                  install milestone is Friday.
                </li>
              </ol>
            </div>
            <div className="mt-2 flex gap-2">
              <span className="rounded-md bg-orange-50 px-2 py-1 text-[9px] font-medium text-orange-700">
                Job schedule · 3 sources
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-medium text-slate-600">
                At-risk views
              </span>
            </div>
          </div>
        </div>
        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] text-slate-400">
            Ask about jobs, clients, schedules, files, or financials…
            <ArrowRight className="ml-auto size-3.5 text-orange-600" />
          </div>
        </div>
      </div>
      <div className="mx-auto mt-4 flex max-w-lg items-center justify-center gap-5 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="size-3 text-emerald-600" />
          Visible tool activity
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="size-3 text-emerald-600" />
          Source citations
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="size-3 text-emerald-600" />
          Usage controls
        </span>
      </div>
    </div>
  )
}

function FieldOfficePreview() {
  return (
    <div className="relative min-h-[520px]">
      <div className="absolute left-0 top-0 w-[88%] overflow-hidden rounded-2xl border border-slate-200 bg-[#f5f6f8] shadow-[0_24px_70px_rgba(15,23,42,.14)]">
        <PreviewTopBar title="Project team · This Week" compact />
        <div className="p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">This Week</p>
              <p className="text-[10px] text-slate-500">12 milestones across 7 jobs</p>
            </div>
            <span className="rounded-lg bg-orange-600 px-3 py-2 text-[10px] font-semibold text-white">
              + Schedule item
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {[
              ["Mon 03", "Palm Ridge · Fabrication", "In progress", "72%"],
              ["Tue 04", "Mesa Modern · Field measure", "Ready", "0%"],
              ["Wed 05", "Canyon View · Shop drawings", "Review", "90%"],
              ["Fri 07", "Desert House · Installation", "Scheduled", "0%"],
            ].map(([date, item, status, progress], index) => (
              <div
                key={item}
                className="grid grid-cols-[.48fr_1.3fr_.7fr_.45fr] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-[10px]"
              >
                <span className="font-semibold text-slate-500">{date}</span>
                <span className="font-semibold">{item}</span>
                <span
                  className={cn(
                    "w-fit rounded-full px-2 py-0.5 font-medium",
                    index === 0 ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {status}
                </span>
                <span className="text-right font-semibold text-slate-500">{progress}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["Missing logs", "2", "text-amber-700"],
              ["Pending COs", "3", "text-violet-700"],
              ["On-time jobs", "92%", "text-emerald-700"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-[9px] text-slate-500">{label}</p>
                <p className={cn("mt-1 text-base font-semibold", color)}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 right-0 w-[42%] min-w-[210px] rounded-[30px] border-[7px] border-slate-950 bg-white shadow-2xl">
        <div className="mx-auto mt-2 h-1.5 w-14 rounded-full bg-slate-900" />
        <div className="p-4">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-orange-600">
            Crew member
          </p>
          <p className="mt-1 text-base font-semibold">My Day</p>
          <div className="mt-3 rounded-xl bg-slate-950 p-3 text-white">
            <p className="text-[9px] text-slate-400">Up next · 8:00 AM</p>
            <p className="mt-1 text-xs font-semibold">Island installation</p>
            <p className="mt-1 text-[8px] text-slate-400">Palm Ridge Residence</p>
          </div>
          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-slate-200 p-2.5">
              <p className="text-[9px] font-semibold">Today’s checklist</p>
              <div className="mt-2 space-y-1.5 text-[8px] text-slate-600">
                <p className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-emerald-500" />
                  Review drawings
                </p>
                <p className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-slate-300" />
                  Capture seam photos
                </p>
                <p className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3 text-slate-300" />
                  Submit daily log
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <span className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-orange-600 py-2 text-[8px] font-semibold text-white">
                <FileImage className="size-3" />
                Add photo
              </span>
              <span className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 py-2 text-[8px] font-semibold text-slate-700">
                <ClipboardCheck className="size-3" />
                Daily log
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
