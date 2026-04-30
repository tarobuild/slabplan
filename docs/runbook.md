# CAD Stone Networks — Production & Operations Runbook

**Audience:** whoever is on point when something breaks (Cesar, Anwar, or the technical owner). Keep this page short and current. If something here is wrong, fix it the same day.

**Production URL:** https://cadstonesystems.com
**Health endpoint:** https://cadstonesystems.com/api/healthz (returns `{"status":"ok"}`)
**Hosting:** Replit Deployments (Reserved VM, autoscale router)
**Database:** Supabase Postgres
**Object storage:** Replit App Storage (Google Cloud Storage)
**LLM:** Anthropic (Claude)

---

## 1. Smoke check — "is it working right now?"

You don't need to log in to do this. Open these in any browser or run them from a terminal:

```bash
# Liveness — should print {"status":"ok"} and return HTTP 200
curl -i https://cadstonesystems.com/api/healthz

# SPA loads — should return HTTP 200 with HTML
curl -I https://cadstonesystems.com/
```

If both return 200, the front door is up. If either fails, jump to **§4 Failure modes → api-server is down**.

To verify the database, log in to https://cadstonesystems.com and confirm the dashboard renders job/lead counts. (Counts come from Postgres; a blank dashboard usually means the DB is unreachable.)

To verify file storage, open any job that has photos attached and confirm a thumbnail loads. Thumbnails are signed URLs served from GCS through the api-server.

To verify the assistant, open the Sparkles "Assistant" panel and ask "what jobs do I have open?". A streamed reply with citation chips means Anthropic + the tool loop are healthy.

---

## 2. Alerts — how we find out something is wrong

We rely on two independent channels so a single outage doesn't silence both.

### 2a. Replit Deployments log-based alerts (internal signal)

Configured in the Replit Deployments console for the api-server artifact. Anyone with project access can view/edit them under **Deployments → Settings → Alerts**.

The three alerts we want:

| Alert | Trigger | Notify |
|---|---|---|
| Crash loop | Process restarts ≥ 3 times in 5 min | email Cesar + Anwar |
| 5xx spike | `statusCode>=500` log lines > 5% of all request lines over 5 min | email Cesar + Anwar |
| Unhandled error | Log line containing `"level":50` (pino `error`) or `Unhandled` | email Cesar + Anwar |

**To configure (one-time):**

1. Open the project on replit.com → **Deployments** → pick the production deployment for `artifacts/api-server`.
2. Click **Settings** → **Alerts** → **Add alert**.
3. For each row above, set the trigger (log query + threshold) and add both notification emails.
4. Save. Repeat for each of the three rules.

**To verify alerts fire:**

- Crash loop: in a *staging* deployment only, set `run` to a command that exits non-zero (e.g. `node -e "process.exit(1)"`) and watch the alert email arrive within ~5 min. Restore the real `run` immediately after.
- 5xx spike: in staging, hit a route that throws (e.g. send a malformed `POST /api/jobs` 50× in a loop) and confirm the email.
- Unhandled error: in staging, throw inside any route handler and confirm.

Do **not** run these checks against production — the alerts will fire on real users. If we don't have a staging deployment, document the planned verification here and run it the next time we cut a staging environment.

### 2b. External uptime monitor (independent signal)

If Replit's log pipeline itself is down, the internal alerts won't fire. The external monitor catches that case.

**Provider:** **UptimeRobot** free tier (50 monitors, 5-minute polling interval). We chose this because the project rule is "use free tiers" — UptimeRobot's free tier is the most generous for HTTPS checks. The trade-off is polling cadence: UptimeRobot free is 5 min, not the 1 min we originally aspired to. Practically this means our worst-case detection window is ~10 min (one missed poll, then the alert-on-2-consecutive threshold). If that ever feels too slow in practice, the upgrade options are (a) UptimeRobot Solo at ~$8/mo for 1-minute polling, or (b) **Better Stack** (formerly Better Uptime) free tier, which allows 3-minute polling on up to 10 monitors.

**To configure (one-time):**

1. Sign in to https://uptimerobot.com with the shared Cadstone ops account.
2. **+ New Monitor** → Type: **HTTPS**, URL: `https://cadstonesystems.com/api/healthz`.
3. Friendly name: `cadstone api healthz`.
4. Monitoring interval: **5 minutes** (free tier) — change to **1 minute** if/when the account is upgraded.
5. Alert when DOWN: **after 2 consecutive failures** (avoids flapping on a single missed ping). With 5-min polling that means alerts arrive within ~10 min of an outage; with 1-min polling, ~2 min.
6. Add notification contacts: Cesar's email, Anwar's email, and (optional) an SMS contact for off-hours.
7. Save. The monitor goes green within a few minutes if everything is healthy.

