import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { authApi } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-errors";
import { continueAuthentication, useSecurityFlow } from "@/lib/security-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function AccountVerificationPage() {
  useDocumentTitle("Account verification");
  const flow = useSecurityFlow();
  const navigate = useNavigate();
  const [enrollment, setEnrollment] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    if (!flow.challengeToken || flow.mode !== "setup") return;
    let cancelled = false;
    void authApi
      .post("/auth/security/enroll", { challengeToken: flow.challengeToken })
      .then(({ data }) => {
        if (!cancelled) setEnrollment(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(apiErrorMessage(err, "Security setup could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [flow.challengeToken, flow.mode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await authApi.post(
        flow.mode === "setup" ? "/auth/security/confirm" : "/auth/mfa/verify",
        { challengeToken: flow.challengeToken, code },
      );
      if (Array.isArray(data.recoveryCodes) && data.recoveryCodes.length)
        setRecovery(data.recoveryCodes);
      const destination = continueAuthentication(data, flow.destination);
      setEnrollment(null);
      setCode("");
      if (!data.recoveryCodes?.length) navigate(destination, { replace: true });
    } catch (err) {
      setError(
        apiErrorMessage(err, "Verification failed. Please try a fresh code."),
      );
    } finally {
      setBusy(false);
    }
  }

  function downloadRecovery() {
    const url = URL.createObjectURL(
      new Blob(
        [
          "SlabPlan recovery codes\nKeep these private. Each code works once.\n\n" +
            recovery.join("\n"),
        ],
        { type: "text/plain" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "slabplan-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-md space-y-5">
        <ShieldCheck className="size-8 text-primary" />
        <h1 className="text-2xl font-semibold">
          {recovery.length
            ? "Keep your recovery codes"
            : flow.mode === "setup"
              ? "Secure your account"
              : "Two-step verification"}
        </h1>
        {recovery.length ? (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              These codes are shown once. Store them in your password manager.
              Each code can replace an authenticator code one time.
            </p>
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-6">
                {recovery.join("\n")}
              </pre>
              <Button
                variant="outline"
                size="icon"
                aria-label="Download recovery codes"
                title="Download recovery codes"
                onClick={downloadRecovery}
              >
                <Download className="size-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="recovery-saved"
                checked={saved}
                onCheckedChange={(value) => setSaved(value === true)}
              />
              <Label htmlFor="recovery-saved">
                I have stored my recovery codes securely
              </Label>
            </div>
            <Button
              className="w-full"
              disabled={!saved}
              onClick={() => {
                setRecovery([]);
                navigate(flow.destination, { replace: true });
              }}
            >
              Continue
            </Button>
          </>
        ) : !flow.challengeToken ? (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in again to start a fresh verification.
            </p>
            <Button asChild>
              <Link to="/login">Sign in</Link>
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {flow.mode === "setup" ? (
              <>
                <p className="text-sm leading-6 text-muted-foreground">
                  Add SlabPlan to your authenticator app, then enter its
                  six-digit code. New workspace owners must complete this before
                  checkout.
                </p>
                {enrollment ? (
                  <div className="space-y-3">
                    <div className="flex justify-center bg-white py-3">
                      <QRCodeSVG
                        value={enrollment.uri}
                        size={184}
                        marginSize={4}
                        title="SlabPlan authenticator enrollment"
                      />
                    </div>
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        Manual setup key
                      </summary>
                      <code className="mt-2 block select-all break-all rounded bg-muted p-3">
                        {enrollment.secret}
                      </code>
                    </details>
                  </div>
                ) : (
                  <p role="status" className="text-sm text-muted-foreground">
                    {error ? "Setup unavailable." : "Preparing secure setup..."}
                  </p>
                )}
              </>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="factor-code">
                {recoveryMode ? "Recovery code" : "Authenticator code"}
              </Label>
              <Input
                id="factor-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={recoveryMode ? "text" : "numeric"}
                autoComplete="one-time-code"
                maxLength={recoveryMode ? 64 : 6}
                pattern={recoveryMode ? undefined : "[0-9]{6}"}
                required
                autoFocus
                className="h-12 text-base"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || (flow.mode === "setup" && !enrollment)}
            >
              {busy
                ? "Verifying..."
                : flow.mode === "setup"
                  ? "Enable two-step verification"
                  : "Verify and sign in"}
            </Button>
            {flow.mode === "login" ? (
              <button
                type="button"
                className="text-sm text-primary underline"
                onClick={() => {
                  setRecoveryMode((value) => !value);
                  setCode("");
                }}
              >
                {recoveryMode
                  ? "Use authenticator code"
                  : "Use a recovery code"}
              </button>
            ) : null}
          </form>
        )}
        {!recovery.length ? (
          <Link
            to="/login"
            onClick={() => useSecurityFlow.setState({ challengeToken: null })}
            className="block text-sm text-muted-foreground underline"
          >
            Back to sign in
          </Link>
        ) : null}
      </div>
    </main>
  );
}
