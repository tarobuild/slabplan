# CAD Stone Networks — Production Runbook

**Audience:** whoever is on point when something breaks (Cesar, Anwar, or the
technical owner). Keep this page short and current. If something here is wrong,
fix it the same day.

**Production URL:** https://cadstonesystems.com
**Health endpoint:** https://cadstonesystems.com/api/healthz (returns `{"status":"ok"}`)
**Hosting:** Replit Deployments (Reserved VM, autoscale router)
**Database:** Supabase Postgres
**Object storage:** Replit App Storage (Google Cloud Storage)
**LLM:** Anthropic (Claude)

---

## 1. Smoke check — "is it working right now?"

You don't need to log in to do this. Open these in any browser or run them
from a terminal:

```bash
# Liveness — should print {"status":"ok"} and return HTTP 200
curl -i https://cadstonesystems.com/api/healthz

# SPA loads — should return HTTP 200 with HTML
curl -I https://cadstonesystems.com/
```

If both return 200, the front door is up. If either fails, jump to
**§4 Failure modes → api-server is down**.

To verify the database, log in to https://cadstonesystems.com and confirm the
dashboard renders job/lead counts. (Counts come from Postgres; a blank
dashboard usually means the DB is unreachable.)

To verify file storage, open any job that has photos attached and confirm a
thumbnail loads. Thumbnails are signed URLs served from GCS through the
api-server.

To verify the assistant, open the Sparkles "Assistant" panel and ask "what
jobs do I have open?". A streamed reply with citation chips means Anthropic +
the tool loop are healthy.

---

## 2. Alerts — how we find out something is wrong

We rely on two independent channels so a single outage doesn't silence both.

### 2a. Replit Deployments log-based alerts (internal signal)

Configured in the Replit Deployments console for the api-server artifact.
Anyone with project access can view/edit them under
**Deployments → Settings → Alerts**.

The three alerts we want:

| Alert | Trigger | Notify |
|---|---|---|
| Crash loop | Process restarts ≥ 3 times in 5 min | email Cesar + Anwar |
| 5xx spike | `statusCode>=500` log lines > 5% of all request lines over 5 min | email Cesar + Anwar |
| Unhandled error | Log line containing `"level":50` (pino `error`) or `Unhandled` | email Cesar + Anwar |

**To configure (one-time):**

1. Open the project on replit.com → **Deployments** → pick the production
   deployment for `artifacts/api-server`.
2. Click **Settings** → **Alerts** → **Add alert**.
3. For each row above, set the trigger (log query + threshold) and add both
   notification emails.
4. Save. Repeat for each of the three rules.

**To verify alerts fire:**

- Crash loop: in a *staging* deployment only, set `run` to a command that
  exits non-zero (e.g. `node -e "process.exit(1)"`) and watch the alert email
  arrive within ~5 min. Restore the real `run` immediately after.
- 5xx spike: in staging, hit a route that throws (e.g. send a malformed
  `POST /api/jobs` 50× in a loop) and confirm the email.
- Unhandled error: in staging, throw inside any route handler and confirm.

Do **not** run these checks against production — the alerts will fire on
real users. If we don't have a staging deployment, document the planned
verification here and run it the next time we cut a staging environment.

### 2b. External uptime monitor (independent signal)

If Replit's log pipeline itself is down, the internal alerts won't fire.
The external monitor catches that case.

**Provider:** **UptimeRobot** free tier (50 monitors, 5-minute polling
interval). We chose this because the project rule is "use free tiers" —
UptimeRobot's free tier is the most generous for HTTPS checks. The
trade-off is polling cadence: UptimeRobot free is 5 min, not the 1 min we
originally aspired to. Practically this means our worst-case detection
window is ~10 min (one missed poll, then the alert-on-2-consecutive
threshold). If that ever feels too slow in practice, the upgrade options
are (a) UptimeRobot Solo at ~$8/mo for 1-minute polling, or (b) **Better
Stack** (formerly Better Uptime) free tier, which allows 3-minute polling
on up to 10 monitors.

**To configure (one-time):**

1. Sign in to https://uptimerobot.com with the shared Cadstone ops account.
2. **+ New Monitor** → Type: **HTTPS**, URL:
   `https://cadstonesystems.com/api/healthz`.
3. Friendly name: `cadstone api healthz`.
4. Monitoring interval: **5 minutes** (free tier) — change to **1 minute**
   if/when the account is upgraded.
5. Alert when DOWN: **after 2 consecutive failures** (avoids flapping on a
   single missed ping). With 5-min polling that means alerts arrive within
   ~10 min of an outage; with 1-min polling, ~2 min.
