# SlabPlan Launch Status

Last updated: 2026-05-17

## Completed

- GitHub repo is connected: `tarobuild/slabplan`.
- Vercel production frontend is live: `https://slabplan.vercel.app`.
- Railway production API is live: `https://slabplan-api-production.up.railway.app`.
- Railway staging API is live: `https://slabplan-api-staging.up.railway.app`.
- Supabase staging project exists: `slabplan-staging`.
- Supabase production project exists: `slabplan-production`.
- Both Supabase projects have the private `slabplan-files` bucket.
- Production database migrations are applied.
- Staging database migrations are applied.
- Vercel production builds point at Railway production API.
- Vercel preview builds point at Railway staging API.
- Production and staging API health checks return `db:true` and `storage:true`.
- Sentry projects exist in the Tarobuild org: `slabplan-web` and
  `slabplan-api`.
- Sentry env vars are configured for Vercel web and Railway API.
- Sentry API events are verified from Railway production and staging.
- Sentry web project ingestion is verified, and the live Vercel bundle contains
  the `slabplan-web` DSN.
- Browser-origin Sentry delivery is verified from the production web app using
  the Diagnostics settings page.
- Stripe test-mode SlabPlan products/prices exist in the Tarobuild Stripe
  account.
- Stripe checkout, customer portal, and signed webhook API endpoints exist.
- Stripe test keys, price env vars, webhook endpoints, and webhook secrets are
  configured in Railway production/staging.
- Billing UI is live under `/settings/billing` and renders Starter, Team, and
  Pro plans.
- Production browser smoke test passes for workspace creation, sign-in,
  dashboard load, billing, diagnostics, and 390px mobile login layout.
- Production sign-out smoke test passes through the account menu and returns to
  `/login`.
- Staging API smoke test passes for workspace, client, job, private file,
  schedule item, daily log, lead conversion, invite acceptance, and non-admin
  billing checkout protection.
- Vercel CSP allows only the SlabPlan API hosts and Sentry ingestion in
  addition to same-origin connections.
- Generated React API hooks use the configured API origin instead of relative
  Vercel `/api` paths.
- Production auth/upload cookies use secure cross-site settings while the
  temporary Vercel and Railway hosts are on different sites.
- GitHub Daily DB backup workflow repository secrets are now present. The
  failure emails seen earlier were from runs before those secrets were set; the
  latest manual backup workflow run completed successfully.
- GitHub DB restore drill workflow exists and restores the latest backup into a
  temporary PostgreSQL 17 database for repeatable recovery checks.
- The 2026-05-17 manual DB restore drill run passed after refreshing the daily
  backup object.
- No mocked production-path data was found after removing an unused scaffold
  component and keeping development seed data off the main DB package export.
- Sentry is optional at boot, so missing Sentry config cannot take the API down.
- Anthropic API key is installed in Railway production and staging. The first
  generated key was rotated after setup, and the active key is deployed.
- Anthropic config remains isolated from API boot, so a provider or billing
  issue cannot take the rest of the API down.

## Not Launch-Ready Yet

These require owner/vendor setup before SlabPlan is ready for paying users:

- Buy/connect custom domains.
- Add Anthropic credits / resolve the Anthropic billing balance. The staging
  AI smoke reaches Anthropic with a valid key but Anthropic returns a
  low-credit billing error.
- Configure transactional email and sender domain.
- Upgrade or otherwise cover Supabase native backup retention. The
  `slabplan-production` dashboard currently shows Free plan and
  `Last backup: No backups`.
- Run email invite/password-reset smoke tests after email is configured.
- Re-run AI assistant smoke test after Anthropic credits are available.

## Current Health Probes

```bash
curl -sS https://slabplan-api-production.up.railway.app/api/healthz
curl -sS https://slabplan-api-staging.up.railway.app/api/healthz
curl -I https://slabplan.vercel.app/login
```

Expected API shape:

```json
{"status":"ok","db":true,"storage":true,"errors":[]}
```

## Environment Ownership

Production:

- Supabase project: `slabplan-production`
- Railway environment: `production`
- Vercel environment: `Production`

Staging:

- Supabase project: `slabplan-staging`
- Railway environment: `staging`
- Vercel environment: `Preview`

Never copy production Supabase secrets into staging or preview environments.
