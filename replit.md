# SlabPlan

SlabPlan is a local white-label SaaS conversion of the former single-company construction-management platform. The target product is a multi-tenant operations platform for job tracking, lead management, scheduling, daily logs, file management, AI assistance, and financial workflows.

The dedicated source repository is `tarobuild/slabplan`. Do not connect this
workspace to the original CAD Stone production repo.

## Run & Operate

- **Run Dev Server:** `pnpm dev`
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **Codegen (API):** `pnpm --filter @workspace/api-spec run codegen`
- **Codegen drift check:** `pnpm check-api-codegen`
- **Unused-code sweep:** `pnpm knip`
- **Frontend bundle health:** `pnpm --filter @workspace/cadstone run check-eager-bundle`

## Current Stack

- **Monorepo Tool:** pnpm workspaces
- **Runtime:** Node.js 24
- **Language:** TypeScript 5.9
- **Backend:** Express 5
- **Frontend:** React + Vite
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **ORM:** Drizzle ORM
- **Database:** PostgreSQL
- **Storage:** Supabase-compatible private object storage
- **Validation:** Zod
- **AI Model:** Anthropic Claude through the existing integration package

## Production Topology

- **Application hosting:** Replit Autoscale (2 vCPU / 4 GiB RAM, maximum 1 machine at launch)
- **Database:** Supabase PostgreSQL
- **Private files:** Supabase Storage
- **Large uploads:** signed browser-to-Supabase TUS uploads
- **Source of truth:** GitHub `tarobuild/slabplan` `main`

Do not use Replit Database or Replit App Storage for production SlabPlan data.

## Where Things Live

- **Backend API:** `artifacts/api-server`
- **Frontend App:** `artifacts/cadstone`
- **DB Schema:** `lib/db/src/schema`
- **DB Migrations:** `lib/db/migrations`
- **API Contract:** `lib/api-spec/openapi.yaml`
- **Generated API Client:** `lib/api-client-react/src/generated/`
- **Generated API Zod Schemas:** `lib/api-zod/src/generated/`
- **Transactional Email:** `artifacts/api-server/src/lib/email.ts`
- **Storage Helpers:** `artifacts/api-server/src/lib/storage.ts`
- **MCP Server:** `lib/mcp-server`
- **Frontend Role Access Helpers:** `artifacts/cadstone/src/lib/role-access.ts`
- **Frontend Global Error Boundary:** `artifacts/cadstone/src/components/ErrorBoundary.tsx`
- **Sentry Init (server):** `artifacts/api-server/src/lib/sentry.ts`
- **Sentry Init (web):** `artifacts/cadstone/src/lib/sentry.ts`
- **E2E Playwright Tests:** `artifacts/cadstone/tests/e2e/`
- **Migration Plan:** `docs/slabplan-saas-migration-plan.md`

## Environment Variables

Production configuration is stored in Replit published-app secrets. Existing
inherited env names remain until the related subsystem is migrated.

Expected categories:

- **DB:** `SUPABASE_DATABASE_URL` or `DATABASE_URL`
- **Auth:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_UPLOAD_SECRET`; add `SUPABASE_ANON_KEY` only when Supabase Auth login is enabled
- **Email:** `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and
  `SMTP_FROM_NAME`. Production startup fails when this configuration is missing.
- **CORS / origins:** `CORS_ALLOWED_ORIGINS` or `APP_ORIGIN`
- **AI:** `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, optional `AGENT_MODEL`
- **Upload storage:** `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_SERVICE_ROLE_KEY`
- **Monitoring:** existing Sentry env vars are grandfathered; do not add new Sentry instrumentation without owner approval
- **Rate limits:** existing login, AI parse, upload, and API rate-limit tunables

Do not copy env values from the original production project. SlabPlan uses
dedicated Supabase, storage, auth, billing, email, and monitoring secrets.

## Architecture Decisions

- **API Contract First:** `openapi.yaml` is the source of truth for generated clients and Zod schemas.
- **Migrations Are Source of Truth:** hand-written SQL migrations in `lib/db/migrations` are applied by the custom runner. Avoid `drizzle-kit push --force` unless explicitly approved.
- **No Silent Fallbacks:** missing required services and env vars should throw instead of pretending work succeeded.
- **Tenant Isolation Is A Security Boundary:** do not ship tenant code unless schema, auth context, route predicates, storage paths, and tests agree.
- **Provider Adapters:** billing and AI providers should sit behind internal app abstractions so SlabPlan is not locked to one hosting or connector platform.

## SaaS Target

The intended production architecture is:

- Multi-tenant Postgres schema with tenant-scoped business records.
- Supabase-compatible private storage with tenant-prefixed object paths.
- Tenant-aware auth context and tenant-scoped roles.
- Tenant-scoped invitations and team management.
- Tenant-isolated search, reports, file access, signed links, AI tools, and MCP access.
- Subscription and entitlement tables, with Stripe Billing as the likely first provider for web-first B2B SaaS.
- Tenant-level AI metering, budgets, and audit logs.

Detailed phases are documented in `docs/slabplan-saas-migration-plan.md`.

## Product Modules

- **Job Management:** create, edit, assign, track status, and complete jobs.
- **Lead Management:** track sales leads and convert them to jobs.
- **Scheduling:** project schedules, phases, dependencies, and workday exceptions.
- **Daily Logging:** field logs with attachments, comments, tags, and visibility controls.
- **File Management:** private project and resource files.
- **AI Assistant:** in-app assistant with auditable tool usage.
- **User & Team Management:** invitations, roles, profiles, and personal access tokens.
- **Financials:** estimate and invoice spreadsheet parsing for jobs.

## User Preferences

- Use iterative development.
- Prefer detailed explanations.
- Honor the owner's standing approval for routine migration, deployment,
  configuration, testing, billing-selection, and release work. Interrupt only
  when a system or tool enforces a separate action-time confirmation.
- Do not modify `artifacts/mockup-sandbox`.
- Do not modify files related to `mcp.test.ts`.

## Gotchas

- **API Contract Discrepancies:** if a handler and `openapi.yaml` disagree, fix the spec first, then regenerate.
- **Money Fields:** use integer cents or safe integer OpenAPI definitions where possible.
- **Date Fields:** use `YYYY-MM-DD` strings with explicit regex patterns in OpenAPI.
- **Old `.xls` Files:** legacy binary BIFF uploads are not supported.
- **Generated Files:** do not hand-edit generated API client or generated Zod files.
- **File Storage:** storage paths must become tenant-prefixed before real multi-tenant production use.