6. Add notification contacts: Cesar's email, Anwar's email, and (optional)
   an SMS contact for off-hours.
7. Save. The monitor goes green within a few minutes if everything is
   healthy.

**To verify:** temporarily change the monitored URL to a known-bad path
(e.g. `/api/healthz-broken`), confirm both contacts get a "DOWN" email
within 2 polling intervals, then change it back.

### 2c. What to do when an alert fires

1. Open the smoke check in §1. If healthz is green, the alert is likely
   stale or noisy — record the timestamp and move on.
2. If healthz is failing or returning 5xx, jump to §4 for the matching
   failure mode.
3. Post in the team channel ("api looks down, investigating") so users know
   somebody is on it.

---

## 3. Where logs live

- **Replit Deployments console** → live tail of stdout/stderr from the
  api-server process. This is the first place to look for anything runtime.
- **Supabase dashboard** → SQL editor and query logs for the database.
- **GCS console** (via the GCP project linked to the App Storage sidecar) →
  bucket activity, IAM changes.
- **Anthropic console** (https://console.anthropic.com) → request logs and
  spend.

To pull logs programmatically while debugging, use the deployment skill's
`fetch_deployment_logs` tool from the workspace.

---

## 4. Failure modes

Each entry: **how do you know** → **what to do**.

### 4.1 api-server is down or restart-looping

**How you know:** healthz returns connection-refused, 502, or 503; UptimeRobot
posts a DOWN email; Replit alert fires for crash loop.

**What to do:**

1. Open the Replit Deployments console → live logs for the api-server.
2. Look at the last 50 lines before the crash. Common causes:
   - Missing/invalid env var → `Error: JWT_UPLOAD_SECRET must be configured`.
     → Re-add the secret in **Deployments → Secrets**, redeploy.
   - DB unreachable on boot → `getaddrinfo ENOTFOUND` or
     `password authentication failed`. → see §4.2.
   - GCS sidecar not provisioned → `PRIVATE_OBJECT_DIR is not set`.
     → see §4.3.
   - Out-of-memory → `JavaScript heap out of memory` or kernel OOM.
     → bump the Reserved VM tier in deployment settings, redeploy.
3. If the cause is a recent deploy, **roll back** to the prior version in
   the Deployments console (Deployments → previous version → Promote).
4. Once healthy, confirm with the §1 smoke check.

### 4.2 Database connection failures

**How you know:** dashboard is blank; API returns 500 with
`problem+json` and a Postgres error in the logs (`ECONNREFUSED`,
`28P01 password authentication failed`, `53300 too many connections`).

**What to do:**

1. Open the Supabase project dashboard → **Database** → **Status**.
   - If Supabase reports an incident, wait it out. Post in
     https://status.supabase.com to confirm.
2. If Supabase is healthy but our app can't connect, check the
   `SUPABASE_DATABASE_URL` (a.k.a. `DATABASE_URL`) secret in Replit
   Deployments. A stale password is the #1 cause; rotate per §5.
3. `53300 too many connections` → restart the api-server (Reserved VM
   pool exhausts itself if a deploy hung). If it recurs, lower
   `pool.max` in `lib/db/src/index.ts` or upgrade the Supabase plan.
4. As a last resort, switch the app into read-only / maintenance mode by
   shrinking the deployment to 0 instances and posting a "we're down,
   back shortly" notice in the team channel.

### 4.3 GCS upload/download failures

**How you know:** uploads return 500; thumbnails 404; logs contain
`@google-cloud/storage` errors, `503 Service Unavailable`, or
`PERMISSION_DENIED`.

**What to do:**

1. Confirm the failure isn't local: hit
   https://status.cloud.google.com for GCS regional incidents.
2. If GCS is up but we're getting `PERMISSION_DENIED`, the App Storage
   sidecar credentials may have expired. In Replit, open
   **Tools → Object Storage** for the project; if the sidecar is red,
   reconnect it. Redeploy after.
3. If `PRIVATE_OBJECT_DIR` is missing, object storage was never
   provisioned for this deployment. Provision via Tools → Object Storage
   and redeploy.
4. Transient `503` from GCS will self-heal — our upload code retries.
   If it persists > 10 min, open a GCS support ticket from the GCP
   console.

### 4.4 Anthropic API errors or budget exhaustion

**How you know:** the assistant panel shows an error toast; api-server
logs include `AnthropicError`, `429 Too Many Requests`, or
`insufficient_quota`. The per-user monthly token cap is a separate,
in-app limit (`AGENT_MONTHLY_TOKEN_CAP`, default 500K) and surfaces in
the UI as a usage bar — that one is by design, not an outage.

**What to do:**

1. Check https://status.anthropic.com for an Anthropic incident. If
   they're degraded, just wait it out — REST endpoints stay healthy and
   only the assistant feature is affected.
2. If the issue is `insufficient_quota` or `billing`, log into
   https://console.anthropic.com and add credit / raise the spend cap.
   The org's billing email should already be on file with Anthropic.
3. If a single user is being throttled (`AGENT_RATE_LIMIT_PER_MIN`,
   default 20/min), that's a soft limit — they can retry in a minute.
   Raise the env var only if it's a recurring real-user complaint.
4. If the model name in `AGENT_MODEL` was deprecated (Anthropic
   announces these), bump it to the current Sonnet release and redeploy.

### 4.5 Certificate or domain issues

**How you know:** browsers show a TLS warning on
https://cadstonesystems.com; UptimeRobot reports an SSL error;
`curl` fails with `SSL certificate problem: certificate has expired`.

**What to do:**

1. Replit Deployments handles TLS automatically for `*.replit.app` and
   for the custom domain `cadstonesystems.com` once the DNS records are
   in place. Open **Deployments → Settings → Custom Domain** to confirm
   the domain is still verified.
2. If verification dropped, re-add the `A` / `TXT` records shown in the
   panel at our DNS registrar (Cadstone's domain provider). Replit will
   re-issue the cert within minutes once DNS resolves.
3. If the cert truly expired (rare — Replit auto-renews), force a
   redeploy; that retriggers issuance. If it still fails, contact
   Replit support (see §6) with the deployment ID.

### 4.6 Suspected security incident

Examples: a user account was compromised, a secret was committed to a
public repo, unexpected data exfiltration, an unknown PAT showing up in
`activity_log`.

**What to do, in order:**

1. **Contain.** If a specific account is compromised, log in as admin
   and rotate that user's password (or disable the account in the
   `users` table). Revoke any of their PATs in `account_tokens`.
2. **Rotate the blast-radius secrets.** At minimum: JWT secrets
   (per §5.1), and any third-party key the attacker plausibly saw
   (Anthropic, DB password). Rotate now, post-mortem later.
3. **Audit.** Run a SQL query against `activity_log` filtering on the
   suspect user / timeframe and capture the result. Save it to
   `attached_assets/incident-<date>.csv` so we have a frozen record.
4. **Notify.** Send a short factual note to the team. If real customer
   data is exposed, the technical owner is responsible for deciding
   whether external notification is required.
5. **Post-mortem.** Write a short "what happened, what we did, what we
   change" note in this repo (a new file under `docs/incidents/`) within
   one week.

---

## 5. Secret rotation

All secrets live in **Replit Deployments → Secrets** for production and in
**.env / Replit Secrets** locally. Never commit secrets. Rotate on a
schedule (every 6 months) and immediately on suspected compromise.

After rotating any secret, redeploy the api-server (the Replit Deployments
console has a one-click **Redeploy** button) and run the §1 smoke check.

### 5.1 `JWT_UPLOAD_SECRET` (and `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)

These sign short-lived tokens used for uploads, API access, and refresh.

**What breaks during rotation:** every active session is invalidated.
Logged-in users are logged out the next time their access token refreshes
(within ~15 min). In-flight uploads holding a signed upload-cookie will
get 401 and need to retry.

**Steps:**

1. Generate a new 64-byte hex secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
2. In Replit Deployments → Secrets, **update** the value for the secret
   you're rotating (don't delete + re-add — the deploy needs to see the
   new value at boot, not an empty value).
