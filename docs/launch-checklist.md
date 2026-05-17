# SlabPlan Launch Checklist

SlabPlan is deployed, but it is not approved for public paid launch until every
section below is complete.

## 1. Automated Gates

Run from the repository root:

```bash
pnpm typecheck
pnpm check-api-codegen
pnpm knip
pnpm --filter @workspace/cadstone run check-eager-bundle
```

If API spec files changed, regenerate first:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## 2. Deployment Probes

Production:

```bash
curl -i https://slabplan-api-production.up.railway.app/api/livez
curl -i https://slabplan-api-production.up.railway.app/api/healthz
curl -I https://slabplan.vercel.app/login
```

Staging:

```bash
curl -i https://slabplan-api-staging.up.railway.app/api/healthz
```

Required API readiness:

```json
{"status":"ok","db":true,"storage":true,"errors":[]}
```

## 3. Owner Setup

- [ ] Connect custom domains. `slabplan.com` is not registered yet, so DNS
      cannot be connected.
- [ ] Add Anthropic API key to Railway production and staging.
- [ ] Configure transactional email provider and verified sender domain.
- [x] Create Stripe test-mode SlabPlan products and prices.
- [x] Add Stripe checkout, customer portal, signed webhook, and billing state API foundation.
- [x] Configure Stripe test keys, price env vars, webhook endpoint, and webhook secret in Railway.
- [x] Add billing UI entry points after account/workspace smoke testing.
- [x] Create Sentry SlabPlan web/API projects and configure deployment env vars.
- [x] Verify Sentry API event capture from Railway production and staging.
- [x] Verify Sentry web project ingestion and deployed web DSN.
- [x] Verify a real browser-origin Sentry event from the production web app.
- [ ] Confirm Supabase production backups and retention. Production is
      currently on Supabase Free and shows `Last backup: No backups`.
- [x] Perform restore drill against a non-production database.

## 4. App Smoke Test

- [x] Create a workspace.
- [x] Sign in.
- [x] Create a client.
- [x] Create a job.
- [x] Upload and list a private file.
- [x] Create a schedule item.
- [x] Create a daily log.
- [x] Create and convert a lead.
- [x] Verify admin-only billing management is blocked from non-admin users.
- [x] Verify mobile layout at 390px width.
- [x] Sign out.
- [ ] Test AI assistant after the Anthropic key is installed.
- [ ] Test invite/password-reset email after email is installed.

## 5. Security Gate

- [x] Tenant scoping reviewed for clients, jobs, leads, schedule, daily logs,
      files, reports, search, users, and AI tools.
- [x] File object paths and signed links are tenant-isolated.
- [x] Tenant admin permissions cannot read or mutate another tenant.
- [x] AI usage is tenant-metered before broad customer usage.
- [x] No production secrets are committed.
- [x] No mocked data exists in production paths.

## 6. Go / No-Go

Do not launch publicly unless:

- All automated gates pass on the launch commit.
- Both API environments are healthy.
- Owner setup is complete.
- The manual smoke test passes.
- Security gate has no unresolved high-risk findings.
