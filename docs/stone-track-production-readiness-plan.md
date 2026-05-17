# Stone Track Production Readiness Plan

This is the master execution plan for making Stone Track a production-ready multi-tenant SaaS application. It assumes this local workspace is now the Stone Track project and that the original CAD Stone production project remains off limits.

Stone Track is not ready for paid production use until the hard gates in this document are complete. The current app can run locally as a rebranded single-tenant product, but it does not yet provide the isolation, onboarding, billing, storage partitioning, and operational controls required for SaaS.

## Non-Negotiable Rules

- Work only in `/Users/cruz/Documents/stone track`.
- Do not touch `/Users/cruz/Documents/New project 3`.
- Do not add a Git remote or push without explicit owner approval.
- Do not copy production secrets, customer data, `.env` values, or object storage data.
- Do not add Resend or new Sentry instrumentation.
- Do not add dependencies unless the reason is documented and the existing stack cannot solve the problem cleanly.
- Do not ship mocked or placeholder data in production paths.
- Do not change `artifacts/mockup-sandbox`.
- Do not change files related to `mcp.test.ts` until the MCP rebrand/migration is deliberately scoped.

## Current State

Completed foundation work:

- Stone Track brand constants exist on frontend and backend.
- Visible auth, nav, settings, assistant, email, metadata, cookie, and storage prefix surfaces have been rebranded.
- `AGENTS.md` and `replit.md` now describe the Stone Track local conversion workspace.
- `organizations`, `organization_memberships`, and `users.default_organization_id` exist in schema and migration form.
- A deterministic legacy organization backfill exists for databases that already contain users.
- Tenant-owned business tables now have nullable `organization_id` columns and indexes in schema and migration form.
- Auth tokens and `Express.Request["auth"]` now support active organization context, and auth middleware resolves membership/status when a user has an organization membership.
- `/clients`, `/jobs`, `/leads`, `/financials`, and the primary `/schedule` create paths now have first-pass active-organization filters and create-time `organization_id` stamping when tenant context exists.
- `/search` now applies active-organization filters across job, lead, file, schedule, client, and contact-backed result sources.
- `/activity` now applies active-organization filtering at the shared activity query layer.
- `/reports` and the top-level `/dashboard/stats`, `/dashboard/agenda`, and `/dashboard/schedule` endpoints now apply active-organization filters to summary and calendar aggregates.
- Job system folders, lead attachment folders, schedule attachment folders, uploaded file rows, and job/lead-backed activity rows now inherit organization context.
- Shared admin authorization helpers now check active-organization ownership for job, lead, and client access instead of treating admin as database-wide access.
- Tenant isolation design exists in `docs/stone-track-tenant-isolation-design.md`.

Known gaps:

- Some route writes do not yet stamp `organization_id` server-side. `/clients`, `/jobs`, `/leads`, `/financials`, and primary `/schedule` item creation are the first completed route slices.
- Auth currently allows legacy users with no membership to continue without `organizationId`; production readiness still requires fail-closed membership enforcement after onboarding and seeded test data are updated.
- Several API routes still rely on global records and role checks. `/clients`, `/jobs`, `/leads`, `/financials`, `/reports`, top-level dashboard summary routes, `/search`, and `/activity` are the initial tenant-filtered slices.
- File storage paths are not yet organization-partitioned.
- New PATs are stamped with the active organization when one is present, and PAT list/revoke operations filter by active organization when available. PAT route access still needs fail-closed membership enforcement before production.
- AI usage is user-scoped, not organization-metered.
- Billing and entitlements are not implemented.
- Supabase Auth is not integrated.
- Production deployment, secrets, domains, and backup/restore are not configured for Stone Track.

## Architecture Decisions

### Hosting

Use Replit for the first production deployment only after tenant isolation and billing gates pass. Prefer a Reserved VM for the first launch. Autoscale should come later after migrations, file streaming, AI calls, and long-lived request behavior are proven under load.

### Database

Use a fresh Stone Track Supabase Postgres project. Do not reuse or connect to the original production database.

### Storage

Use a fresh Supabase-compatible private bucket. Object names must include organization context before production:

```text
stone-track/organizations/{organizationId}/uploads/{relativePath}
```

### Auth

Keep current JWT auth while tenant isolation is being built. Evaluate Supabase Auth after the application has explicit organization and membership semantics. Supabase Auth can handle identity, but Stone Track still needs first-class tenant authorization tables.

### Billing

Use Stripe Billing first for web-first B2B subscriptions. Keep Stone Track billing state provider-neutral where practical, with Stripe IDs stored as provider fields.