3. Redeploy. Watch logs for `JWT_*_SECRET must be configured` errors —
   the absence of those plus a successful login means the secret is
   wired correctly.
4. **Verify after:** log out and back in on production; upload a test
   file and confirm it succeeds.

Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` the same way. They're
independent — you can rotate them one at a time to keep blast radius
small.

### 5.2 `SUPABASE_DATABASE_URL` / `DATABASE_URL` password

The database URL embeds the Postgres password
(`postgres://postgres:<password>@host:5432/postgres`).

**What breaks during rotation:** the api-server can't connect from the
moment the password changes until you update the secret + redeploy.
Plan a ~2-minute window.

**Steps:**

1. In the Supabase project → **Settings → Database** → **Reset database
   password**. Copy the new password.
2. Construct the full URL with the new password.
3. Update both `DATABASE_URL` and `SUPABASE_DATABASE_URL` in Replit
   Deployments → Secrets (we use both names for historical reasons —
   keep them in sync).
4. Redeploy.
5. **Verify after:** `curl https://cadstonesystems.com/api/healthz` →
   200 OK. Then load the dashboard logged in as an admin and confirm
   counts populate.

### 5.3 Anthropic API key (`AI_INTEGRATIONS_ANTHROPIC_API_KEY`)

**What breaks during rotation:** the assistant panel returns errors
between when you revoke the old key and update the secret. REST endpoints
are unaffected — only the AI features.

