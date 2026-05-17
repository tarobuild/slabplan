# AGENTS.md - Rules for AI Coding Agents

This is the **Stone Track** local conversion workspace. It started as a duplicate of the CAD Stone Networks platform, but it is being converted into a new white-label SaaS product.

The original production CAD Stone repo lives outside this folder. Do not read from it, edit it, push from it, copy secrets from it, or reconnect this duplicate to it unless the owner explicitly asks.

## Golden Rules

1. **Do not push anything** unless the owner explicitly asks.
2. **Do not add a Git remote** unless the owner provides the new repo URL and explicitly approves.
3. **Do not connect this folder back to the CAD Stone GitHub repo.**
4. **Read `replit.md` first.** It contains the current project overview, stack, run commands, env vars, and conventions.
5. **No mocked or placeholder data in production paths.** If something cannot be wired cleanly, fail loudly.
6. **No production secrets or customer data.** Never copy `.env` values, Supabase secrets, object-storage data, or real customer records from another project.
7. **No new dependencies without justification.** Prefer existing libraries already in the monorepo.
8. **No Resend or new Sentry additions.** Existing plumbing is grandfathered, but do not extend it casually.
9. **Do not change `artifacts/mockup-sandbox`.**
10. **Do not change files related to `mcp.test.ts`.**

## Local Workflow

Work in this duplicate only:

```bash
pwd
# /Users/cruz/Documents/stone track
```

Before major changes, inspect the current branch and dirty state:

```bash
git status --short --branch
```

Do not run `git pull`, `git push`, or remote-management commands unless the owner explicitly asks. This workspace is intentionally local-only until a new Stone Track repository is approved.

## Required Checks

Run the relevant checks before considering a change complete:

```bash
pnpm install
pnpm typecheck
pnpm check-api-codegen
pnpm knip
pnpm --filter @workspace/cadstone run check-eager-bundle
```

If API spec files change, regenerate generated clients and schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Project Conventions

- **Monorepo:** pnpm workspaces.
- **Packages:** `artifacts/api-server`, `artifacts/cadstone`, `artifacts/api-spec`, and supporting packages under `lib/`.
- **Runtime:** Node.js 24.
- **Language:** TypeScript 5.9.
- **Backend:** Express 5.
- **Frontend:** React + Vite.
- **Database:** PostgreSQL through Drizzle ORM.
- **Storage:** Private object storage via Supabase-compatible APIs.
- **Validation:** Zod.
- **API contract:** OpenAPI spec in `lib/api-spec/openapi.yaml`; generated files must not be hand-edited.
- **Migrations:** Hand-written SQL migrations in `lib/db/migrations`; do not use `drizzle-kit push --force` without explicit owner approval.

## Stone Track SaaS Direction

The target product is a multi-tenant SaaS platform. Treat tenant isolation as a security boundary:

- Add tenant/company scoping deliberately, with migrations and tests.
- Every authenticated request should eventually carry an active tenant.
- Admin access must mean tenant-admin access, not all database rows.
- Files and signed links must be tenant-isolated.
- Billing and AI usage must be tenant-metered before broad production use.

See `docs/stone-track-saas-migration-plan.md` for the detailed migration plan.

## Rejection Criteria

Changes should be rejected or reworked if they:

- Push or reconnect this duplicate to the original CAD Stone repo.
- Add hard-coded secrets, production URLs, or customer data.
- Add mocked data to production paths.
- Disable typecheck, knip, or codegen checks to make CI pass.
- Add billing, auth, or tenant isolation only partially without tests.
- Mix unrelated formatting churn with feature work.
- Change schema without a migration plan.
