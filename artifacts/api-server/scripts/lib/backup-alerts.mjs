/**
 * Shared alerting helper for the daily database-backup pipeline.
 *
 * Used by:
 *   - `scripts/db-backup.mjs`        — alerts when a run fails outright.
 *   - `scripts/db-backup-check.mjs`  — alerts when today's backup is
 *                                      missing or suspiciously small.
 *
 * One optional transport. If it is not configured the helper logs a
 * warning and resolves successfully (so the surrounding script still exits
 * non-zero on failure but doesn't crash on a missing channel).
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
 * Send a backup alert to the configured transport. Never throws.
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

  const webhook = await sendWebhookAlert({
    subject,
    message,
    context,
    log: safeLog,
  }).catch((err) => ({
    attempted: true,
    ok: false,
    reason: `crash:${err?.message ?? err}`,
  }));

  if (!webhook.attempted) {
    safeLog("warn", "alert_no_channels_configured", {
      hint: "Set BACKUP_ALERT_WEBHOOK_URL to receive backup alerts.",
    });
  }

  return { webhook };
}
