# Database Restore Drill

This drill walks the operator through restoring one of the daily Postgres
backups produced by `artifacts/api-server/scripts/db-backup.mjs` into a
throwaway database and sanity-checking the row counts. Run it at least
once per quarter so the recovery story is exercised before we actually
need it.

> **Scheduling.** Two options ship in the repo, either is fine:
> 1. The GitHub Action at `.github/workflows/db-backup.yml`, which POSTs
>    to the api-server's `/api/internal/run-db-backup` webhook so the
>    backup actually runs *inside* the production deployment (where the
>    object-storage sidecar lives). Requires repo secrets
>    `BACKUP_WEBHOOK_URL` and `BACKUP_TRIGGER_SECRET`, plus the matching
>    `BACKUP_TRIGGER_SECRET` on the api-server deployment.
> 2. A Replit Scheduled Deployment (build: `pnpm --filter
>    @workspace/api-server install --frozen-lockfile`, run: `pnpm
>    --filter @workspace/api-server run backup:db`, schedule: `0 9 * *
>    *`, same secrets as the api-server deployment).
>
> The script is idempotent per UTC day, so running both schedulers is
> harmless if you want belt-and-braces.
>
> **Alerting.** Both the backup script (`db-backup.mjs`) and a separate
> nightly verifier (`db-backup-check.mjs`, run via
> `pnpm --filter @workspace/api-server run backup:check`) page on-call
> via the helper at `artifacts/api-server/scripts/lib/backup-alerts.mjs`.
> Two transports, both optional and independently configured:
> - **Email (Resend):** set `RESEND_API_KEY`, `EMAIL_FROM`, and
>   `BACKUP_ALERT_EMAIL` (comma-separated list of recipients) on the
>   deployment that runs the script. Reuses the same Resend account
>   the api-server uses for invites/password resets.
> - **Webhook (Slack-compatible):** set `BACKUP_ALERT_WEBHOOK_URL` to
>   any incoming-webhook URL. The payload is `{text, subject, message,
>   context}` so a Slack incoming webhook renders the `text` field and
>   richer consumers can inspect `context`.
> If neither is configured the scripts log a warning (`event:
> alert_no_channels_configured`) but the underlying failure exit code
> is preserved so a job-status monitor still sees the red run.
>
> `db-backup.mjs` alerts on any failed run and includes the most recent
> successful backup timestamp/size in the alert body. `db-backup-check.mjs`
> alerts when today's `backups/db/YYYY-MM-DD.sql.gz` is missing or when
> its size is outside ±50 % of the trailing 7-day median (tunable via
> `BACKUP_SIZE_TOLERANCE_PCT` and `BACKUP_HISTORY_WINDOW_DAYS`). Schedule
> the check a few hours after the backup itself — e.g. backup at
> `0 9 * * *`, check at `0 12 * * *`.

It is the database analogue of the object-storage drill described in
`artifacts/api-server/scripts/storage-restore-drill.mjs`.

The drill is **read-only against production**: it pulls a backup from
object storage, restores it into a brand-new local database, runs a
short read-only checklist against the restore, and drops the local
database at the end. **Never restore into the live Supabase database**
— if that becomes necessary, follow the production recovery procedure
in §4 instead.

---

## 0. Prerequisites

- `psql` and `pg_dump`/`pg_restore` available locally (the Replit
  workspace's `nodejs-24` + `postgresql-16` modules already include
  these).
- Read access to the object-storage bucket (the same credentials the
  api-server uses; running inside the Repl handles this automatically
  via the sidecar).
- Local Postgres running on `127.0.0.1:5432` with a superuser named
  `cadstone` (matches the test DB conventions in
  `lib/db/src/scripts/ensure-test-db.ts`).

## 1. Pick a backup

List the available backups (newest first) and choose one. The default
prefix is `backups/db/`:

```bash
node -e "
import('@google-cloud/storage').then(async ({ Storage }) => {
  const s = new Storage({
    credentials: {
      audience: 'replit',
      subject_token_type: 'access_token',
      token_url: 'http://127.0.0.1:1106/token',
      type: 'external_account',
      credential_source: {
        url: 'http://127.0.0.1:1106/credential',
        format: { type: 'json', subject_token_field_name: 'access_token' },
      },
      universe_domain: 'googleapis.com',
    },
    projectId: '',
  });
  const [files] = await s
    .bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID)
    .getFiles({ prefix: 'backups/db/' });
  for (const f of files.sort((a,b)=>b.name.localeCompare(a.name)).slice(0,20)) {
    console.log(f.name, f.metadata.size, 'bytes');
  }
});
"
```

Pick a date — for the drill, the most recent daily backup is fine.
Export the choice for the rest of the steps:

```bash
export BACKUP_DATE=2026-05-02   # whichever date you picked
```

## 2. Download the backup

```bash
node -e "
import('@google-cloud/storage').then(async ({ Storage }) => {
  const s = new Storage({
    credentials: {
      audience: 'replit',
      subject_token_type: 'access_token',
      token_url: 'http://127.0.0.1:1106/token',
      type: 'external_account',
      credential_source: {
        url: 'http://127.0.0.1:1106/credential',
        format: { type: 'json', subject_token_field_name: 'access_token' },
      },
      universe_domain: 'googleapis.com',
    },
    projectId: '',
  });
  await s
    .bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID)
    .file('backups/db/' + process.env.BACKUP_DATE + '.sql.gz')
    .download({ destination: '/tmp/restore-drill.sql.gz' });
  console.log('downloaded → /tmp/restore-drill.sql.gz');
});
"

ls -lh /tmp/restore-drill.sql.gz
```

## 3. Restore into a throwaway database

```bash
DRILL_DB="cadstone_restore_drill_$(date -u +%Y%m%d%H%M)"
psql "postgres://cadstone:cadstone@127.0.0.1:5432/postgres" \
  -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\";" \
  -c "CREATE DATABASE \"${DRILL_DB}\";"

gunzip -c /tmp/restore-drill.sql.gz \
  | psql "postgres://cadstone:cadstone@127.0.0.1:5432/${DRILL_DB}"
```

The restore should finish without `ERROR:` lines; warnings about
extensions or roles are expected and safe.

## 4. Sanity-check the restore

Run the row-count checklist below. The actual values don't matter — what
matters is that they are **sensible** (non-zero on tables you expect to
have rows in, and roughly aligned with what you remember from the
production dashboard).

```bash
psql "postgres://cadstone:cadstone@127.0.0.1:5432/${DRILL_DB}" -c "
  SELECT 'users'                  AS table, COUNT(*) FROM users           UNION ALL
  SELECT 'jobs'                   ,         COUNT(*) FROM jobs            UNION ALL
  SELECT 'clients'                ,         COUNT(*) FROM clients         UNION ALL
  SELECT 'leads'                  ,         COUNT(*) FROM leads           UNION ALL
  SELECT 'schedule_items'         ,         COUNT(*) FROM schedule_items  UNION ALL
  SELECT 'daily_logs'             ,         COUNT(*) FROM daily_logs      UNION ALL
  SELECT 'files'                  ,         COUNT(*) FROM files           UNION ALL
  SELECT 'folders'                ,         COUNT(*) FROM folders         UNION ALL
  SELECT 'agent_messages'         ,         COUNT(*) FROM agent_messages  UNION ALL
  SELECT 'activity_log'           ,         COUNT(*) FROM activity_log
  ORDER BY 1;
"
```

Acceptance:

- `users` ≥ the active team size (today: 5–10).
- `jobs` ≥ 1 and `clients` ≥ 1 (production has both).
- `activity_log` and `agent_messages` are large (these grow continuously);
  a count of zero almost certainly means the restore picked an empty
  backup file and the run should be flagged.
- Run a few targeted spot-checks against rows you recognise — for
  example, the email of the founding admin user must be present:

  ```sql
  SELECT id, email, role, is_active
    FROM users WHERE email LIKE '%@cadstoneworks.com' ORDER BY email;
  ```

## 5. Drop the throwaway database

Always clean up so the next drill starts from zero:

```bash
psql "postgres://cadstone:cadstone@127.0.0.1:5432/postgres" \
  -c "DROP DATABASE \"${DRILL_DB}\";"
rm -f /tmp/restore-drill.sql.gz
```

Record the run in the team channel: date of the drill, backup date you
restored, and anything that surprised you. If a drill fails, file a P1
ticket and re-run after the underlying issue is fixed — a backup that
can't be restored is worse than no backup.

---

## A. Production recovery procedure (real outage)

When the production database itself is corrupt and you actually need to
restore:

1. Stop the api-server deployment (`replit deploy stop`) so writes don't
   continue against the broken DB.
2. Pull the most recent good backup from object storage as in §2.
3. Spin up a new Supabase project (or use Supabase's PITR if the
   incident window is small enough — see §B).
4. Apply the backup with `psql` against the new database (same command
   shape as §3 but pointing at the new Supabase host).
5. Update `SUPABASE_DATABASE_URL` in production secrets and redeploy.
6. Once the new DB is verified, write a postmortem and link it from
   `replit.md`.

## B. Supabase PITR (out of scope here)

Supabase's own PITR / auto-backups are the first line of defence for a
recent incident (last few hours). The cron-based `db-backup.mjs` covers
the longer-tail case where Supabase has a multi-day outage or a logical
corruption (e.g. accidental `DELETE FROM jobs`) that PITR can no longer
help with.

---

## C. Drill log

Repeat this drill at least once per quarter and append a dated entry
below. Keep entries short and factual — full output lives in deployment
logs / the operator's terminal scrollback.

### 2026-05-06 — first end-to-end drill (Task #347)

Operator: agent (pre-launch readiness). Drill ran inside the workspace
Repl against the live Supabase database (read-only via `pg_dump`) and a
throwaway Postgres 17 instance launched on `127.0.0.1:5433` with
`PGDATA=/tmp/drill-pg`.

**Tooling note.** Production Supabase is Postgres 17.6 but the workspace
default `pg_dump` is 16.10, which aborts with `server version mismatch`.
Installed `postgresql_17` as a system dependency and used the 17.6
`pg_dump` binary at
`/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin/pg_dump`.
The deployed `db-backup.mjs` runs under the api-server's own
`postgresql-17` module so it does not have this problem in production —
only the local drill needed the manual install.

**1. Backup** — two independent runs, both green:

(a) **Local pipe-to-file** (used for parity / restore step):

| field          | value                                                              |
|----------------|--------------------------------------------------------------------|
| command        | `pg_dump --no-owner --no-privileges --format=plain $URL \| gzip -6` |
| exit code      | 0                                                                  |
| elapsed        | 5 s                                                                |
| file size      | 38 352 bytes (gzip)                                                |
| sha256         | `11424c0acc961c82d49d5a4eaf38c2b7291ccfd7e9a55b7e2faaf2f18fe35480` |
| stderr         | empty                                                              |

(b) **Real `scripts/db-backup.mjs`** invocation against the production
bucket (no overrides except `PG_DUMP_BIN`):

| field          | value                                                              |
|----------------|--------------------------------------------------------------------|
| command        | `node scripts/db-backup.mjs`                                       |
| exit code      | 0                                                                  |
| pino events    | `backup_start` → `backup_uploaded` (5 397 ms) → `prune_summary` (total 1 / keep 1 / delete 0) → `backup_done` |
| object         | `backups/db/2026-05-06.sql.gz`                                     |
| size on bucket | 38 266 bytes (gzip)                                                |

This is the first object that has ever existed in the production
`backups/db/` prefix; it remains in the bucket as the seed of the
ongoing daily series.

**2. Restore**

| field      | value                                                              |
|------------|--------------------------------------------------------------------|
| target DB  | `cadstone_restore_drill_20260506184516` (dropped at end of drill)  |
| command    | `gunzip -c dump.sql.gz \| psql -d $DRILL_DB -v ON_ERROR_STOP=0`    |
| exit code  | 0                                                                  |
| elapsed    | 2 838 ms                                                           |
| ERROR rows | 3 — all expected: `extension "supabase_vault" is not available`, `… does not exist`, `relation "vault.secrets" does not exist`. Supabase-specific extension that we never query; harmless. |