**To verify:** temporarily change the monitored URL to a known-bad path (e.g. `/api/healthz-broken`), confirm both contacts get a "DOWN" email within 2 polling intervals, then change it back.

### 2c. What to do when an alert fires

1. Open the smoke check in §1. If healthz is green, the alert is likely stale or noisy — record the timestamp and move on.
2. If healthz is failing or returning 5xx, jump to §4 for the matching failure mode.
3. Post in the team channel ("api looks down, investigating") so users know somebody is on it.

---

## 3. Where logs live

- **Replit Deployments console** → live tail of stdout/stderr from the api-server process. This is the first place to look for anything runtime.
- **Supabase dashboard** → SQL editor and query logs for the database.
- **GCS console** (via the GCP project linked to the App Storage sidecar) → bucket activity, IAM changes.
- **Anthropic console** (https://console.anthropic.com) → request logs and spend.

To pull logs programmatically while debugging, use the deployment skill's `fetch_deployment_logs` tool from the workspace.

---

## 4. Failure modes

Each entry: **how do you know** → **what to do**.

### 4.1 api-server is down or restart-looping

**How you know:** healthz returns connection-refused, 502, or 503; UptimeRobot posts a DOWN email; Replit alert fires for crash loop.

**What to do:**

1. Open the Replit Deployments console → live logs for the api-server.
2. Look at the last 50 lines before the crash. Common causes:
   - Missing/invalid env var → `Error: JWT_UPLOAD_SECRET must be configured`.
     → Re-add the secret in **Deployments → Secrets**, redeploy.
   - DB unreachable on boot → `getaddrinfo ENOTFOUND` or `password authentication failed`. → see §4.2.
   - GCS sidecar not provisioned → `PRIVATE_OBJECT_DIR is not set`.
     → see §4.3.
   - Out-of-memory → `JavaScript heap out of memory` or kernel OOM.
     → bump the Reserved VM tier in deployment settings, redeploy.
3. If the cause is a recent deploy, **roll back** to the prior version in the Deployments console (Deployments → previous version → Promote).
4. Once healthy, confirm with the §1 smoke check.

### 4.2 Database connection failures

**How you know:** dashboard is blank; API returns 500 with `problem+json` and a Postgres error in the logs (`ECONNREFUSED`, `28P01 password authentication failed`, `53300 too many connections`).

**What to do:**

1. Open the Supabase project dashboard → **Database** → **Status**.
   - If Supabase reports an incident, wait it out. Post in https://status.supabase.com to confirm.
2. If Supabase is healthy but our app can't connect, check the `SUPABASE_DATABASE_URL` (a.k.a. `DATABASE_URL`) secret in Replit Deployments. A stale password is the #1 cause; rotate per §5.
3. `53300 too many connections` → restart the api-server (Reserved VM pool exhausts itself if a deploy hung). If it recurs, lower `pool.max` in `lib/db/src/index.ts` or upgrade the Supabase plan.
4. As a last resort, switch the app into read-only / maintenance mode by shrinking the deployment to 0 instances and posting a "we're down, back shortly" notice in the team channel.

### 4.3 GCS upload/download failures

**How you know:** uploads return 500; thumbnails 404; logs contain `@google-cloud/storage` errors, `503 Service Unavailable`, or `PERMISSION_DENIED`.

**What to do:**

1. Confirm the failure isn't local: hit https://status.cloud.google.com for GCS regional incidents.
2. If GCS is up but we're getting `PERMISSION_DENIED`, the App Storage sidecar credentials may have expired. In Replit, open **Tools → Object Storage** for the project; if the sidecar is red, reconnect it. Redeploy after.
3. If `PRIVATE_OBJECT_DIR` is missing, object storage was never provisioned for this deployment. Provision via Tools → Object Storage and redeploy.
4. Transient `503` from GCS will self-heal — our upload code retries. If it persists > 10 min, open a GCS support ticket from the GCP console.

### 4.4 Anthropic API errors or budget exhaustion

**How you know:** the assistant panel shows an error toast; api-server logs include `AnthropicError`, `429 Too Many Requests`, or `insufficient_quota`. The per-user monthly token cap and the org-wide monthly budget are separate limits.

**What to do:**

1. Check https://status.anthropic.com for an Anthropic incident. If they're degraded, just wait it out — REST endpoints stay healthy and only the assistant feature is affected.
2. If the issue is `insufficient_quota` or `billing`, log into https://console.anthropic.com and add credit / raise the spend cap.
3. If the error is `429` with `type` ending in `/usage-limit` or `/org-usage-limit`, see §4.4.1 for budget management.
4. If a single user is being throttled (`AGENT_RATE_LIMIT_PER_MIN`, default 20/min), that's a soft limit — they can retry in a minute.
5. If the model name in `AGENT_MODEL` was deprecated (Anthropic announces these), bump it to the current Sonnet release and redeploy.

#### 4.4.1 Anthropic Token Budgets (Operations)

The assistant is metered through independent mechanisms. They all return HTTP `429`.

**Per-user monthly token cap (`AGENT_MONTHLY_TOKEN_CAP`)**
- **Default:** `500,000` tokens per user per calendar month (UTC).
- **Error:** `429` with `type` ending in `/usage-limit`.
- **Bump it:** `AGENT_MONTHLY_TOKEN_CAP=1000000`. Restart the API Reserved VM.

**Org-wide monthly token budget (`AGENT_MONTHLY_TOKEN_BUDGET`) — global kill switch**
- **Default:** `10,000,000` tokens for the whole workspace per calendar month (UTC).
- **Error:** `429` with `type` ending in `/org-usage-limit`.
- **Bump it:**
  1. Confirm spend at `GET /api/agent/usage/org` (admin-only).
  2. Set `AGENT_MONTHLY_TOKEN_BUDGET` to the new ceiling.
  3. Restart the API Reserved VM.
  4. Remember to lower it back next month.
- **Current usage snapshot:** `GET /api/agent/usage/org` (Admin only).
  ```json
  {
    "yearMonth": "2026-04",
    "inputTokens": 4231000,
    "outputTokens": 1820000,
    "totalTokens": 6051000,
    "requests": 318,
    "userCount": 5,
    "budget": 10000000,
    "remaining": 3949000,
    "exceeded": false
  }
  ```

**In-flight concurrency cap (`AGENT_MAX_INFLIGHT`)**
- **Default:** `1` concurrent assistant turn per user.
- **Error:** `429` with `type` ending in `/in-flight-limit`.

**Investigation Tip:** If the org budget is hit, run this SQL in Supabase to see who is using the most tokens:
```sql
SELECT user_id, sum(total_tokens)
FROM agent_usage_monthly
WHERE year_month = to_char(current_date, 'YYYY-MM')
GROUP BY 1 ORDER BY 2 DESC;
```

### 4.5 Certificate or domain issues

**How you know:** browsers show a TLS warning on https://cadstonesystems.com; UptimeRobot reports an SSL error; `curl` fails with `SSL certificate problem: certificate has expired`.

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
   Replit support (see §7) with the deployment ID.

### 4.6 Suspected security incident

Examples: a user account was compromised, a secret was committed to a public repo, unexpected data exfiltration, an unknown PAT showing up in `activity_log`.

**What to do, in order:**

1. **Contain.** If a specific account is compromised, log in as admin and rotate that user's password (or disable the account in the `users` table). Revoke any of their PATs in `account_tokens`.
2. **Rotate the blast-radius secrets.** At minimum: JWT secrets (per §5.1), and any third-party key the attacker plausibly saw (Anthropic, DB password). Rotate now, post-mortem later.
3. **Audit.** Run a SQL query against `activity_log` filtering on the suspect user / timeframe and capture the result. Save it to `attached_assets/incident-<date>.csv` so we have a frozen record.
4. **Notify.** Send a short factual note to the team. If real customer data is exposed, the technical owner is responsible for deciding whether external notification is required.
5. **Post-mortem.** Write a short "what happened, what we did, what we change" note in this repo (a new file under `docs/incidents/`) within one week.

---

## 5. Secret rotation

All secrets live in **Replit Deployments → Secrets** for production and in **.env / Replit Secrets** locally. Never commit secrets. Rotate on a schedule (every 6 months) and immediately on suspected compromise.

After rotating any secret, redeploy the api-server (the Replit Deployments console has a one-click **Redeploy** button) and run the §1 smoke check.

### 5.1 `JWT_UPLOAD_SECRET` (and `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)

These sign short-lived tokens used for uploads, API access, and refresh.

**What breaks during rotation:** every active session is invalidated. Logged-in users are logged out the next time their access token refreshes (within ~15 min). In-flight uploads holding a signed upload-cookie will get 401 and need to retry.

**Steps:**

1. Generate a new 64-byte hex secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
2. In Replit Deployments → Secrets, **update** the value for the secret you're rotating (don't delete + re-add — the deploy needs to see the new value at boot, not an empty value).
3. Redeploy. Watch logs for `JWT_*_SECRET must be configured` errors — the absence of those plus a successful login means the secret is wired correctly.
4. **Verify after:** log out and back in on production; upload a test file and confirm it succeeds.

Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` the same way. They're independent — you can rotate them one at a time to keep blast radius small.

### 5.2 `SUPABASE_DATABASE_URL` / `DATABASE_URL` password

The database URL embeds the Postgres password (`postgres://postgres:<password>@host:5432/postgres`).

