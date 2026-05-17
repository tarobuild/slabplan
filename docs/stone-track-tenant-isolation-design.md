# Stone Track Tenant Isolation Design

Stone Track is not production-ready as a SaaS until tenant isolation is enforced at the database, auth, storage, and API layers. This document is the implementation checklist for the next phases after the initial branding conversion.

## Current Status

Implemented in this pass:

- `organizations`
- `organization_memberships`
- `users.default_organization_id`
- Existing single-tenant users are backfilled into one deterministic legacy organization only when a database already has users.
- Nullable `organization_id` columns and indexes now exist in schema/migration form for tenant-owned business tables.
- Access, refresh, upload, and signed file-view tokens can carry `organizationId`.
- Auth middleware resolves active organization membership/status into `req.auth` when membership exists, and rejects suspended, archived, deleted, or explicitly unauthorized organizations.
- New personal access tokens are stamped with the active organization when the request has one, and list/revoke operations are active-organization filtered when available.
- `/clients`, `/jobs`, `/leads`, `/financials`, and primary `/schedule` item creation have first-pass active-organization filtering and server-side `organization_id` stamping when auth carries tenant context.
- `/search` applies active-organization filters across job, lead, file, schedule, client, and contact-backed result sources.
- `/activity` applies active-organization filtering at the shared activity query layer.
- `/reports` and top-level dashboard summary/calendar endpoints apply active-organization filters to cross-table aggregates.
- Job system folders, lead attachment folders, schedule attachment folders, uploaded file rows, and job/lead-backed activity rows inherit organization context.
- Shared admin authorization helpers verify active-organization ownership for job, lead, and client access instead of allowing database-wide admin access.

Not implemented yet:

- Some route writes do not yet stamp `organization_id` server-side. `/clients`, `/jobs`, `/leads`, `/financials`, and primary `/schedule` item creation are the initial completed route slices.
- Fail-closed organization membership enforcement for every protected route. Legacy local users without memberships are still allowed while onboarding and test data are migrated.
- Route-level tenant filters.
- Storage paths partitioned by organization id.
- Subscription entitlements.

## Tenant Model

`users` are global login identities. A user may belong to one or more organizations through `organization_memberships`.

`organization_memberships.role` is the tenant-scoped role. `users.role` remains in place for compatibility during migration and must not be trusted as the final SaaS role source once tenant switching is implemented.

Every authenticated request should eventually resolve:

- `auth.userId`
- `auth.organizationId`
- `auth.organizationRole`
- `auth.organizationMembershipId`

Those fields now exist as transitional optional auth fields. Until every protected route requires `auth.organizationId` and filters by it, the API is still single-tenant in practice.

## Business Table Scoping

The safest migration is two-step:

1. Add nullable `organization_id` columns and backfill every existing row. This schema/migration layer exists now.
2. Update code to write and filter by `organization_id`.
3. Add `NOT NULL` and tenant-aware uniqueness constraints after tests prove all writes populate the column.

Tables that should get direct `organization_id`:

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

Tables that can remain global:

- `organizations`
- `organization_memberships`
- `rate_limit_buckets`, if bucket keys include tenant context where needed.

## API Isolation Rules

Every route must derive tenant context from auth middleware, not from request body fields.

Required route changes:

- List endpoints must include `organization_id = auth.organizationId`.
- Detail endpoints must verify row ownership by `organization_id` before returning 404/403.
- Create endpoints must set `organization_id` server-side.
- Update/delete endpoints must include organization filters in the lookup and mutation.
- Joins must verify both sides belong to the same organization.
- Admin routes must mean tenant admin, not platform admin.

High-risk routes:

- `/files`, `/uploads`, `/api/files/:id/view-signed`
- `/search`
- `/reports`
- `/activity`
- `/agent`
- `/jobs/:id/financials`
- `/daily-logs/feed`
- `/schedule`
- MCP/PAT routes

## Storage Isolation

Object storage paths should become:

```text
stone-track/organizations/{organizationId}/uploads/{relativePath}
```

The database should store a stable logical file URL, but object-name conversion must include tenant context. The API must never infer tenant access from path shape alone; it must check the file row and its `organization_id`.

## Subscription Isolation

Billing should be attached to `organizations`, not users.

Recommended fields already included on `organizations`:

- `plan_key`
- `subscription_status`
- `stripe_customer_id`
- `stripe_subscription_id`
- `trial_ends_at`
- `billing_email`

Entitlements should be enforced through a small server-side service before adding any UI gates. The API should fail closed when an organization is suspended or over quota.

## Readiness Gates

Stone Track is not production-ready until these are true:

- Auth tokens include active organization context.
- All tenant-owned rows have non-null `organization_id`.
- All list/detail/write routes are tenant-filtered.
- File object paths include organization id.
- PATs are scoped to an organization.
- AI usage is metered per organization.
- Billing webhook updates are idempotent and tenant-scoped.
- Cross-tenant regression tests exist for jobs, clients, leads, files, search, reports, activity, daily logs, schedule, financials, and agent tools.
