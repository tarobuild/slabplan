import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { authApi } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { useDocumentTitle } from "@/hooks/use-document-title"
import { APP_DESCRIPTION, APP_LOGO_PATH, APP_NAME } from "@/lib/brand"
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal"
import { toast } from "sonner"

export default function RegisterPage() {
  useDocumentTitle("Create account")
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [organizationName, setOrganizationName] = useState("")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [acceptedLegal, setAcceptedLegal] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await authApi.post("/auth/register", {
        organization_name: organizationName,
        full_name: fullName,
        email,
        password,
        accepted_terms_version: TERMS_VERSION,
        accepted_privacy_version: PRIVACY_VERSION,
      })
      setAuth(data.user, data.accessToken)
      navigate("/subscribe", { replace: true })
      toast.success("Account created. Choose your SlabPlan subscription.")
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to create account")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-surface flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md border-border bg-card shadow-sm">
        <CardHeader className="space-y-3 items-center text-center">
          <img src={APP_LOGO_PATH} alt={APP_NAME} className="h-12 w-auto mx-auto" />
          <div>
            <CardTitle className="text-lg text-foreground">Create an account</CardTitle>
            <CardDescription className="mt-0.5 text-sm text-muted-foreground">
              {APP_DESCRIPTION}
            </CardDescription>
          </div>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="organizationName">Company name</Label>
              <Input
                id="organizationName"
                type="text"
                autoComplete="organization"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="Stone Works Co."
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="Min. 8 characters"
                required
              />
            </div>
            <div className="flex items-start gap-3 rounded border border-slate-200 bg-slate-50 p-3">
              <Checkbox
                id="legal-acceptance"
                checked={acceptedLegal}
                onCheckedChange={(value) => setAcceptedLegal(value === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="legal-acceptance"
                className="text-sm font-normal leading-6 text-slate-600"
              >
                I agree to the{" "}
                <Link
                  to="/terms"
                  target="_blank"
                  className="font-medium text-primary hover:underline"
                >
                  Terms of Service
                </Link>{" "}
                and acknowledge the{" "}
                <Link
                  to="/privacy"
                  target="_blank"
                  className="font-medium text-primary hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </Label>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading || !acceptedLegal}>
              {loading ? "Creating account…" : "Create account"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
