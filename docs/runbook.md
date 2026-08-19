# SlabPlan Operations Runbook

## Live Service

SlabPlan is a single-origin Replit Autoscale deployment backed by Supabase
PostgreSQL and private Supabase Storage. Launch capacity is 2 vCPU / 4 GiB RAM
with a maximum of one machine.

Health checks:

```bash
curl -i https://slabplan.replit.app/api/livez
curl -i https://slabplan.replit.app/api/healthz
```

`/api/livez` confirms the process is running. `/api/healthz` confirms the database, storage bucket, and required runtime dependencies are reachable.

## Release

1. Validate the intended SlabPlan commit locally.
2. Push the SlabPlan branch and merge it into `tarobuild/slabplan` `main`.
3. In the `@tarobuild/slabplan` Replit app, pull GitHub `main` and confirm the commit SHA.
4. Republish the Autoscale deployment.
5. Wait for a successful deployment and run the health and authenticated smoke tests.

Never pull from or push to CAD Stone during a SlabPlan release.

## Required Runtime State

- Replit deployment type is Autoscale, 2 vCPU / 4 GiB, maximum 1 machine.
- Production secrets are attached to the published app, not only the development workspace.
- `SUPABASE_DATABASE_URL` points to the production Supabase project.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` point to the same project.
- The Supabase project and private bucket allow files up to 500 GB.
- The browser upload path uses signed direct TUS uploads; large bytes do not pass through Replit.

## Failure Triage

For failed startup, inspect Replit Publishing logs for the first missing configuration or migration error. Do not bypass startup guards.

For failed uploads, check in this order:

1. Supabase plan and global file-size limit.
2. Private bucket file-size limit.
3. Replit API logs for signing or finalization errors.
4. Browser network logs for TUS `POST`, `HEAD`, or `PATCH` failures.
5. The object path and file row organization IDs.

For database incidents, stop writes if necessary, verify the latest backup, and follow `docs/supabase-backup-restore-runbook.md`.

## Rollback

Revert or restore the last known-good SlabPlan commit on GitHub `main`, pull
that exact commit into Replit, and republish the Autoscale deployment. Database
migrations are forward-only; review migration compatibility before rolling
application code backward.
