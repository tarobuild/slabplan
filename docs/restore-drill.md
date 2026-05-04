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