**What breaks during rotation:** the api-server can't connect from the moment the password changes until you update the secret + redeploy. Plan a ~2-minute window.

**Steps:**

1. In the Supabase project → **Settings → Database** → **Reset database password**. Copy the new password.
2. Construct the full URL with the new password.
3. Update both `DATABASE_URL` and `SUPABASE_DATABASE_URL` in Replit Deployments → Secrets (we use both names for historical reasons — keep them in sync).
4. Redeploy.
5. **Verify after:** `curl https://cadstonesystems.com/api/healthz` → 200 OK. Then load the dashboard logged in as an admin and confirm counts populate.

### 5.3 Anthropic API key (`AI_INTEGRATIONS_ANTHROPIC_API_KEY`)

**What breaks during rotation:** the assistant panel returns errors between when you revoke the old key and update the secret. REST endpoints are unaffected — only the AI features.

**Steps:**

1. https://console.anthropic.com → **API Keys** → **Create Key**. Name it `cadstone-prod-YYYYMM`.
2. Copy the new key.
3. Update `AI_INTEGRATIONS_ANTHROPIC_API_KEY` in Replit Deployments → Secrets.
4. Redeploy.
5. **Verify after:** open the assistant panel on production, ask "what jobs are open?", confirm a streamed reply.
6. Once you're sure the new key works, **revoke the old key** in the Anthropic console.

