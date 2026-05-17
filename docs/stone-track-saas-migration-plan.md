# Stone Track SaaS Migration Plan

This repo is the local Stone Track conversion of the former single-company construction-management platform. The goal is a production-grade, multi-tenant SaaS product with tenant-isolated data, subscriptions, private file storage, and a generic white-label brand.

This plan is intentionally phased. Tenant isolation is a security boundary; it should not be half-implemented across schema, auth, API, storage, and tests.

## Operating Constraints

- Work only in this duplicate workspace.
- Do not connect this repo to the original CAD Stone GitHub remote.
- Do not copy production secrets, customer data, or local `.env` values.
- Do not push without explicit approval.
- Do not change `artifacts/mockup-sandbox`.
- Do not change files related to `mcp.test.ts`.
- No mocked or placeholder data in production paths.
- No new dependencies unless the design requires them and the reason is documented.
- Do not add Resend or new Sentry instrumentation. Existing plumbing may be rebranded or eventually replaced, but it should not be expanded casually.

## Target Architecture

### Hosting

Use Replit for the first production deployment if speed and low operational overhead are the priority. Prefer a Reserved VM deployment first; autoscale can come later after boot-time migrations, long-lived requests, file streaming, and AI workloads are proven under load.

Keep the app portable. Core business logic should not depend on Replit-only connectors. Replit-specific integrations should sit behind adapters.

### Supabase

Use a new Stone Track Supabase project for production. Supabase remains a strong fit for:

- Postgres as the source of truth.
- Private object storage for uploaded files.
- Backups and operational visibility.
- Optional Supabase Auth once tenant isolation is structurally complete.

Supabase Auth is identity infrastructure, not the whole tenant authorization model. Stone Track still needs first-class tables for tenants, memberships, roles, invitations, subscriptions, entitlements, and usage.

### Billing

Use an internal subscription/entitlement model first, then connect a provider. For a web-first B2B SaaS, Stripe Billing is the preferred first provider. RevenueCat remains an option if mobile subscriptions or cross-store entitlement management become important.

Core billing tables should not be provider-specific:

- `plans`
- `tenant_subscriptions`
- `tenant_entitlements`
- `tenant_usage_monthly`
- `billing_customers`
- `billing_events`

Provider-specific IDs belong on the billing tables, not scattered through business logic.

### AI

AI calls should go through an internal provider adapter and tenant usage meter. Whether the upstream provider is Anthropic, OpenAI, Replit AI, or another gateway, Stone Track must track:

- tenant-level AI budget
- user-level limits
- per-request audit events
- prompt/model/token metadata
- failure reason and retry safety

## Phase 0: White-Label Foundation

Goal: remove CAD Stone production references and make Stone Track the explicit product identity without changing tenant behavior yet.

Tasks:

- Rebrand visible UI: document title, login, invite acceptance, top nav, assistant copy, settings copy.
- Rebrand transactional email copy.
- Replace app-internal event/storage keys from `cadstone:*` to `stone-track:*` where safe.
- Rename cookie names from CAD-specific names to Stone Track names with a compatibility plan if needed.
- Change object storage prefix from `cadstone/uploads` to a generic Stone Track prefix for new local/dev data.
- Update `AGENTS.md` and `replit.md` so future agents do not pull from or push to the original CAD Stone repo.
- Keep folder/package renames deferred unless build tooling and workspace references are updated in the same change.

Exit criteria:

- `pnpm typecheck` passes.
- `pnpm check-api-codegen` passes if API spec changes.
- No visible CAD Stone product copy remains in production UI/email surfaces.
- Remaining CAD/Cadstone matches are categorized as tests, historical docs, migration notes, generated files, or deferred compatibility aliases.

## Phase 1: Tenant Data Model

Goal: introduce tenant primitives without changing behavior for the local single-tenant dataset.

Add:

- `tenants`
  - `id`
  - `name`
  - `slug`
  - `status`
  - `created_at`
  - `updated_at`
  - `deleted_at`
- `tenant_memberships`
  - `tenant_id`
  - `user_id`
  - `role`
  - `status`
  - `created_at`
  - `updated_at`
- `tenant_invitations`
  - tenant-scoped invite and reset flows
- `tenant_settings`
  - company name, timezone, defaults, branding hooks

Backfill:

- Create one local default tenant named `Stone Track Local`.
- Attach all existing users to it.
- Add nullable `tenant_id` to business tables, backfill, then make required where appropriate.

Tables that need direct `tenant_id` or guaranteed tenant inheritance:

- `users` or membership bridge, depending on final identity model
- `clients`, `client_contacts`
- `jobs`, `job_assignees`
- `folders`, `files`, `file_annotations`
- `leads`, `lead_contacts`, `lead_salespeople`, `lead_tags`, `lead_sources`, `lead_attachments`
- schedule tables
- daily-log tables, settings, and custom fields
- financial tracker, SOV, change order, invoice, payment tables
- `activity_log`
- `personal_access_tokens`
- `idempotency_keys`
- agent conversations, messages, and usage
- rate-limit buckets if limits are tenant-scoped