### AI

Keep the existing AI provider adapter initially, but add organization-level metering, budgets, and entitlements before production.

## Production Readiness Gates

Stone Track is production-ready only when all gates below pass.

### Gate 1: Tenant Data Model

Goal: every tenant-owned row can be attributed to exactly one organization.

Required work:

- Add `organization_id` to tenant-owned business tables.
- Backfill existing rows to the deterministic legacy organization.
- Add indexes for `organization_id` and common tenant-filtered query shapes.
- Review unique constraints and make them organization-aware where needed.
- Add cross-organization consistency checks for parent/child relationships, either through composite foreign keys, guarded write helpers, or database triggers where Drizzle cannot express the constraint cleanly.
- Keep `organization_id` nullable during first backfill, then enforce `NOT NULL` after all writes are updated.

Tables requiring direct `organization_id`:

- `clients`
- `client_contacts`
- `jobs`
- `job_assignees`
- `folders`
- `files`
- `leads`
- `lead_contacts`
- `lead_salespeople`
- `lead_tags`
- `lead_sources`
- `lead_attachments`
- `schedule_phases`
- `schedule_tag_settings`
- `schedule_items`
- `schedule_item_assignees`
- `schedule_item_notes`
- `schedule_item_attachments`
- `schedule_item_todos`
- `schedule_settings`
- `schedule_baselines`
- `schedule_workday_exception_categories`
- `schedule_workday_exceptions`
- `schedule_item_predecessors`
- `daily_logs`
- `daily_log_settings`
- `daily_log_custom_fields`
- `daily_log_attachments`
- `daily_log_tags`
- `daily_log_likes`
- `daily_log_comments`
- `daily_log_todos`
- `file_annotations`
- `personal_access_tokens`
- `idempotency_keys`
- `activity_log`
- `financial_trackers`
- `sov_areas`
- `sov_line_items`
- `change_orders`
- `tracker_invoices`
- `invoice_line_payments`
- `agent_conversations`
- `agent_messages`
- `agent_usage_monthly`

Gate checks:

- Migration journal check passes.
- Schema typecheck passes.
- A database audit query proves no tenant-owned rows have null `organization_id`.
- Unique indexes that should be tenant-local are tenant-local.
- A database audit query proves child rows do not reference parent rows from a different organization.

### Gate 2: Tenant-Aware Auth

Goal: every authenticated request has a server-resolved active organization.

Required work:

- Extend `Express.Request["auth"]` with `organizationId`, `organizationRole`, and `membershipId`. Implemented as transitional optional fields.
- Extend access, refresh, upload, and file-view tokens with active organization context. Implemented using `users.default_organization_id`.
- Update login, refresh, invite acceptance, and session bootstrap to select a default organization.
- Add active organization switching for users with multiple memberships.
- Treat `organization_memberships.role` as the source of tenant role.
- Keep `users.role` only as a temporary compatibility field until migration is complete.
- Add middleware that rejects active organizations that are suspended, archived, deleted, or missing membership. Suspended, archived, deleted, and explicitly requested missing memberships now fail closed; missing membership without an active organization remains temporarily allowed for legacy local records.

Gate checks:

- Request auth fails closed when membership is missing.
- Refresh preserves active organization.
- Tenant role changes take effect without requiring unsafe client-side trust.
- Inactive or suspended organizations cannot access protected routes.

### Gate 3: API Tenant Isolation

Goal: no API route can read or mutate records outside the active organization.

Required work:

- Add shared tenant query helpers for Drizzle conditions.
- Update authorization helpers to mean "all rows in this organization", not "all rows in the database".
- Add tenant filters to list/detail/update/delete routes.
- Stamp `organization_id` server-side on all creates.
- Validate referenced IDs on create/update belong to the same organization.
- Prevent cross-organization joins by checking both the target row and every referenced parent row.
- Ensure 404/403 behavior does not reveal cross-tenant record existence.

High-risk route groups:

- `/clients`
- `/jobs`
- `/leads`
- `/schedule`
- `/daily-logs`
- `/resources`
- `/reports`
- `/search`
- `/files`
- `/uploads`
- `/api/files/:id/view-signed`
- `/users`
- `/account/tokens`
- `/agent`
- `/mcp`

Gate checks:

- Cross-tenant tests exist for each route group.
- Search and reports cannot aggregate across organizations.
- Admin routes only manage users and records in the active organization.
- Create/update endpoints reject foreign IDs from another organization.
- Foreign-key-like relationships are tested for cross-organization mismatch, especially file attachments, job/client links, schedule items, daily logs, and financial records.

