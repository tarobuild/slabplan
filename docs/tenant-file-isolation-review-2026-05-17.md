# Tenant and File Isolation Review

Date: 2026-05-17

## Scope

Focused review for SlabPlan paid-launch readiness:

- Tenant context resolution.
- Tenant-scoped CRUD for core records.
- Private file object paths, listing, download, and signed-view paths.
- AI usage metering ownership.
- Billing ownership.

## Result

No new high-risk cross-tenant read/write issue was found in this pass.

The system is in good shape for private staging and owner-led smoke testing.
Before paid launch, run this review again after billing UI, production account
creation, email, and AI keys are all active.

Focused test result: passed, 19 tests / 0 failures.

## Evidence

Tenant context:

- `resolveOrganizationContextForUser` selects an active membership and rejects
  requested organizations the user does not belong to.
- `attachOrganizationContext` enriches authenticated requests with
  `organizationId`, `organizationRole`, and membership metadata.
- `organizationScopeCondition` centralizes organization predicates for route
  queries.

Database scoping:

- Existing focused tests cover tenant isolation for agents, clients, jobs,
  leads, daily logs, dashboard, financials, reports, schedule, and users.
- Billing state is stored on `organizations`, and billing management is limited
  to organization owners/admins.
- AI usage is metered by organization through `agentUsageMonthly`.

Files and storage:

- New upload paths include an organization prefix:
  `organizations/{organizationId}/{jobId}/{mediaType}/{storedFileName}`.
- The Supabase bucket is private.
- File list/download/signed-view routes resolve the file row first and enforce
  app-level access before streaming an object.
- File serving uses safe response headers and a restrictive content-security
  policy.

## Residual Risk

- Legacy/null-organization file paths are still supported for historical rows.
  New SlabPlan uploads should use organization-prefixed paths, but legacy
  support should remain watched during migration cleanup.
- Supabase Storage backups require separate object handling. A database restore
  alone does not prove file recovery.
- The final paid-launch review should include live accounts in two separate
  workspaces and attempt cross-tenant reads for clients, jobs, files, signed
  links, search, reports, daily logs, schedule, users, billing, and AI usage.

## Required Verification Commands

Run the focused isolation suite:

```bash
pnpm --filter @workspace/api-server exec tsx --test \
  test/agent-tenant-isolation.test.ts \
  test/clients-tenant-isolation.test.ts \
  test/jobs-tenant-isolation.test.ts \
  test/leads-tenant-isolation.test.ts \
  test/daily-logs-tenant-isolation.test.ts \
  test/dashboard-tenant-isolation.test.ts \
  test/financials-tenant-isolation.test.ts \
  test/reports-tenant-isolation.test.ts \
  test/schedule-tenant-isolation.test.ts \
  test/users-tenant-isolation.test.ts \
  test/storage-supabase.test.ts
```

Run full gates before launch:

```bash
pnpm typecheck
pnpm check-api-codegen
pnpm knip
pnpm --filter @workspace/cadstone run check-eager-bundle
```
