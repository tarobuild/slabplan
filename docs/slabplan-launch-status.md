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
  verification, frontend build, API build, all 301 frontend tests, all 756 API
  tests, and all 73 Playwright end-to-end tests pass.
- Registration and invite activation require versioned Terms and Privacy
  acceptance, and the public legal pages are available without authentication.
- Account recovery uses expiring, single-use reset links delivered through the
  configured Google Workspace SMTP account.
- Production web/API dependencies have no known high or critical advisories;
  remaining high advisories are isolated to the unused mobile build toolchain.
- The local Playwright release gate and GitHub Actions run `32300000680` pass
  all 73 end-to-end tests.

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
- [x] Confirm the scheduled Supabase backup and perform the documented restore
  drill.
- [x] Record the new Replit deployment ID and deployed GitHub commit below.
- [x] Connect `slabplan.com` and `www.slabplan.com` to Replit and verify HTTPS.

## Production Record

- Production URL: `https://slabplan.com`
- Replit URL: `https://slabplan.replit.app`
- Replit deployment ID: `2571f0d9-776f-489e-94b0-ef838f1e5a0f`
- Replit build ID: `0f78cd9a-b3b5-4712-b955-81e599ffb96c`
- GitHub commit: `8d6211bb703dda9ebf968cecbaeebad39439a6be`
- Deployed source verification: the configured production build passed at the
  GitHub release commit above. The Replit workspace was subsequently synced
  cleanly to current `origin/main`, 0 commits ahead and 0 behind, without
  republishing the documentation-only updates.
- Production smoke date: 2026-08-19.
- `/api/livez`: HTTP 200, process healthy.
- `/api/healthz`: HTTP 200 with database and storage healthy and release SHA
  `8d6211bb703d`.
- Startup evidence: the API binds its health listener before optional service
  initialization; the production bundle returned `/api/healthz` in 1.293
  seconds locally, and the Replit deployment started without restarts.
- Database migration `0040_legal_acceptance.sql` applied successfully during
  production startup.
- Google Workspace SMTP: the Replit production deployment has all nine SMTP
  bindings configured with a dedicated `SlabPlan Replit SMTP` app password.
  End-to-end forgot-password delivery still requires a production account test.
- Custom domains: `slabplan.com` and `www.slabplan.com` resolve to the Replit
  deployment at `34.111.179.208` with valid HTTPS. The apex redirects to `www`;
  both `/api/livez` endpoints return HTTP 200.
- Backup evidence: GitHub Actions daily backup run `32272998126` and manual
  restore drill run `32273134749` passed on 2026-08-19.
- Release gate evidence: GitHub Actions Playwright run `32300000680` passed all
  73 end-to-end tests on 2026-08-19.
- Supabase project: `slabplan-production`, organization plan Pro, spend cap
  disabled.
- Storage bucket: `slabplan-files`, private, inheriting the 500 GB global
  object-size limit.
- Railway: the `slabplan-api` project was permanently deleted after the Hobby
  subscription was canceled. Railway is no longer a SlabPlan runtime or deploy
  target.
- Vercel: the `slabplan` project, deployments, environment variables, and Git
  integration were permanently deleted on 2026-08-19. The former
  `slabplan.vercel.app` hostname returns `404: DEPLOYMENT_NOT_FOUND`. Vercel is
  retained only as the `slabplan.com` registrar and authoritative DNS host; its
  DNS records route the live application to Replit. Domain auto-renewal remains
  enabled through 2027-08-01.

Never place production secrets in this repository or copy credentials from the
CAD Stone project.