### Gate 4: File And Storage Isolation

Goal: files cannot leak through URLs, signed tokens, object names, folder permissions, thumbnails, or cleanup scripts.

Required work:

- Change object-name mapping to include organization id.
- Store or derive file object names in a way that is stable and tenant-scoped.
- Add organization checks to file streaming, signed file views, upload completion, annotations, and folder permissions.
- Scope storage drift, cleanup, backup, wipe, and restore scripts to organization-aware prefixes.
- Decide whether the API remains the only storage access path or whether Supabase Storage policies are added.

Gate checks:

- Tenant B cannot view Tenant A file by ID.
- Tenant B cannot view Tenant A file by `/uploads/...` URL.
- Tenant B cannot reuse Tenant A signed file token.
- Cleanup scripts cannot delete objects outside the intended organization prefix.

### Gate 5: Frontend Tenant UX

Goal: users understand and operate inside the correct workspace.

Required work:

- Show organization name in primary app chrome.
- Add workspace settings for name, billing email, timezone, and defaults.
- Add tenant switcher if multi-membership is enabled at launch.
- Scope query cache, persisted filters, and browser storage by organization.
- Update invite, register, accept-invite, and settings flows for organization context.
- Add empty states for new tenants with no jobs, clients, leads, or files.

Gate checks:

- Switching organizations clears stale query data.
- Local storage keys cannot carry tenant-specific filters across tenants.
- All user-facing organization labels are generic Stone Track labels.

### Gate 6: Onboarding And Team Management

Goal: a new customer can create an organization and invite a team without manual database work.

Required work:

- Add organization creation during registration or checkout return.
- Add tenant-scoped invite creation, resend, revoke, and accept flows.
- Add organization owner transfer rules.
- Add member deactivation/removal rules that preserve audit history.
- Add tenant-scoped password reset behavior.
- Add first-run setup for workspace name, billing email, timezone, and initial defaults.
- Make onboarding fail loudly if organization creation, membership creation, or subscription initialization fails.

Gate checks:

- First organization owner can register and enter the app.
- Invited users join the correct organization only.
- A revoked invite cannot be accepted.
- Removing a member blocks future access without deleting historical authored records.
- No onboarding path creates unscoped users or orphan organizations.

### Gate 7: Billing And Entitlements

Goal: organization access and feature limits reflect subscription state.

Required work:

- Add provider-neutral billing tables:
  - `plans`
  - `organization_subscriptions`
  - `organization_entitlements`
  - `organization_usage_monthly`
  - `billing_events`
- Connect Stripe Billing with signed webhook verification and idempotent event handling.
- Add checkout and customer portal links for organization owners.
- Enforce subscription status server-side.
- Enforce seat, storage, AI, and feature entitlements server-side.
- Fail closed on missing billing state for production organizations unless explicitly in a trial.

Gate checks:

- Webhook replay is safe.
- Cancelled, past-due, trialing, active, and suspended states are explicit.
- Non-owner members cannot manage billing.
- No card data is stored in Stone Track.

### Gate 8: AI Metering And Safety

Goal: AI usage is tenant-metered, auditable, and entitlement-limited.

Required work:

- Add organization-level AI usage records.
- Tie agent conversations and messages to organization id.
- Add per-organization model budgets and request limits.
- Log tool calls with organization context.
- Ensure agent tools only call tenant-filtered APIs.
- Add kill switch for AI features per organization.

Gate checks:

- AI usage cannot be charged to the wrong organization.
- Agent search/tools cannot cross tenant boundaries.
- Over-budget organizations receive clear API errors.

### Gate 9: Supabase And Deployment

Goal: Stone Track has fresh infrastructure and repeatable deployment.

Required work:

- Create new Stone Track Supabase project.
- Create new database, storage bucket, and service role secrets.
- Configure backups and restore drill.
- Configure Replit deployment with fresh secrets.
- Configure app origin, CORS, email sender, and custom domain.
- Run migrations against staging first.
- Run smoke tests against staging.

Gate checks:

- No secrets are copied from the old project.
- Health and liveness endpoints pass.
- DB migrations run once and are idempotent.
- File upload/view works against Stone Track storage.
- Backup restore drill is documented and tested.

### Gate 10: Security And Compliance

Goal: obvious SaaS security gaps are closed before launch.

Required work:

