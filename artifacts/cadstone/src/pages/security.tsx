import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  ExternalLink,
  FileKey2,
  KeyRound,
  LockKeyhole,
  Mail,
  Server,
  ShieldCheck,
  UsersRound,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand"
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal"
import { cn } from "@/lib/utils"

const controls = [
  {
    icon: UsersRound,
    title: "Tenant and role boundaries",
    description:
      "Company records are scoped to an active organization. Role checks limit administrative, financial, sales, and field workflows to authorized users.",
  },
  {
    icon: FileKey2,
    title: "Private file access",
    description:
      "Project files are stored in private object storage. SlabPlan authorizes each request and uses narrowly scoped, expiring access for uploads and downloads.",
  },
  {
    icon: KeyRound,
    title: "Authentication and sessions",
    description:
      "Passwords are never stored in plain text. Production sessions use secure, HTTP-only cookies and protected token flows for browser and upload access.",
  },
  {
    icon: ShieldCheck,
    title: "Application defenses",
    description:
      "The API applies request validation, rate limits, origin controls, anti-forgery checks, content security policy, anti-framing, and file-type validation.",
  },
  {
    icon: Activity,
    title: "Operational monitoring",
    description:
      "Structured application logs, diagnostics, error monitoring, and auditable AI and integration activity support investigation and service operations.",
  },
  {
    icon: Database,
    title: "Data protection",
    description:
      "Production database records and private files are hosted by Supabase. Provider controls protect data in transit and at rest within the hosted environment.",
  },
]

const customerPractices = [
  "Use a unique account for every team member and remove access promptly when roles change.",
  "Assign the least-privileged role needed for each person's work.",
  "Keep passwords private and review company access regularly.",
  "Upload only information your company is authorized to process.",
]

