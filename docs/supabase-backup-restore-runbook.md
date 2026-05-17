# SlabPlan Supabase Backup and Restore Runbook

Last updated: 2026-05-17

## Current Position

SlabPlan has separate Supabase projects:

- `slabplan-production`
- `slabplan-staging`

Both projects use the private `slabplan-files` storage bucket. The application
database and private storage are intentionally separate from other Tarobuild
apps.

## Backup Policy

Supabase automatically creates daily database backups for Free, Pro, Team, and
Enterprise projects. Backup access and retention depend on the paid plan:

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

Confirm the production Supabase project's paid plan and visible backup retention
in the Supabase Dashboard. If the project is still on a free tier, upgrade or
add external dumps before treating the app as paid-launch ready.
