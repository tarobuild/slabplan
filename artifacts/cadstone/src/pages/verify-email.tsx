import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Mail } from "lucide-react";
import { authApi } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-errors";
import { useSecurityFlow } from "@/lib/security-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function VerifyEmailPage() {
  useDocumentTitle("Verify email");
  const flow = useSecurityFlow();
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
  );
  const [email, setEmail] = useState(flow.email);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState(
    flow.emailSent === false
      ? "Your account was created, but the verification email could not be delivered. Request a new link below."
      : "",
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (token)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      );
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (token) {
        await authApi.post("/auth/verify-email", { token });
        setVerified(true);
      } else {
        await authApi.post("/auth/resend-verification", { email });
        setMessage(
          "If this account needs verification, a new link has been sent. Check your inbox and spam folder.",
        );
      }
    } catch (err) {
      setError(
        apiErrorMessage(err, "Email verification could not be completed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-md space-y-6">
        {verified ? (
          <CheckCircle2 className="size-8 text-emerald-600" />
        ) : (
          <Mail className="size-8 text-primary" />
        )}
        <h1 className="text-2xl font-semibold">
          {verified ? "Email verified" : "Verify your email"}
        </h1>
        {verified ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your email is confirmed. Sign in to continue.
            </p>
            <Button asChild className="w-full">
              <Link to="/login">Continue to sign in</Link>
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {!token ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Email confirmation is required before account setup and
                  subscription checkout.
                </p>
                <Label htmlFor="verification-email">Work email</Label>
                <Input
                  id="verification-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </>
            ) : null}
            {message ? (
              <p
                role="status"
                className="text-sm leading-6 text-muted-foreground"
              >
                {message}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Please wait..."
                : token
                  ? "Verify email"
                  : "Send verification link"}
            </Button>
            {token && error ? (
              <Link
                to="/verify-email"
                reloadDocument
                className="block text-center text-sm text-primary underline"
              >
                Request a new link
              </Link>
            ) : null}
          </form>
        )}
        <Link
          to="/login"
          className="block text-center text-sm text-muted-foreground underline"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
