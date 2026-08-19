import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand"
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal"

export type LegalSection = {
  title: string
  paragraphs: React.ReactNode[]
}

export function LegalPage({
  title,
  effectiveDate,
  introduction,
  sections,
}: {
  title: string
  effectiveDate: string
  introduction: React.ReactNode
  sections: LegalSection[]
}) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-[#07111f] text-white">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between px-5 sm:px-8">
          <Link to="/" aria-label={`${APP_NAME} home`}>
            <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-10 w-auto" />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-200 transition hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Back to SlabPlan
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="border-b border-slate-200 pb-9">
          <p className="text-sm font-semibold uppercase text-orange-600">Legal</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-slate-500">Effective {effectiveDate}</p>
          <div className="mt-6 text-base leading-7 text-slate-700">{introduction}</div>
        </div>

        <article className="divide-y divide-slate-200">
          {sections.map((section, index) => (
            <section key={section.title} className="py-8">
              <h2 className="text-xl font-semibold text-slate-950">
                {index + 1}. {section.title}
              </h2>
              <div className="mt-4 space-y-4 text-base leading-7 text-slate-700">
                {section.paragraphs.map((paragraph, paragraphIndex) => (
                  <div key={paragraphIndex}>{paragraph}</div>
                ))}
              </div>
            </section>
          ))}
        </article>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>Questions: {LEGAL_CONTACT_EMAIL}</span>
          <div className="flex gap-5">
            <Link to="/terms" className="font-medium hover:text-slate-950">
              Terms
            </Link>
            <Link to="/privacy" className="font-medium hover:text-slate-950">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