**Steps:**

1. https://console.anthropic.com → **API Keys** → **Create Key**.
   Name it `cadstone-prod-YYYYMM`.
2. Copy the new key.
3. Update `AI_INTEGRATIONS_ANTHROPIC_API_KEY` in Replit Deployments →
   Secrets.
4. Redeploy.
5. **Verify after:** open the assistant panel on production, ask "what
   jobs are open?", confirm a streamed reply.
6. Once you're sure the new key works, **revoke the old key** in the
   Anthropic console.

### 5.4 GCS service account credentials (App Storage sidecar)

We don't manage GCS credentials directly — the Replit App Storage
sidecar injects them. But they can still need rotating if (a) the
sidecar is reconnected, or (b) GCS reports a leaked key.

**What breaks during rotation:** brief upload/download failures while
the sidecar restarts (seconds to a minute).

**Steps:**

1. Replit project → **Tools → Object Storage** → **Reconnect / Rotate
   Credentials**. Confirm the prompt.
2. Redeploy the api-server (the new credentials are picked up via
   `PRIVATE_OBJECT_DIR` and the sidecar; a redeploy is the safest way
   to ensure no in-process client is holding the old creds).
3. **Verify after:** upload a test file in production and confirm it
   appears in the file browser; open an existing photo and confirm the
   thumbnail loads.

### 5.5 Other secrets

`AGENT_MONTHLY_TOKEN_CAP`, `AGENT_MAX_INFLIGHT`, `AGENT_RATE_LIMIT_PER_MIN`,
`AGENT_MODEL`, `LOG_LEVEL`, `CORS_ALLOWED_ORIGINS` are configuration, not
secrets — change them in Replit Deployments → Secrets the same way, but
no rotation cadence is required.

---

## 6. Backup and restore

This section is the home for backup and recovery procedures. The detailed
"how to restore from a Supabase backup" walkthrough lives in the
**backup-restore-drill** task and will land here once that drill has been
performed end-to-end. Until then:

- **Postgres:** Supabase performs daily automatic backups. Retention and
  the exact restore procedure must be confirmed in the Supabase dashboard
  under **Database → Backups**. *Do not* assume backups exist without
  checking — the backup-restore-drill task is precisely about validating
  this.
- **Object storage (GCS):** files are stored under
  `$PRIVATE_OBJECT_DIR/cadstone/uploads/...`. The bucket has no lifecycle
  rules deleting objects today; confirm in the GCP console under the
  bucket's **Lifecycle** tab. If we ever need a point-in-time restore,
  enabling Object Versioning is a prerequisite.

When the backup-restore-drill task is complete, replace this stub with
the actual recovery procedure (commands + expected times), and link
the most recent drill log.

---

## 7. Who do I call

In order. Don't skip ahead — if the technical owner can solve it in 15
minutes, you don't need to involve a vendor.

1. **Technical owner** (this codebase) — first stop for any production
   incident. Phone + email on file with Cesar/Anwar.
2. **Replit Support** — for deployment-platform issues (build failures,
   TLS, custom domains, the deployments console itself).
   - Help center: https://help.replit.com/
   - Contact form: https://replit.com/support
   - Status page: https://status.replit.com/
3. **Supabase Support** — for database-level outages or restores.
   - Dashboard → **Help** in the bottom-left, or email
     `support@supabase.com`.
   - Status page: https://status.supabase.com/
4. **Google Cloud Storage Support** — for object-storage incidents.
   - Open via the GCP console → **Support → Cases**. Requires a paid
     support tier; for free tier, file in the public issue tracker:
     https://issuetracker.google.com/issues?q=componentid:187210
   - Status page: https://status.cloud.google.com/
5. **Anthropic Support** — for AI assistant issues.
   - https://support.anthropic.com/
   - Status page: https://status.anthropic.com/

---

## 8. Maintenance — keep this page honest

- Re-read this runbook at least quarterly. Anything stale, fix it.
- After any production incident, update the matching §4 entry with what
  you actually did (the runbook gets better with each incident).
- The §5 secrets list must match `process.env.*` usage in the code. If a
  new secret is added in code, add it here in the same PR.
