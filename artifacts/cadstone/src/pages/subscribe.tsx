import { LogOut } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { APP_LOGO_PATH, APP_NAME } from "@/lib/brand"
import { logoutSession } from "@/lib/api"
import { useDocumentTitle } from "@/hooks/use-document-title"
import BillingSection from "@/pages/settings/BillingSection"

export default function SubscribePage() {
  useDocumentTitle("Choose your plan")
  const navigate = useNavigate()

  async function handleLogout() {
    await logoutSession()
    navigate("/login", { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-18 max-w-5xl items-center justify-between px-5">
          <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-10 w-auto" />
          <Button type="button" variant="ghost" onClick={() => void handleLogout()}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-7 max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">
            Finish setting up your workspace
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            Start your SlabPlan subscription
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            Your account is ready. Complete the secure Stripe checkout to unlock
            the full platform for your company.
          </p>
        </div>
        <BillingSection onboarding />
      </main>
    </div>
  )
}