### 5.4 GCS service account credentials (App Storage sidecar)

We don't manage GCS credentials directly — the Replit App Storage sidecar injects them. But they can still need rotating if (a) the sidecar is reconnected, or (b) GCS reports a leaked key.

**What breaks during rotation:** brief upload/download failures while the sidecar restarts (seconds to a minute).

**Steps:**

1. Replit project → **Tools → Object Storage** → **Reconnect / Rotate Credentials**. Confirm the prompt.
2. Redeploy the api-server (the new credentials are picked up via `PRIVATE_OBJECT_DIR` and the sidecar; a redeploy is the safest way to ensure no in-process client is holding the old creds).
3. **Verify after:** upload a test file in production and confirm it appears in the file browser; open an existing photo and confirm the thumbnail loads.

### 5.5 Other secrets

`AGENT_MONTHLY_TOKEN_CAP`, `AGENT_MAX_INFLIGHT`, `AGENT_RATE_LIMIT_PER_MIN`, `AGENT_MODEL`, `LOG_LEVEL`, `CORS_ALLOWED_ORIGINS` are configuration, not secrets — change them in Replit Deployments → Secrets the same way, but no rotation cadence is required.

---

## 6. Backup and recovery

This section covers backup posture, the most recent restore-drill log, and
the canonical step-by-step recovery procedure. Read **§6.3 Recovery
procedure** top to bottom before typing anything during an actual restore;
do not skip steps.

### 6.1 Drill-confirmed production facts

Captured during the 2026-04-30 drill so you don't have to re-discover them
in the middle of an incident:

| Thing | Value | Source |
| --- | --- | --- |
| Production database host | `aws-1-us-west-2.pooler.supabase.com:5432` (Supabase, AWS us-west-2) | `SUPABASE_DATABASE_URL` |
| Production database engine | PostgreSQL 17.6 | `SELECT version()` against prod, 2026-04-30 |
| App schema baseline | `public` (40 tables, 63 foreign keys) | live count, 2026-04-30 |
| Object storage bucket | `replit-objstore-e7153229-d7cd-46a3-b318-10d50b6b412e` (Replit App Storage / GCS) | `DEFAULT_OBJECT_STORAGE_BUCKET_ID` |
| Private upload prefix | `<bucket>/.private/cadstone/uploads/...` | `PRIVATE_OBJECT_DIR` env |
| Public asset prefix | `<bucket>/public/...` | `PUBLIC_OBJECT_SEARCH_PATHS` env |

### 6.2 Backup posture

#### Database (Supabase)

What Supabase provides for any project (publicly documented behavior):

- **Daily logical backups** of the entire Postgres database, taken
  automatically by the platform.
- **Retention** depends on the project's plan tier:
  - Free: 7 days, no download, no PITR.
  - Pro: 7 days by default, downloads enabled, PITR available as a paid
    add-on.
  - Team / Enterprise: longer retention windows, PITR included.
- **Access procedure**: backups live in the Supabase dashboard under
  *Project → Database → Backups*. Daily snapshots can be restored
  in-place to the same project, or downloaded as a `.sql` / `.tar` file
  from the same screen (Pro+).

What we have **not** yet confirmed for this specific project (requires
someone with Supabase dashboard access — not visible from inside the Repl):