Exit criteria:

- Migration is reversible in local/staging.
- Every business row can be attributed to exactly one tenant.
- Unique indexes are reviewed and tenant-scoped where needed.
- No route behavior changes yet except backfilled tenant metadata.

## Phase 2: Tenant-Aware Auth Context

Goal: every authenticated request has an active tenant and tenant role.

Tasks:

- Extend auth context with `tenantId`, `tenantSlug`, and tenant role.
- Decide whether current JWT auth remains or Supabase Auth migration begins.
- Scope personal access tokens to a tenant and role/permission set.
- Make invite acceptance tenant-specific.
- Add active-tenant selection for future multi-membership users.

Rules:

- A global admin role must not imply access to every tenant's records.
- Admin means tenant admin unless a separate internal platform-admin model is explicitly designed.
- Tenant claims must be server-issued. Do not trust client-editable metadata for authorization.

Exit criteria:

- Auth middleware rejects requests without an active tenant.
- PATs cannot cross tenants.
- Refresh/session flows preserve tenant context.
- Tests cover tenant mismatch and revoked membership.

## Phase 3: API Query Isolation

Goal: every route reads and writes only within `req.auth.tenantId`.

High-risk route groups:

- `/clients`
- `/jobs`
- `/leads`
- `/schedule`
- `/daily-logs`
- `/resources`
- `/reports`
- `/search`
- `/files`, `/uploads`, signed file views
- `/users`
- `/agent`
- `/mcp`

Implementation rules:

- Add tenant predicates at the lowest shared helper level where possible.
- Admin helper functions must return "all tenant rows", not "all database rows".
- Create operations must stamp `tenant_id` server-side.
- Mutations must verify both the target record and all referenced IDs belong to the active tenant.
- Reports and search need explicit tenant filters before aggregation.

Exit criteria:

- Cross-tenant tests fail before the fix and pass after.
- No broad aggregation route can read another tenant.
- No create/update endpoint accepts a foreign tenant reference.

## Phase 4: Storage Isolation

Goal: private files cannot leak across tenants even if IDs, URLs, or signed links are guessed.

Tasks:

- Use tenant-prefixed storage paths: `tenants/{tenantId}/uploads/...`.
- Add tenant ownership checks to file URL resolution and signed-file routes.
- Scope folder/resource permissions by tenant.
- Update storage drift, backup, cleanup, and probe scripts.
- Decide whether Supabase Storage RLS is used directly or enforced via API-only access.

Exit criteria:

- A signed file URL for tenant A cannot be used by a tenant B session.
- Object names include tenant context.
- Cleanup/drift scripts cannot accidentally scan or delete another tenant's objects.

## Phase 5: Frontend Tenant UX

Goal: make tenant context visible and ergonomic.

Tasks:

- Show workspace/company identity in nav/settings.
- Add workspace settings backed by `tenant_settings`.
- Add tenant switcher only if multi-membership is supported at launch.
- Update onboarding and invite flows.
- Scope browser storage keys by tenant when persisted filters are tenant-specific.
- Add generic Stone Track assets and metadata.

Exit criteria:

- A user always knows which workspace they are using.
- Switching tenants does not reuse stale filters, cached data, or query results from another tenant.
- TanStack Query cache invalidates on tenant switch.

## Phase 6: Subscription And Entitlements

Goal: gate tenant access by subscription status and plan limits.

Tasks:

- Add plan and subscription tables.
- Add entitlement checks for feature gates, seat count, storage quota, AI usage, and retention.
- Integrate Stripe Billing first unless mobile subscription requirements make RevenueCat a better provider.
- Add webhook ingestion with idempotency and signed-event verification.
- Add billing settings UI for tenant admins.

Exit criteria:

- Tenant access reflects subscription status.
- Failed payment and cancellation states are handled explicitly.
- Webhook replay is safe.
- No card data is stored in Stone Track.

## Phase 7: Production Readiness

Tasks:

- Fresh Supabase project.
- Fresh Replit deployment.
- New secrets, no copied CAD Stone values.
- Staging smoke suite.
- Cross-tenant isolation suite.
- Backup and restore drill for Stone Track.
- Launch checklist updated for generic SaaS.

Exit criteria:

- `pnpm install`
- `pnpm typecheck`
- `pnpm check-api-codegen`
- `pnpm knip`
- frontend bundle health check
- API contract checks
- cross-tenant security tests
- storage upload/view/delete smoke
- billing webhook smoke when billing ships

## Current Recommended Next Work

1. Finish Phase 0 rebrand/config cleanup.
2. Add tenant schema migration and backfill in a dedicated Phase 1 change.
3. Add auth-context tenant support.
4. Convert route groups one by one with cross-tenant tests.
5. Only after isolation is proven, add billing and provider integration.
