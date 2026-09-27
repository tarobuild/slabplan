import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, LogOut, Mail, ShieldCheck } from "lucide-react";
import { api, authApi } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-errors";
import { continueAuthentication } from "@/lib/security-flow";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";

type SecurityStatus = {
  email: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  recoveryCodesRemaining: number;
};

export default function AccountSecuritySection() {
  useDocumentTitle("Account security");
  const navigate = useNavigate();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    void api
      .get<SecurityStatus>("/auth/security")
      .then(({ data }) => {
        if (!cancelled) setStatus(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            apiErrorMessage(err, "Account security could not be loaded."),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (err) {
      setError(
        apiErrorMessage(err, "This security change could not be completed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Account security</h2>
      </header>
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{error}</p>
          {!status ? (
            <Button
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      {!status ? (
        <p className="text-sm text-muted-foreground">
          {error
            ? "Security status unavailable."
            : "Loading security status..."}
        </p>
      ) : (
        <>
          <section className="space-y-3 border-b border-border pb-6">
            <h3 className="text-sm font-semibold">Email address</h3>
            <p className="break-all text-sm">{status.email}</p>
            {status.emailVerified ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" />
                Verified
              </p>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await authApi.post("/auth/resend-verification", {
                      email: status.email,
                    });
                    setMessage(
                      "Verification requested. Check your inbox for the secure link.",
                    );
                  })
                }
              >
                <Mail className="mr-2 size-4" />
                Verify email
              </Button>
            )}
          </section>
          <section className="space-y-4 border-b border-border pb-6">
            <h3 className="text-sm font-semibold">Two-step verification</h3>
            {status.mfaEnabled ? (
              <>
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 className="size-4" />
                  Authenticator enabled{status.mfaRequired ? " (required)" : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {status.recoveryCodesRemaining} recovery codes remaining.
                </p>
              </>
            ) : (
              <form
                className="max-w-md space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const { data } = await api.post("/auth/security/setup", {
                      password,
                    });
                    setPassword("");
                    navigate(
                      continueAuthentication(data, "/settings/security"),
                    );
                  });
                }}
              >
                <Label htmlFor="security-password">Current password</Label>
                <Input
                  id="security-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Button type="submit" disabled={busy}>
                  <ShieldCheck className="mr-2 size-4" />
                  Set up authenticator
                </Button>
              </form>
            )}
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Sessions and API tokens</h3>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy}>
                  <LogOut className="mr-2 size-4" />
                  Sign out everywhere
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Revoke all account access?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This signs you out on every device and permanently revokes
                    your API tokens. Connected integrations will need new
                    tokens.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      void run(async () => {
                        await api.post("/auth/security/revoke-sessions");
                        useAuthStore.getState().clearAuth();
                        navigate("/login", { replace: true });
                      })
                    }
                  >
                    Sign out everywhere
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        </>
      )}
    </div>
  );
}
