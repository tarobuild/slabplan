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
- Stripe test-mode SlabPlan products/prices exist in the Tarobuild Stripe
  account.
- Sentry is optional at boot, so missing Sentry config cannot take the API down.
- Anthropic config is deferred until AI usage, so missing Anthropic key cannot take the API down.

## Not Launch-Ready Yet

These require owner/vendor setup before SlabPlan is ready for paying users:

- Buy/connect custom domains.
- Add Anthropic API key to Railway production and staging.
- Configure transactional email and sender domain.
- Wire Stripe checkout/customer portal/webhooks and internal billing state.
- Verify Sentry events from both web and API after the next frontend deployment.
- Verify Supabase production backups and restore process.
- Run a tenant-isolation and file-access security pass.
- Run the full manual smoke test with real seed users.

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