export default function SecurityPage() {
  useDocumentTitle("Security")

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-slate-950">
      <header className="border-b border-white/10 bg-[#07111f] text-white">
        <div className="mx-auto flex h-20 max-w-[1200px] items-center justify-between px-5 lg:px-10">
          <Link to="/" aria-label={`${APP_NAME} home`}>
            <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-10 w-auto" />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Back to SlabPlan
          </Link>
        </div>
      </header>

      <main>
        <section className="bg-[#07111f] text-white">
          <div className="mx-auto max-w-[1200px] px-5 pb-16 pt-14 lg:px-10 lg:pb-20 lg:pt-18">
            <div className="max-w-4xl">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase text-orange-400">
                <LockKeyhole className="size-4" />
                Security overview
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl">
                Protection for the records that keep stone work moving.
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
                SlabPlan combines tenant-aware application controls with independently audited infrastructure providers.
                Security is shared across our platform, our providers, and each customer&apos;s access decisions.
              </p>
              <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
                <Button asChild className="h-11 rounded-full px-5">
                  <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=SlabPlan security report`}>
                    Report a security concern
                    <Mail className="size-4" />
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 rounded-full border-white/25 bg-transparent px-5 text-white hover:bg-white/10 hover:text-white"
                >
                  <Link to="/privacy">
                    Read our Privacy Policy
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-[1200px] divide-y divide-slate-200 px-5 md:grid-cols-3 md:divide-x md:divide-y-0 lg:px-10">
            <StatusItem label="Hosting and data providers" value="SOC 2 Type II" detail="Replit and Supabase" />
            <StatusItem label="SlabPlan attestation" value="Not yet issued" detail="Readiness program in progress" />
            <StatusItem label="Application boundary" value="Tenant scoped" detail="Roles, records, and private files" />
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-[1200px] px-5 py-16 lg:px-10 lg:py-20">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase text-orange-600">Application controls</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">How SlabPlan protects customer work</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                These safeguards describe the production application as it is operated today. We review them as the
                product and threat landscape change.
              </p>
            </div>

            <div className="mt-10 grid border-y border-slate-200 md:grid-cols-2 lg:grid-cols-3">
              {controls.map(({ icon: Icon, title, description }, index) => (
                <article
                  key={title}
                  className={cn(
                    "border-t border-slate-200 py-8 md:px-7",
                    index === 0 && "border-t-0",
                    index === 1 && "md:border-l md:border-t-0",
                    index === 2 && "lg:border-l lg:border-t-0",
                    index === 3 && "md:border-l lg:border-l-0",
                    index === 4 && "lg:border-l",
                    index === 5 && "md:border-l lg:border-l",
                  )}
                >
                  <div className="flex size-10 items-center justify-center rounded-md bg-orange-50 text-orange-700">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-950">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-[#eef1f4]">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:py-20">
            <div>
              <p className="text-sm font-semibold uppercase text-orange-600">Compliance posture</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Audited infrastructure, honest boundary</h2>
              <p className="mt-5 text-base leading-7 text-slate-700">
                Replit and Supabase maintain SOC 2 Type II attestations for the services they operate. Those reports
                strengthen SlabPlan&apos;s vendor foundation, but they do not transfer an attestation to Taro Build or
                the SlabPlan application.
              </p>
              <p className="mt-4 text-base leading-7 text-slate-700">
                SlabPlan does not currently claim its own independent SOC 2 report. Our readiness work covers
                application controls, policies, vendor oversight, evidence collection, incident response, access
                reviews, and an eventual independent examination.
              </p>
            </div>

            <div className="border-l-2 border-slate-300 pl-6 sm:pl-8">
              <ProviderRow
                icon={Server}
                name="Replit"
                scope="Production application hosting"
                href="https://docs.replit.com/teams/information-security/overview"
              />
              <ProviderRow
                icon={Database}
                name="Supabase"
                scope="Postgres database, authentication, and private object storage"
                href="https://supabase.com/docs/guides/security/soc-2-compliance"
              />
              <p className="mt-7 text-sm leading-6 text-slate-600">
                Provider reports may be subject to plan eligibility, confidentiality terms, and customer request
                procedures.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-16 lg:grid-cols-2 lg:px-10 lg:py-20">
            <div>
              <p className="text-sm font-semibold uppercase text-orange-600">Shared responsibility</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Security continues inside every workspace</h2>
              <p className="mt-5 text-base leading-7 text-slate-600">
                SlabPlan protects the service boundary. Customer administrators remain responsible for deciding who
                should have access and what information their company may store.
              </p>
            </div>
            <div className="space-y-4">
              {customerPractices.map((practice) => (
                <div
                  key={practice}
                  className="flex gap-3 border-b border-slate-200 pb-4 text-sm leading-6 text-slate-700"
                >
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  <span>{practice}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-orange-600 text-white">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 px-5 py-12 sm:flex-row sm:items-center lg:px-10">
            <div>
              <p className="text-sm font-semibold uppercase text-orange-100">Responsible disclosure</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Found something we should investigate?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-orange-50">
                Send a clear description and reproduction steps without including customer data, credentials, or
                secrets.
              </p>
            </div>
            <Button
              asChild
              className="h-11 max-w-full shrink-0 rounded-full bg-white px-5 text-slate-950 hover:bg-slate-100"
            >
              <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=SlabPlan security report`}>
                {LEGAL_CONTACT_EMAIL}
                <Mail className="size-4" />
              </a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#07111f] text-slate-400">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <span>&copy; {new Date().getFullYear()} SlabPlan. Built for the stone trade.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/security" className="font-medium text-white">
              Security
            </Link>
            <Link to="/terms" className="transition hover:text-white">
              Terms
            </Link>
            <Link to="/privacy" className="transition hover:text-white">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function StatusItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="py-7 md:px-7">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </div>
  )
}

function ProviderRow({
  icon: Icon,
  name,
  scope,
  href,
}: {
  icon: typeof Server
  name: string
  scope: string
  href: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-4 border-b border-slate-300 py-6 first:pt-0 hover:text-orange-700"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white text-slate-700 shadow-sm">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-950">{name}</h3>
          <ExternalLink className="size-3.5" />
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-600">{scope}</p>
        <p className="mt-1 text-xs font-semibold uppercase text-emerald-700">SOC 2 Type II provider</p>
      </div>
    </a>
  )
}