- Cross-tenant regression tests.
- Rate limits include organization context where needed.
- Audit log includes organization id.
- Invite/reset tokens are tenant-scoped and hashed.
- PATs are tenant-scoped and revocable.
- Security headers and CORS are reviewed for the new domain.
- Production logs do not include secrets, tokens, file contents, or PII-heavy payloads.

Gate checks:

- `rg` scan finds no hard-coded production secrets or legacy production URLs in production paths.
- Cross-tenant test suite passes.
- API returns safe 404/403 behavior for foreign records.

### Gate 11: Launch Operations

Goal: launch can be operated and rolled back safely.

Required work:

- New runbook for Stone Track production.
- Incident checklist.
- Backup and restore checklist.
- Deployment checklist.
- Environment variable checklist.
- First-tenant onboarding checklist.
- Support/admin process for suspended tenants, failed payments, lost access, and storage issues.

Gate checks:

- A fresh operator can deploy staging from the runbook.
- A fresh operator can restore a backup in a drill.
- Launch checklist has no unresolved owner decisions.

## Implementation Order

### Step 1: Finish Tenant Schema

Add `organization_id` to all tenant-owned tables and write the backfill. Do not change route behavior until this is done.

Validation:

- `pnpm typecheck`
- `pnpm --filter @workspace/db check-migrations-journal`
- migration dry run against local test DB when available

### Step 2: Auth Context

Resolve active organization during auth and include it in `req.auth`. Add membership lookup and fail-closed organization status checks.

Validation:

- auth unit tests
- login/refresh tests
- inactive membership tests
- suspended organization tests

### Step 3: Route Isolation In Slices

Implement route isolation in small, testable groups:

1. Users, invitations, memberships, PATs.
2. Clients and jobs.
3. Leads.
4. Schedule and daily logs.
5. Financials, reports, search, activity.

Each slice needs create/read/update/delete cross-tenant tests before moving on.

Files and folders are intentionally handled with storage partitioning in the next step because row-level file ownership and object-name ownership must change together.

### Step 4: Storage Partitioning And File Routes

Change object names to include organization id and update file/folder authorization in the same slice. Add compatibility or migration for old local objects only if needed.

### Step 5: Agent And MCP Isolation

Tenant-scope agent conversations, tool calls, citations, usage, and MCP/PAT access. If MCP cannot be safely tenant-scoped without touching deferred MCP test surfaces, keep MCP disabled for launch.

### Step 6: Frontend Tenant UX

Add workspace context, settings, cache isolation, and tenant-aware empty states.

### Step 7: Onboarding And Team Management

Add customer registration, organization creation, tenant-scoped invitations, membership administration, and first-run setup.

### Step 8: Billing Foundation

Add billing schema and entitlement service before Stripe integration. Then connect Stripe.

### Step 9: Production Infrastructure

Create fresh Supabase and Replit production environments, then run staging smoke tests.

### Step 10: Final Launch Hardening

Run full validation, security scans, and launch checklist.

## Standard Validation Loop

For each implementation slice:

1. Run focused tests for changed code.
2. Run `pnpm typecheck`.
3. Run `pnpm check-api-codegen` if API spec or generated contracts changed.
4. Run `DATABASE_URL=postgres://stone_track:stone_track@127.0.0.1:5432/stone_track_test pnpm knip`.
5. Run `pnpm --filter @workspace/cadstone run check-eager-bundle` for frontend-affecting changes.
6. Run `git diff --check`.
7. Review remaining legacy brand scans and classify each match as historical, generated, compatibility, or a bug.

## Three-Pass Review Rule

Before calling any readiness slice complete:

1. Completeness review: every changed subsystem has schema, server, client, tests, and docs considered.
2. Isolation review: every query, mutation, storage path, token, cache key, and background script is checked for tenant scope.
3. Operations review: migrations, env vars, deployment, rollback, logs, and runbooks are checked.

## Owner Decisions Needed

- Final production domain.
- Stripe account ownership and product/pricing model.
- Whether launch supports one organization per user or multi-membership immediately.
- Whether Supabase Auth is adopted before or after first launch.
- Whether MCP ships in first launch or remains disabled until rebranded and tenant-scoped.
- Initial plan limits: seats, storage, AI usage, active jobs, file retention.
- Email provider for production transactional mail.

## Definition Of Ready

Stone Track is ready to sell only when:

- A new customer can subscribe, create an organization, invite users, upload files, manage work, and pay.
- Another customer cannot access any data, file, report, search result, AI citation, token, or cache entry from the first customer.
- A cancelled or suspended customer is blocked according to entitlement rules.
- The system can be deployed, backed up, restored, monitored, and operated without depending on the old CAD Stone project.
