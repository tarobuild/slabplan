# SlabPlan Readiness Execution Plan

Last updated: 2026-05-17

This plan intentionally excludes the two owner/vendor items that are deferred
until later:

- Add the real AI provider key.
- Configure transactional email and sender domain.

## Execution Tracks

### 1. Billing UI

Goal: let an organization owner/admin pick a SlabPlan plan and open Stripe's
customer portal from the app.

Work:

- Add admin-only `/settings/billing`.
- Display current organization billing state.
- Display Starter, Team, and Pro plans.
- Start Stripe Checkout through `POST /api/billing/checkout-sessions`.
- Open Stripe customer portal through
  `POST /api/billing/customer-portal-sessions`.
- Return Stripe success/cancel flows to `/settings/billing`.

### 2. Browser Monitoring Verification

Goal: verify real browser-origin Sentry delivery from the production web app.

Work:

- Add admin-only `/settings/diagnostics`.
- Add controlled browser-side Sentry test event button.
- Deploy frontend.
- Log in as an admin.
- Send the diagnostic event.
- Confirm `SLABPLAN-WEB` receives the issue in Sentry.

### 3. Supabase Backup / Restore

Goal: know exactly what recovery coverage exists before paid customers.

Work:

- Document Supabase backup retention and restore constraints.
- Confirm database backups are visible in `slabplan-production`.
- Confirm whether the production project is on Free, Pro, Team, or Enterprise.
- Do not restore over production.
- Run a restore-to-new-project drill before paid launch.
- Validate that storage objects are handled separately from database restore.

### 4. Smoke Test

Goal: prove the deployed app can complete core workflows.

Work:

- Register or log in as an admin.
- Create a workspace.
- Create a client.
- Create a job.
- Create a document folder.
- Upload and list a private file.
- Create a schedule item.
- Create a daily log.
- Create and convert a lead.
- Verify billing status loads.
- Verify mobile layout at 390px.

### 5. Tenant / File Isolation

Goal: prevent cross-workspace data leakage.

Work:

- Run focused tenant isolation tests.
- Review active organization context and route predicates.
- Review private storage object naming.
- Review file list/download/signed-view authorization.
- Document residual risk and paid-launch follow-up.

## Completion Standard

This work is complete when:

- The billing and diagnostics pages are merged and deployed.
- API production/staging health checks pass.
- Sentry API events are verified.
- Sentry web browser-origin event is verified.
- Smoke test results are recorded.
- Tenant/file isolation review is recorded.
- Standard checks pass.