- The exact plan tier and therefore the exact retention window in days.
- Whether **point-in-time recovery (PITR)** is enabled. This is the single
  most important thing to confirm before launch (it is also called out in
  `AUDIT_REPORT.md` as item 7.7 / step 3).
- Whether the project has any custom backup schedule overrides.

> **Action required (out of repo):** sign in to the Supabase dashboard
> for the CAD Stone Networks project, open *Database → Backups*, and:
>
> 1. Note the plan tier and the actual retention period in days.
> 2. Confirm PITR is **enabled** (or accept the risk in writing).
> 3. Update the §6.1 table above with the confirmed values.
>
> Until that is done, treat the daily-snapshot retention as "at least 7 days,
> but assume the worst case until verified."

#### Object storage (Replit App Storage / GCS)

CAD Stone Networks does **not** own the GCS bucket directly — it consumes
Replit's App Storage product, which provisions and manages a GCS bucket on
our behalf and brokers credentials through a sidecar at
`http://127.0.0.1:1106` (see `artifacts/api-server/src/lib/storage.ts`).

What this means for backup posture:

- We **cannot** set our own GCS lifecycle rules, object-versioning policy,
  or cross-region replication on the bucket. Those are managed by Replit.
  (If §4.3 sends you to look at the bucket's Lifecycle tab in the GCP
  console, you'll find it greyed out — that's expected.)
- We **can** (and do) verify at any time that we can list, download, and
  re-upload objects via the same authenticated client the API server uses
  (`@google-cloud/storage` + sidecar credentials). The drill below proves
  this.
- The bucket id is recorded in §6.1. Its name encodes the Repl ID and is
  stable for the lifetime of the project.

What happens if the bucket is wiped:

- The Postgres rows in `files` and `file_annotations` will still exist
  (they store metadata + the object key), but every signed-URL fetch and
  every `/api/storage/objects/...` request will return 404. The UI will
  show file rows that do not download.
- Recovery is **not currently automated**. There is no second copy of the
  uploaded files outside Replit App Storage.

Our policy decision for this internal tool, recorded here so it isn't
forgotten:

> Supabase's daily database backups + Replit App Storage's managed
> durability are the backstop. We do not maintain an independent copy
> of uploaded files. We accept this risk for an internal-only tool and
> mitigate it by **not deleting the bucket** under any circumstance.
>
> If the business need changes (e.g., we onboard external customers, we
> store originals of unique site photos, etc.), revisit this decision and
> add an out-of-Replit copy (e.g., a nightly `gsutil rsync` to a customer-
> owned GCS bucket).

### 6.3 Recovery procedure

Use this section when you are recovering production. Read it top to bottom
before typing anything; do not skip steps.

#### 6.3.0 Decide what you are recovering

| Symptom | Probable scope | Section to use |
| --- | --- | --- |
| Bad migration / accidental delete in last few hours | Database (point-in-time, if PITR enabled) | §6.3.1 |
| Whole DB corrupted / unreachable | Database (latest daily snapshot) | §6.3.2 |
| File downloads return 404 but rows still in `files` table | Object storage | §6.3.3 |

#### 6.3.1 Database — point-in-time recovery (PITR)

> Only available if PITR is enabled on the Supabase project. Confirm in the
> dashboard before assuming this works.

1. Open the Supabase dashboard → **Project → Database → Backups → Point in time**.
2. Pick the target timestamp (round to the nearest minute *before* the bad
   change). Note the timestamp in your incident log.
3. Choose **Restore in place** (overwrites prod) **or** **Restore to a new
   project** (safer; lets you copy specific tables back). For all but the
   most extreme outages, prefer restore-to-new-project so you keep the
   broken database around for forensics.
4. Wait for Supabase to provision the restored database. The dashboard
   shows progress.
5. If you restored to a new project: connect the API server's
   `SUPABASE_DATABASE_URL` to the new project, redeploy, and verify
   (§6.3.4).
6. If you restored in place: redeploy the API server (config is unchanged)
   and verify (§6.3.4).

#### 6.3.2 Database — restore from the latest daily snapshot

Use this when PITR isn't available, or when the corruption is older than
the PITR window.

1. **Stop writes.** In the Replit deployment dashboard, scale the API
   server down so no new mutations land while you restore. Mark the
   incident in `#cadstone-incidents` (or your channel of choice).
2. Open the Supabase dashboard → **Project → Database → Backups → Daily**.
   Note the most recent snapshot's timestamp; that is your recovery point.
3. Either:
   - **Click *Restore*** to roll the same project back to that snapshot
     (destructive; you lose changes since the snapshot), or
   - **Click *Download*** to get a `.tar` / `.sql` file you can replay
     into a scratch Postgres for triage. Continue with §6.3.2a if you
     took this path.
