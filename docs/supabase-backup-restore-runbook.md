# SlabPlan Supabase Backup and Restore Runbook

Last updated: 2026-05-17

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

Earlier failure emails came from workflow runs before those secrets were set.
The latest manual Daily DB backup workflow run completed successfully on
2026-05-17.

The latest manual DB restore drill workflow run completed successfully on
2026-05-17. It restored `backups/db/2026-05-17.sql.gz` into a temporary
PostgreSQL 17 database and completed the core table sanity checks.

Production dashboard status checked on 2026-05-17:

- Supabase org: `slabplan`
- Plan: Pro
- Project: `slabplan-production`
- Dashboard status: scheduled physical backup available,
  `2026-05-17 07:52:07 +0000`

That means native Supabase daily backup retention is available for early
production readiness. SlabPlan still keeps the GitHub/Supabase Storage logical
backup workflow as the off-site recovery path and restore-drill source.

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
6. Apply SlabPlan environment variables to a temporary Railway staging
   environment pointed at the restored project.
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

## Open Owner Action

Upgrade the production Supabase project if native dashboard backups are required
before paid launch. The 2026-05-17 dashboard check shows the project is still on
Free with no visible native backups.
