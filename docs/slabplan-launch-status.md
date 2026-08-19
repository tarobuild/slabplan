# SlabPlan Launch Status

Last updated: 2026-08-18

## Target Architecture

- Source of truth: `tarobuild/slabplan` on GitHub.
- Application hosting: one Replit Reserved VM serving the React app, Express
  API, Socket.IO connections, and background sweepers.
- PostgreSQL: Supabase.
- Private object storage: Supabase Storage.
- Large uploads: browser-to-Supabase signed TUS uploads. File contents do not
  pass through Replit.
- Replit Database and Replit App Storage are not production data stores.

## Verified Locally

- The latest approved CAD Stone fixes were copied into this SlabPlan workspace
  without modifying or reconnecting the CAD Stone repository.
- Estimate discounts persist, sales lists support due-date sorting, and direct
  resumable uploads are included.
- Direct-upload intents, database rows, activity records, and object paths are
  organization-scoped.
- The application and OpenAPI policy allow individual files up to 500 GB.
- Production builds include both the frontend and API in one deployable output.
- Typecheck, API codegen verification, dependency analysis, eager-bundle
  verification, frontend build, API build, all 299 frontend tests, and all
  749 API tests pass.
- Production web/API dependencies have no known high or critical advisories;
  remaining high advisories are isolated to the unused mobile build toolchain.

## Deployment Checklist

- [x] Merge the validated migration commit into GitHub `main`.
- [x] Pull that exact `main` commit into the TaroBuild Replit app and complete
  the configured Replit production build.
- [ ] Configure production-only Replit secrets from the SlabPlan services.
- [ ] Select Reserved VM deployment and publish.
- [ ] Verify `/api/livez`, `/api/healthz`, login, Socket.IO, billing, email, AI,
  and organization-isolated file upload/download workflows.
- [ ] Confirm the Supabase organization is on a paid plan.
- [ ] Set the project-wide and `slabplan-files` bucket file-size limits to
  500 GB.
- [ ] Confirm Supabase backups and perform the documented restore drill.
- [ ] Record the live Replit URL and deployed GitHub commit below.

## Production Record

- Replit URL: pending publish
- GitHub commit: `969153f5a7df115add4211a4d62bc2a4d6581698`
- Supabase project: `slabplan-production` (access and settings must be
  re-verified before publish)
- Storage bucket: `slabplan-files` (private; limit must be re-verified)

Never place production secrets in this repository or copy credentials from the
CAD Stone project.