4. Once Supabase reports the restore complete, redeploy the API server
   and verify (§6.3.4).
5. Re-enable writes (scale the deployment back up) **only after** §6.3.4
   passes.

##### 6.3.2a Replay a downloaded snapshot into a scratch Postgres

This is the exact procedure from the 2026-04-30 drill. It is also useful
when you only need to recover specific rows (you replay into scratch,
`COPY` the rows you need, and `INSERT` them back into prod by hand).

```bash
# 0. Make sure Postgres 17 client tools are installed (Nix default is 16).
#    In the Repl: this was installed via the package-management skill.
ls -d /nix/store/*postgresql-17*  # confirm a 17.x exists
export PATH=/nix/store/<that-postgres-17>/bin:$PATH
pg_dump --version  # must say 17.x

# 1. Pick a working dir.
mkdir -p .local/restore-drill && cd .local/restore-drill

# 2. (If you don't already have a snapshot file from the dashboard,
#    take an equivalent one live. Skip this step if you downloaded
#    a real snapshot.)
pg_dump "$SUPABASE_DATABASE_URL" \
  --schema=public --format=custom \
  --no-owner --no-privileges \
  --file=cadstone-prod-$(date -u +%Y%m%dT%H%M%SZ).dump

# 3. Boot a scratch Postgres 17 cluster on a Unix socket.
PGDATA=$PWD/pgdata; SOCK=$PWD/run; mkdir -p "$SOCK"
initdb -D "$PGDATA" --locale=C --encoding=UTF8 --auth=trust -U scratch
pg_ctl -D "$PGDATA" -l "$PWD/postgres.log" \
  -o "-k $SOCK -p 55432 -c listen_addresses=''" -w start

# 4. Restore.
createdb -h "$SOCK" -p 55432 -U scratch cadstone_restore_drill
pg_restore -h "$SOCK" -p 55432 -U scratch -d cadstone_restore_drill \
  --no-owner --no-privileges -j 2 \
  cadstone-prod-*.dump

# 5. Sanity-check: count tables and rows.
psql -h "$SOCK" -p 55432 -U scratch -d cadstone_restore_drill \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
# expect: 40 (or whatever the schema count is at recovery time)

# 6. Stop the cluster when done.
pg_ctl -D "$PGDATA" stop -m fast
```

Expect one harmless warning during `pg_restore`: `schema "public" already
exists`. Anything else is real and worth investigating.

#### 6.3.3 Object storage — file is missing or 404s

1. **Confirm the row exists** in `files`:

   ```sql
   SELECT id, file_url, original_name, deleted_at
   FROM files WHERE id = '<file-id>';
   ```

   `file_url` should look like `/objects/.private/cadstone/uploads/...`.
2. **Confirm the bucket and credentials are healthy** with the committed
   round-trip script:

   ```bash
   # Requires DEFAULT_OBJECT_STORAGE_BUCKET_ID and PRIVATE_OBJECT_DIR
   # in env (already set in the Repl).
   cd artifacts/api-server && node scripts/storage-restore-drill.mjs
   ```

   The script lists, downloads, re-uploads, and cleans up under
   `.private/cadstone/restore-drill/`. If it exits 0, the bucket and our
   credentials are healthy and the missing file is per-object (e.g.
   manually deleted, never finished uploading), not bucket-wide.
3. If the **bucket itself** is gone, escalate to Replit support (see §7).
   We do not have an out-of-band copy of uploaded files — see "Object
   storage" in §6.2.

#### 6.3.4 Post-restore verification

Run these against the restored database before re-enabling writes:

```sql
-- Table count matches the recovery point.
SELECT count(*) FROM pg_tables WHERE schemaname='public';

-- Both admin accounts are present.
SELECT id, email, role FROM users WHERE role='admin' ORDER BY email;
-- expect: anwar@cadstone.works, cesar@cadstone.works  (until Task #216
-- changes the seeded admin set)

-- Most recent activity matches what users remember from before the
-- incident; pick any 3 they can recognize.
SELECT id, action, entity_type, created_at
FROM activity_log ORDER BY created_at DESC LIMIT 10;

-- The hand-pre-created composite index is present (it speeds folder
-- listings; see lib/db/runbooks/files-folder-created-id-index.md).
SELECT indexname FROM pg_indexes
WHERE tablename='files' AND indexname='files_folder_created_id_idx';

-- Foreign-key count is sane (drifts only when the schema changes).
SELECT count(*) FROM pg_constraint c
JOIN pg_class t ON c.conrelid=t.oid
JOIN pg_namespace n ON t.relnamespace=n.oid
WHERE n.nspname='public' AND c.contype='f';
-- baseline 2026-04-30: 63
```

Then exercise the API end-to-end as an admin:

1. Log in as `cesar@cadstone.works`.
2. Open the dashboard. Counts should be non-zero and match user memory.
3. Open one job, view its files panel — confirm at least one file
   downloads (proves both DB rows and object storage are healthy).
4. Create a throwaway lead, then delete it (proves writes work).

Only after all four steps pass, scale the API server back up and
announce recovery in the incident channel.

### 6.4 Most recent restore drill — 2026-04-30

A real, end-to-end restore drill was performed against a non-production
target. Notes are kept here so the next person doesn't have to rediscover
the gotchas.

**What we did**

1. Installed Postgres 17 client tools (`postgresql_17` Nix package).
   The Nix-default `pg_dump` is 16.10 which refuses to dump a 17.6 server.
2. Took a `pg_dump` of the production `public` schema in custom format
   (the same command shown in §6.3.2a step 2). This is logically
   equivalent to "downloading a recent backup file" from the Supabase
   dashboard; for a real DR exercise, swap that step for "click
   *Download* in the Supabase dashboard," then resume from step 3.
3. Booted a scratch Postgres 17.6 cluster locally with `initdb` +
   `pg_ctl`, listening on a Unix socket only.
4. `pg_restore -j 2` of the dump into a fresh `cadstone_restore_drill`
   database in the scratch cluster.
5. Verified table counts, total row counts, per-table row counts, a few
   representative queries, and that key indexes / FK constraints survived.
6. Ran an object-storage round-trip (list / download / re-upload / verify
   / cleanup) against the live bucket using the same Replit sidecar
   credentials the API server uses. The script is committed at
   `artifacts/api-server/scripts/storage-restore-drill.mjs` so future
   drills can re-run the exact same code.

**What we found — database**

- **Dump size:** 167 KB (`--format=custom`). The schema is small and the
  current production data set is tiny (837 rows total across the app).
- **Dump duration:** ~2 seconds.
- **Restore duration:** ~1 second on the scratch cluster.
- **Schema fidelity:** 40 public tables in the dump, 40 in the restored
  database. 63 foreign-key constraints present after restore.
- **Data fidelity:** per-table row counts are **bit-for-bit identical**
  between production and the restored database (`diff` on the two count
  files is empty).
- **Representative queries against the restored database:**
  - `SELECT id, email, role FROM users` returned the two expected
    admin accounts (`anwar@cadstone.works`, `cesar@cadstone.works`).
  - `SELECT id, title, status, created_at FROM jobs ORDER BY created_at
    DESC LIMIT 3` returned the three most recent jobs as seen in prod.
  - The composite index `files_folder_created_id_idx` (the one we hand-
    pre-create per `lib/db/runbooks/files-folder-created-id-index.md`)
    was present.
- **Warnings:** exactly one, benign — `schema "public" already exists`.
  Postgres always ships with the `public` schema; the dump tries to
  recreate it. Safe to ignore.

**What we found — object storage**

- Listed the first 25 objects under `<bucket>/.private/cadstone/`
  successfully via the sidecar-authenticated `@google-cloud/storage`
  client (no extra credentials needed).
- Downloaded the smallest object (`smoke.txt`, 5 bytes, ~190 ms).
- Re-uploaded those same bytes to a sibling key under
  `.private/cadstone/restore-drill/`, verified `exists()` returned true,
  re-downloaded, and confirmed bytes were equal (~120 ms upload).
- Cleaned up the round-trip object after verification (no test cruft
  left in the live bucket).

**What we did NOT verify in this drill**

- Restoring **from an actual Supabase-dashboard snapshot file** (vs. a
  live `pg_dump`). The schema/data path is identical; the human-procedure
  difference is only "where the file came from." A future drill should
  download a real snapshot from the dashboard at least once, end-to-end.
- **PITR-style recovery** to an arbitrary timestamp. We can't test this
  until PITR is confirmed enabled on the project (see §6.2 TODO).
- **Bucket recovery** in the case Replit App Storage loses data. We are
  explicitly relying on the platform here.

### 6.5 Re-running the drill

The drill is cheap (a few seconds end to end) and should be re-run:

- Quarterly, on a calendar reminder.
- Any time the database schema changes substantially (new tables, new
  required indexes).
- After any change to the Supabase plan or the object-storage provider.

When you re-run, update §6.4 with the new date, dump size, durations, and
table/row counts. Keep the previous entry so we can see the trend.

---

## 7. Who do I call

In order. Don't skip ahead — if the technical owner can solve it in 15 minutes, you don't need to involve a vendor.

1. **Technical owner** (this codebase) — first stop for any production incident. Phone + email on file with Cesar/Anwar.
2. **Replit Support** — for deployment-platform issues (build failures, TLS, custom domains, the deployments console itself).
   - Help center: https://help.replit.com/
   - Contact form: https://replit.com/support
   - Status page: https://status.replit.com/
