# SlabPlan Supabase Backup and Restore Runbook

Last updated: 2026-09-27

## Current Position

SlabPlan has separate Supabase projects:

- `slabplan-production`
- `slabplan-staging`

Both projects use the private `slabplan-files` storage bucket. The application
database and private storage are intentionally separate from other Tarobuild
apps.

GitHub Actions also has a Daily DB backup workflow for SlabPlan. Required
repository secrets are present as of 2026-05-17:

- `SUPABASE_DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_STORAGE_BUCKET`
- `SUPABASE_SERVICE_ROLE_KEY`

The September 27 daily backup workflow completed successfully. Its logical
backup was restored into a disposable PostgreSQL 17 database, with core-table
sanity checks passing. Production was not overwritten. This verifies database
recovery from the tested snapshot, not private-file recovery or a guaranteed
recovery time.

Historical production dashboard observation on 2026-05-17 (not a current plan
or entitlement verification):

- Supabase org: `slabplan`
- Plan: Pro
- Project: `slabplan-production`
- Dashboard status: scheduled physical backup available,
  `2026-05-17 07:52:07 +0000`

The GitHub job stores its logical dump in Supabase Storage. Because that is
the same provider as the primary database, it must not be described as an
independent off-site disaster-recovery copy. Current native backup availability
and retention must be checked in the production project before relying on them.

The size verifier retains missing-object detection and both upward and downward
anomaly bounds. A reviewed successful restore can establish an explicit baseline
using `BACKUP_REVIEWED_BASELINE_DATE` and `BACKUP_REVIEWED_BASELINE_BYTES`.
The reviewed anchor is used until three subsequent daily samples are available;
the rolling median is then used again. Never change the baseline just to silence
an alert without investigating and restoring the affected snapshot.

## Backup Policy

Supabase paid plans provide restorable daily database backups with retention
depending on the plan:

- Pro: last 7 days of daily backups.
- Team: last 14 days of daily backups.
- Enterprise: up to 30 days of daily backups.

Point-in-Time Recovery (PITR) is a paid add-on for Pro, Team, and Enterprise
projects. PITR provides recovery to a chosen timestamp with finer granularity
than daily backups, but it replaces daily backups while enabled.

Important storage caveat: Supabase database backups do not include Storage API
objects. Database backups include storage metadata, but deleted or missing
bucket objects are not restored by a database restore.

Sources:

- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/clone-project
- https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore

## Production Readiness Decision

For early private testing, daily backups are acceptable if the production
project is on a plan where backups are visible/restorable in the Dashboard.

Before paid customer launch, SlabPlan should have one of these:

- Supabase Pro daily backups confirmed in the production Dashboard plus a
  documented restore-to-new-project drill.
- PITR enabled if near-zero data-loss recovery is required.
- An external/off-site logical backup routine using `pg_dump` or `supabase db
  dump`, especially if the project remains on a free tier.

## Restore Drill

Do not restore over production for a drill. Use restore-to-new-project or a
fresh non-production Supabase project.

The repository includes a manual GitHub Action for the logical-backup drill:
`.github/workflows/db-restore-drill.yml`. It downloads the latest
`backups/db/YYYY-MM-DD.sql.gz` object, restores it into a temporary PostgreSQL
17 service database, checks core SlabPlan tables, and drops the throwaway
database when the job finishes.

1. In `slabplan-production`, open `Database > Backups`.
2. Confirm at least one usable backup exists.
3. Restore the selected backup into a new project when using Supabase's
   restore-to-new-project flow.
4. Recreate project-level settings that are not included in the database copy:
   auth settings, API keys, Realtime settings, database extension settings,
   network restrictions, and edge functions if any are added later.
5. Recreate/migrate storage bucket objects. Database backup metadata alone is
   not enough to restore private file contents.
6. Apply SlabPlan environment variables to an isolated non-production deployment
   pointed at the restored project. Do not redirect the live deployment.
7. Run the smoke test checklist against the restored environment.
8. Tear down the restored project after the drill unless it is being promoted
   to a long-lived environment.

## Storage Object Drill

Because storage objects are not covered by database backups, a complete disaster
recovery drill must include at least one uploaded file:

1. Upload a test file in staging.
2. Confirm the database row has an organization-prefixed object path.
3. Copy the corresponding Supabase Storage object into the restored bucket.
4. Confirm the app can list, download, and signed-view the file from the
   restored environment.

## Open Recovery Gates

- Verify current native backup retention and project entitlement directly with
  the provider. Do not infer today's tier from historical notes.
- Configure an access-restricted backup destination independent of the primary
  Supabase project, with versioned retention and bounded operating costs.
  The encrypted Google Cloud Storage backup job and restore drill in
  `docs/private-file-backup-runbook.md` implement this; the gate stays open
  until the destination is provisioned and its evidence checklist is complete.
- Back up private object contents as well as the database, and restore samples
  from that destination with byte-for-byte verification. A temporary copy within
  the primary bucket does not satisfy this gate.
- Define recovery-point and recovery-time commitments from tested capabilities.
  Do not advertise near-zero data loss or a recovery SLA without evidence.
