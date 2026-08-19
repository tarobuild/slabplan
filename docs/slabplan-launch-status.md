# SlabPlan Launch Status

Last updated: 2026-08-19

## Target Architecture

- Source of truth: `tarobuild/slabplan` on GitHub.
- Application hosting: one Replit Autoscale deployment serving the React app,
  Express API, Socket.IO connections, and background sweepers. Launch capacity
  is 2 vCPU / 4 GiB RAM with a maximum of one machine.
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
- The GitHub Playwright release workflow passes all 73 end-to-end tests for
  the release commit.

## Deployment Checklist

- [x] Merge the validated migration commit into GitHub `main`.
- [x] Pull that exact `main` commit into the TaroBuild Replit app and complete
  the configured Replit production build.
- [x] Configure production-only Replit secrets from the SlabPlan services.
- [x] Select Autoscale deployment and publish.
- [x] Verify `/api/livez` and `/api/healthz` against the published app.
- [ ] Verify login, Socket.IO, billing, email, AI,
  and organization-isolated file upload/download workflows.
- [x] Confirm the Supabase organization is on a paid plan with a 500 GB storage
  limit available (for Pro, the spend cap must be disabled).
- [x] Set the project-wide file-size limit to 500 GB and confirm the private
  `slabplan-files` bucket inherits that limit.
- [ ] Confirm Supabase backups and perform the documented restore drill.
- [x] Record the live Replit URL and deployed GitHub commit below.
- [ ] Connect `slabplan.com` and `www.slabplan.com` to Replit and verify HTTPS.

## Production Record

- Replit URL: `https://slabplan.replit.app`
- Replit deployment ID: `2571f0d9-776f-489e-94b0-ef838f1e5a0f`
- GitHub commit: `4962e49a52bdc1ca1b85a0a12a52f56944d82227`
- Replit source verification: clean at the GitHub commit above, 0 commits ahead
  and 0 behind `origin/main`; configured production build passed.
- Production smoke date: 2026-08-19.
- `/api/livez`: HTTP 200, process healthy.
- `/api/healthz`: HTTP 200 with database and storage healthy and release SHA
  `4962e49a52bd`.
- Supabase project: `slabplan-production`, organization plan Pro, spend cap
  disabled.
- Storage bucket: `slabplan-files`, private, inheriting the 500 GB global
  object-size limit.
- Railway: Hobby subscription canceled, service retirement in progress, final
  amount due $0.00. The canceled term ends 2026-09-16.
- Vercel: no paid hosting plan. Retained only as the `slabplan.com` registrar
  and DNS host; domain auto-renewal remains enabled through 2027-08-01.

Never place production secrets in this repository or copy credentials from the
CAD Stone project.