3. **Supabase Support** — for database-level outages or restores.
   - Dashboard → **Help** in the bottom-left, or email `support@supabase.com`.
   - Status page: https://status.supabase.com/
4. **Google Cloud Storage Support** — for object-storage incidents.
   - Open via the GCP console → **Support → Cases**. Requires a paid support tier; for free tier, file in the public issue tracker: https://issuetracker.google.com/issues?q=componentid:187210
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
- The §6.4 drill log is a rolling record — add a new entry each time the
  drill is re-run (per §6.5) instead of overwriting.

---

## 9. Production maintenance log

Append-only record of meaningful production-data changes performed
outside the normal app flow (wipes, account purges, manual SQL, etc.).
Add a new dated entry; do not edit historical ones.

### 2026-04-30 — Account purge to leave only Cesar + Anwar

**What we set out to do:** wipe production data and re-seed with only
the two admin accounts (task `wipe-prod-and-fresh-seed`). Mid-task the
scope was narrowed by the operator to "remove the extra accounts but
keep the existing data so Cesar and Anwar walk into a populated app and
add their own team."

**What actually happened, in order:**

1. **Pre-wipe Supabase backup.** Took a `pg_dump --format=custom` of the
   live `public` schema using the Postgres 17.6 client (the Nix-default
   `pg_dump` 16.10 refuses a 17.6 server). Saved to
   `backups/prod-pre-wipe-20260430T205531Z.dump` (≈209 KB). The
   `backups/` directory is `.gitignore`d — the file lives in the
   workspace's filesystem only, not in git history.
2. **GCS uploads bucket emptied.** All 42 objects (~919 KB) under
   `<bucket>/.private/cadstone/uploads/` were deleted via
   `wipe-prod-data.mjs`. The bucket itself, IAM, the
   `<bucket>/public/` placeholder, and the sibling
   `.private/cadstone/restore-drill/` prefix were not touched. *Caveat:*
   the deletion fired during a local-target dry run because the App
   Storage bucket is workspace-shared; the script has since been hardened
   to require `--db=production` before touching the bucket.
3. **Database NOT truncated.** Per the operator's mid-task instruction
   the wipe was *not* run against the production database. All jobs,
   folders, leads, daily logs, schedule items, and activity log rows
   from before 2026-04-30 are still present.
4. **Five non-admin / demo accounts soft-deleted.** Inside a single
   transaction, set `deleted_at = NOW()` and `is_active = false` on:
   `cruz.martinez@cadstone.internal` (admin),
   `maria.garcia@cadstone.internal` (project_manager),
   `jake.thompson@cadstone.internal` (crew_member),
   `worker@cadstone.works` (crew_member),
   `invitee-rbf6_n@cadstone-test.example` (crew_member).
   Verified post-state: only `cesar@cadstone.works` and
   `anwar@cadstone.works` remain active, both `admin`. Soft delete was
   chosen over `DELETE` so foreign-key references in `jobs.created_by`,
   `jobs.project_manager_id`, `leads.created_by`, and similar columns
   don't get nulled-out (the audit trail stays intact, the user just
   can't log in). The `users_email_unique` index already filters
   `WHERE deleted_at IS NULL`, so the seats are free for re-use.

**Known follow-up risks the operator should be aware of:**

- *File rows now point at deleted GCS objects.* The 26 rows in
  `files` (and the 4 in `file_annotations`) reference uploads that were
  in the bucket at step 2. Any UI that tries to download those files
  will 404. The cleanest fix is for an admin to delete the orphaned
  file/folder rows from inside the app once Cesar and Anwar are on it.
  We deliberately did *not* mass-delete file rows because the operator
  asked for data preservation.
- *Cesar and Anwar's passwords were not rotated as part of this task.*
  Their `password_set_at` still equals their original `created_at`
  (2026-04-09). If those original passwords were ever the
  `Test1!` / `Test2!` strings called out in
  `.local/tasks/seed-script-hardening.md`, they need to be rotated
  manually via the Supabase dashboard before launch — see §5 for the
  rotation procedure pattern.
- *Some jobs / leads / schedule items show the soft-deleted users as
  creator or project manager.* That's expected; the rows render with
  the historical name but the user can no longer log in or be reassigned.

**Re-running the procedure:** the wipe path is committed at
`artifacts/api-server/scripts/wipe-prod-data.mjs` (DB truncate inside a
transaction + GCS prefix delete; production target requires both
`--db=production` and `--i-know-what-im-doing`). The reseed path is
`artifacts/api-server/scripts/seed-users.mjs` (same flag pattern).
Neither was used end-to-end on 2026-04-30; only the GCS half of the
wipe script ran.