**3. Row-count parity (every domain table)**

```
                source  restored
users               2       2     ✓
jobs                0       0     ✓
clients             0       0     ✓
leads               0       0     ✓
schedule_items      0       0     ✓
daily_logs          0       0     ✓
tracker_invoices    0       0     ✓
change_orders       0       0     ✓
activity_log        0       0     ✓
agent_messages      0       0     ✓
files               0       0     ✓
folders             0       0     ✓
```

`diff` of the source / restored count files: **clean**. PARITY: PASS.

**4. Spot-check (PII redacted) + app-tier smoke**

Row-level spot-check (SQL):

```
SOURCE                                                       RESTORED
cdc1a565-c57b-42da-93b5-bbbc11c83ca3 ces***@cadstone.works   ✓ identical
d78cbec7-9403-4b8d-b312-b2ae8d2c6e8f anw***@cadstone.works   ✓ identical
```

Both founding admin accounts present in the restored DB with matching
`id`, `role=admin`, `is_active=true`.

App-tier smoke: booted `artifacts/api-server` (the production
`dist/index.mjs` bundle) on port 7799 with `SUPABASE_DATABASE_URL` and
`DATABASE_URL` overridden to point at the restored throwaway DB
(`cadstone_smoke_20260506185313`). Boot log:

```
[db] connecting via SUPABASE_DATABASE_URL host=127.0.0.1 db=cadstone_smoke_…
[boot] LISTENING { host: '0.0.0.0', port: 7799 }
```

| request                    | status | notes                                                  |
|----------------------------|--------|--------------------------------------------------------|
| `GET /api/livez`           | 200    | `{"status":"ok"}`                                      |
| `GET /api/healthz`         | 503    | `{"db":true,"storage":false,…}` — **db check passed against the restored DB.** Storage check failed because the workspace IAM doesn't have `storage.buckets.get` on the prod bucket; that is a workspace-credential quirk unrelated to the backup pipeline. |
| `GET /api/auth/me`         | 401    | Auth middleware reached and rejected anonymous request — proves the auth → DB path is live against the restored DB. |

The full "log in to the UI, browse to a job, see the same daily logs"
spot-check is **not yet possible** (the production DB has 2 admin
users and 0 jobs/clients/logs pre-launch — there is nothing to open).
Re-run the visual spot-check on the first quarterly drill after the
first real client is onboarded; the launch-readiness task carries this
forward.

**5. Alert path verification (induced failure)**

Ran the real `scripts/db-backup.mjs` with
`DEFAULT_OBJECT_STORAGE_BUCKET_ID=does-not-exist-cadstone-drill-bucket`
and `BACKUP_ALERT_WEBHOOK_URL=http://127.0.0.1:7777/alert` (a temporary
HTTP listener that captured the POST body to disk). Result:

- Script exit code: **1** (as expected).
- pino events emitted, in order: `backup_start`, `backup_failed`
  (`The specified bucket does not exist.`),
  `find_last_successful_failed`, `alert_webhook_sent` (HTTP 200).
- Webhook captured at `2026-05-06T18:45:40.436Z`. Payload (1 124
  bytes) had every expected field — `text`, `subject`, `message`, and
  a `context` object with `date`, `bucketId`, `backupPrefix`, `error`,
  and `lastSuccessful: null`. The `text` field is Slack-renderable
  (`*[CAD Stone] Daily DB backup FAILED for 2026-05-06*\n…`).
- The **email** transport was not exercised in this drill because no
  Resend / EMAIL_FROM / BACKUP_ALERT_EMAIL secrets are set in this
  workspace; both transports use the same fan-out path
  (`sendBackupAlert` in `scripts/lib/backup-alerts.mjs`), and the
  webhook half went through end-to-end including the
  `alert_webhook_sent` log line. To verify email in production, set
  the three env vars on the deployment and re-run with a deliberately
  bad bucket as above.

**6. Production schedule — explicitly deferred (backlog)**

CAD Stone Networks is an internal tool with two admin users and no
client data yet, so the operator has chosen **not** to arm an
automated daily schedule at this time. Current backup strategy:

- **Manual, on-demand:** run
  `pnpm --filter @workspace/api-server run backup:db`
  before any risky migration or roughly weekly while the dataset is
  still small. Each run is idempotent per UTC day (same
  `backups/db/YYYY-MM-DD.sql.gz` object name) and goes through the
  same `scripts/db-backup.mjs` path that this drill verified
  end-to-end.
- **Automated daily cron — backlog item.** When the first real client
  is onboarded (or sooner if the operator prefers), pick one of:
  1. **Replit Scheduled Deployment** running
     `pnpm --filter @workspace/api-server run backup:db`. No extra
     secrets needed. Replit emails the workspace owner if the
     scheduled run fails. (Recommended for an internal tool.)
  2. **The pre-wired GitHub Actions cron** at
     `.github/workflows/db-backup.yml`. Requires three things to be
     set together:
     - `BACKUP_TRIGGER_SECRET` (32+ char random string) as **both** a
       Replit deployment secret on the api-server AND a GitHub
       Actions repo secret.
     - `BACKUP_WEBHOOK_URL` on GitHub pointing at the production
       `/api/internal/run-db-backup` URL.
     - The handler at
       `artifacts/api-server/src/routes/internal-backup.ts` returns
       503 until `BACKUP_TRIGGER_SECRET` is set on the deployment, so
       that env var is the single "arm" switch.

Either scheduler is fine; the script is idempotent so running both is
harmless. **Alerting:** for an internal tool, GitHub Actions' default
email-on-workflow-failure (or a Replit Scheduled Deployment's
failure email) is sufficient — `BACKUP_ALERT_WEBHOOK_URL` /
`BACKUP_ALERT_EMAIL` are only worth wiring up once there is a paging
rotation worth waking. The fan-out path itself was verified in §5.

**7. Retention check (live pruning verified against the real bucket)**

Listed the production object-storage bucket under `backups/db/` before
the drill: **0 objects** (cron not yet armed for real — see §6). To
exercise pruning end-to-end against the real bucket without polluting
`backups/db/`, seeded 20 placeholder `.sql.gz` objects under a separate
prefix `backups/db-drill-retention-test/` covering dates `2026-01-30`
through `2026-05-05` at 5-day stride, then ran the real backup script
with `BACKUP_PREFIX=backups/db-drill-retention-test`:

```
event=backup_uploaded   objectName=…/2026-05-06.sql.gz  sizeBytes=38267  elapsedMs=4161
event=prune_summary     total=21  keeping=18  deleting=3
event=prune_deleted     dateStr=2026-02-14
event=prune_deleted     dateStr=2026-02-09
event=prune_deleted     dateStr=2026-02-04
event=backup_done
```

Re-listing the test prefix afterwards: 18 objects retained
(`2026-05-06`, `2026-05-05`, `2026-04-30`, …, `2026-01-30`), 3 oldest
deleted as classified by `classifyForRetention` (daily 14 + weekly 12
+ monthly 12, deduplicated). The 4 most recent fell inside the 14-day
daily window; the rest were retained as the newest-per-ISO-week and
newest-per-month representatives. **PRUNE: PASS.** Cleaned up all 18
test-prefix objects after verification so the bucket is back to a
clean `backups/db/2026-05-06.sql.gz` only.

A second confirmation will come naturally once the production schedule
has been armed for ≥ 15 days (the daily cron will then start hitting
the same prune branch against `backups/db/` itself); until then the
seeded-bucket evidence above is the live verification.

**8. Cleanup**

`DROP DATABASE cadstone_restore_drill_20260506184516;` returned
`DROP DATABASE`. Local Postgres 17 instance stopped, `/tmp/drill/*`
artifacts (dump file, captured webhook payload, count diffs) retained
on the workspace for inspection — they will rotate out with the next
container reset and contain no production data beyond two admin
emails.

**Result.** Backup → restore → parity → alert path all pass. The two
remaining items (email transport verification and live retention
pruning) require production secrets / time-since-launch and are tracked
on the launch-readiness checklist rather than as backup-pipeline bugs.
