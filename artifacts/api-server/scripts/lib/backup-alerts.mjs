/**
 * Shared alerting helper for the daily database-backup pipeline.
 *
 * Used by:
 *   - `scripts/db-backup.mjs`        — alerts when a run fails outright.
 *   - `scripts/db-backup-check.mjs`  — alerts when today's backup is
 *                                      missing or suspiciously small.
 *
 * Two transports, both optional. If neither is configured the helper
 * logs a warning and resolves successfully (so the surrounding script
 * still exits non-zero on failure but doesn't crash on a missing
 * channel).
 *
 *   - Email via Resend.
 *       Required env: `RESEND_API_KEY`, `EMAIL_FROM`, `BACKUP_ALERT_EMAIL`
 *       (comma-separated list of recipients allowed).
 *
 *   - Generic webhook (Slack-compatible incoming webhook works as-is).
 *       Required env: `BACKUP_ALERT_WEBHOOK_URL`. Posts a JSON body
 *       `{ "text": "<subject>\n<message>" }` so a Slack incoming
 *       webhook renders it correctly. For non-Slack consumers the full
 *       structured payload is also included on the same JSON object.
 *
 * Exits are never thrown for alert-channel problems — the calling
 * script should treat the underlying backup failure as the primary
 * error and exit non-zero on its own. We log delivery failures so an
 * operator can see (in deployment logs) that the alert never made it
 * out, even though the backup itself was the more important signal.
 */

const ALERT_EMAIL_TAG = "backup-alert";

function parseRecipients(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendEmailAlert({ subject, message, context, log }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM?.trim();
  const recipients = parseRecipients(process.env.BACKUP_ALERT_EMAIL);

  if (!apiKey || !from || recipients.length === 0) {
    return { attempted: false, reason: "email_not_configured" };
  }

  let Resend;
  try {
    ({ Resend } = await import("resend"));
  } catch (err) {
    log("warn", "alert_email_import_failed", {
      err: err?.message ?? String(err),
    });
    return { attempted: true, ok: false, reason: "import_failed" };
  }

  const client = new Resend(apiKey);
  const text = [
    message,
    "",
    "Context:",
    JSON.stringify(context, null, 2),
    "",
    "— CAD Stone Networks db-backup pipeline",
  ].join("\n");

  try {
    const result = await client.emails.send({
      from,
      to: recipients,
      subject,
      text,
      tags: [{ name: "category", value: ALERT_EMAIL_TAG }],
    });
    if (result.error) {
      log("warn", "alert_email_failed", {
        err: result.error.message ?? String(result.error),
      });
      return { attempted: true, ok: false, reason: "resend_error" };
    }
    log("info", "alert_email_sent", {
      messageId: result.data?.id,
      recipients,
    });
    return { attempted: true, ok: true };
  } catch (err) {
    log("warn", "alert_email_failed", {
      err: err?.message ?? String(err),
    });
    return { attempted: true, ok: false, reason: "exception" };
  }
}

async function sendWebhookAlert({ subject, message, context, log }) {
  const url = process.env.BACKUP_ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    return { attempted: false, reason: "webhook_not_configured" };
  }

  const payload = {
    text: `*${subject}*\n${message}`,
    subject,
    message,
    context,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log("warn", "alert_webhook_failed", {
        status: res.status,
        body: body.slice(0, 500),
      });
      return { attempted: true, ok: false, reason: `http_${res.status}` };
    }
    log("info", "alert_webhook_sent", { status: res.status });
    return { attempted: true, ok: true };
  } catch (err) {
    log("warn", "alert_webhook_failed", {
      err: err?.message ?? String(err),
    });
    return { attempted: true, ok: false, reason: "exception" };
  }
}

/**
 * Fan-out a backup alert to every configured transport. Resolves once
 * all transports finish (in parallel). Never throws.
 */
export async function sendBackupAlert({ subject, message, context = {}, log }) {
  const safeLog =
    typeof log === "function"
      ? log
      : (level, event, extra) => {
          // Fallback when the caller doesn't supply its pino logger.
          // eslint-disable-next-line no-console
          console[level === "warn" || level === "error" ? "error" : "log"](
            JSON.stringify({ level, event, ...extra }),
          );
        };

  const [email, webhook] = await Promise.all([
    sendEmailAlert({ subject, message, context, log: safeLog }).catch((err) => ({
      attempted: true,
      ok: false,
      reason: `crash:${err?.message ?? err}`,
    })),
    sendWebhookAlert({ subject, message, context, log: safeLog }).catch((err) => ({
      attempted: true,
      ok: false,
      reason: `crash:${err?.message ?? err}`,
    })),
  ]);

  const anyAttempted = email.attempted || webhook.attempted;
  if (!anyAttempted) {
    safeLog("warn", "alert_no_channels_configured", {
      hint:
        "Set BACKUP_ALERT_EMAIL (+ RESEND_API_KEY + EMAIL_FROM) and/or BACKUP_ALERT_WEBHOOK_URL to receive backup alerts.",
    });
  }

  return { email, webhook };
}
