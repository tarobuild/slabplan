# CAD Stone Networks

Centralizes and streamlines construction management operations, offering job tracking, lead management, scheduling, daily logging, and file management for Cadstone Works.

## Run & Operate

- **Run Dev Server:** `pnpm dev`
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **Codegen (API):** `pnpm --filter @workspace/api-spec run codegen` (regenerates API client and Zod schemas)
- **DB Push:** `drizzle-kit push --force` (for schema changes)
- **Env Vars:**
    - `RESEND_API_KEY`, `EMAIL_FROM`, `APP_PUBLIC_URL` (transactional email)
    - `AGENT_MODEL` (AI Assistant)
    - `SUPABASE_DATABASE_URL` or `DATABASE_URL`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID` (DB backups)
    - `BACKUP_TRIGGER_SECRET`, `BACKUP_WEBHOOK_URL` (GitHub Actions DB backup)
    - `BACKUP_ALERT_EMAIL`, `BACKUP_ALERT_WEBHOOK_URL` (backup alerts)
    - Rate limit tunables: `LOGIN_IP_MAX`, `LOGIN_IP_WINDOW_MS`, `LOGIN_EMAIL_MAX`, `LOGIN_EMAIL_WINDOW_MS`, `AI_PARSE_PER_USER_MAX`, `AI_PARSE_PER_USER_WINDOW_MS`, `UPLOAD_PER_USER_MAX`, `UPLOAD_PER_USER_WINDOW_MS`

## Stack

- **Monorepo Tool:** pnpm workspaces
- **Runtime:** Node.js 24
- **Language:** TypeScript 5.9
- **Backend:** Express 5
- **Frontend:** React, Vite
- **Styling:** Tailwind CSS v4, shadcn/ui
- **ORM:** Drizzle ORM
- **Database:** PostgreSQL (Supabase/Helium PG)
- **Validation:** Zod
- **AI Model:** Anthropic Claude

## Where things live

- **Backend API:** `artifacts/api-server`
- **Frontend App:** `artifacts/cadstone`
- **DB Schema:** `lib/db/schema.ts`
- **API Contract (Source of Truth):** `lib/api-spec/openapi.yaml`
- **Generated API Client:** `lib/api-client-react/src/generated/`
- **Generated API Zod Schemas:** `lib/api-zod/src/generated/`
- **Transactional Email:** `artifacts/api-server/src/lib/email.ts`
- **DB Backup Script:** `artifacts/api-server/scripts/db-backup.mjs`
- **MCP Server:** `lib/mcp-server`
- **Frontend Role Access Helpers:** `src/lib/role-access.ts`
- **Frontend Global Error Boundary:** `src/components/ErrorBoundary.tsx`
- **Contract Tests:** `artifacts/api-server/test/*-contract.test.ts`
- **E2E Playwright Tests:** `artifacts/cadstone/tests/e2e/`
- **App Layout / Top Nav / Mobile Bottom Nav / Breadcrumbs:** `artifacts/cadstone/src/components/layout/{AppLayout,TopNav,MobileBottomNav,Breadcrumbs}.tsx`
- **Breadcrumbs Hook:** `artifacts/cadstone/src/hooks/use-breadcrumbs.tsx`
- **Feature Flags:** `artifacts/cadstone/src/lib/features.ts`
- **Reusable Create Job Dialog:** `artifacts/cadstone/src/components/jobs/CreateJobDialog.tsx`

## Architecture decisions

- **API Contract First:** `openapi.yaml` is the single source of truth for the API, with generated clients and Zod schemas ensuring consistency. Manual edits to generated files are forbidden.
- **Robust Authentication & Authorization:** JWT with in-memory access tokens and HTTP-only refresh cookies. Role-based access control (admin, project_manager, crew_member) enforced server-side, with corresponding UI affordance hiding for read-only roles.
- **Database Integrity:** Schema-level `CHECK` and `FOREIGN KEY` constraints enforce critical invariants directly in PostgreSQL.
- **Schema migrations are the source of truth (Task #346):** Hand-written idempotent SQL files in `lib/db/migrations/*.sql` are applied by the custom runner in `lib/db/src/migrate.ts` (ledger table `workspace_schema_migrations`). `scripts/post-merge.sh` runs `pnpm --filter db check-migrations-journal && pnpm --filter db migrate` on every merge — `drizzle-kit push --force` is **never** used in CI/post-merge because it can silently turn a column rename into a destructive drop-and-recreate. `migrations/meta/_journal.json` is kept 1:1 with the SQL files (regen with `pnpm --filter db rebuild-migrations-journal`); the post-merge check fails loudly if the two drift apart. See `lib/db/README.md` for the full workflow.
- **Atomic Rate Limiting:** All API rate limits use token buckets stored in a shared Postgres table, ensuring global budget enforcement across multiple API instances and preventing race conditions.
- **Decoupled DB Backups:** A dedicated Node script performs `pg_dump | gzip` and uploads to object storage, with robust alerting and pruning, designed for scheduled deployment or GitHub Actions trigger.
- **Admin Reports (Task #322):** `/reports/*` is admin-only (`ROLE_GATES.reports = ["admin"]`, backend `requireAdmin`). Five reports under one shell with left-rail subnav: A/R Aging, Revenue by Month, Pipeline & Win Rate, Days to Payment, Jobs by Stage. Each report fetches `/api/reports/<slug>?range=last_30|last_90|ytd|custom[&from&to]` via direct axios (not in `openapi.yaml`); CSV export reuses the same endpoint with `format=csv`. SQL aggregates use `tracker_invoices` / `invoice_line_payments` joined to `financial_trackers → jobs → clients`; lead funnel maps `open→New, qualified→Qualified, in_negotiation→Proposal, won, lost`. Charts are inline SVG (no recharts dep).
- **Role-aware Home (Task #321):** `/` and `/dashboard` both render `src/pages/home/index.tsx`, which fetches `GET /dashboard/home` and dispatches by role to `MyDayPage` (crew), `PMHomePage` (PM), or `AdminHomePage` (admin). The endpoint returns a discriminated union `{ role, data }`. Pure at-risk classifiers live in `artifacts/api-server/src/lib/at-risk.ts` (overdue schedule items, pending COs, past-due invoices via `invoiceDate + netDays`, missing daily logs by working-day window) with unit tests in `test/at-risk.test.ts`. Old all-roles dashboard is reachable at `/dashboard/legacy`.
- **Role-aware Information Architecture (Task #318):** Top nav exposes role-specific primary destinations (admin/PM: Home·Clients·Schedule·Daily Logs·Sales·Reports·Resources; crew: Home·My Jobs·Resources; Reports gated behind `FEATURES.reports`). On `<md` viewports a fixed bottom-tab navigator (`MobileBottomNav`, `aria-label="Primary mobile navigation"`) replaces the hamburger drawer; admin/PM mobile tabs link to `/schedule` and `/daily-logs`. Persistent breadcrumbs render under the top nav, auto-derived from the route and overridable per-page via `useSetBreadcrumbs`. Top-level `/files/*` routes were removed in favor of role-based `<FilesRedirect>` (crew → `/jobs`, others → `/clients`); per-job `/jobs/:jobId/files/*` is unchanged. The Create Job dialog is a reusable component so client-detail can launch it in place with `defaultClientId` + `lockClient`.
- **Company-wide Schedule & Daily Logs (Task #323):** `/schedule` and `/daily-logs` are admin/PM-only aggregate views (gated by `ROLE_GATES.companyViews` + server `requireManagerOrAbove`; crew gets 403 / route redirect to `/403`). Both back ends are single-page paginated SQL with hydrated client/job context (jobTitle, clientId, clientName) attached inline so the client doesn't N+1; both endpoints support `?cursor=&limit=` (cursor mode) and `?page=&pageSize=` (page mode). Client pages persist filters and view choice in the URL.

## Product

- **Job Management:** Create (admin-only), edit, assign, track status, and complete jobs.
- **Lead Management:** Track and manage sales leads.
- **Scheduling:** Create and manage project schedules.
- **Daily Logging:** Record daily activities and attach files.
- **File Management:** Upload, store, and access project-related documents.
- **AI Assistant:** In-app AI agent (Anthropic Claude) for read-only MCP tool access, conversation persistence, and usage tracking.
- **User & Team Management:** Seeded user accounts, in-app team management, role-based access.
- **Financials:** Estimate and invoice spreadsheet parsing for jobs.

## User preferences

I want iterative development.
I prefer detailed explanations.
Ask before making major changes.
Do not make changes to folder `artifacts/mockup-sandbox`.
Do not make changes to files related to `mcp.test.ts`.

## Gotchas

- **File Type Bundling:** Ensure `file-type` and `exceljs` dependencies are correctly bundled and externalized for production deploys to avoid `415 Unsupported file type` or `Cannot find package 'exceljs'` errors.
- **API Contract Discrepancies:** If the API handler and `openapi.yaml` disagree, **always fix the spec** first, then regenerate.
- **Money Fields:** Always use `type: integer` with `maximum: 9007199254740991` for money fields in `openapi.yaml` to avoid `bigint` issues.
- **Date Fields:** Use `type: string` with `pattern: ^\\d{4}-\\d{2}-\\d{2}$` and **no** `format: date` for calendar dates in `openapi.yaml` to prevent silent `Date` object coercion.
- **Old `.xls` Files:** Legacy `.xls` (binary BIFF) uploads are not supported; users must "Save As .xlsx" and re-upload.
- **No Manual API Client Calls for Generated Hooks:** New code must use generated mutation hooks (e.g., `useClientsPostClients`) for endpoints with generated hooks, centralizing cache invalidation and error handling. Direct `api.post/put/patch/delete` calls are only for endpoints not yet in `openapi.yaml`.

## Pointers


- **Replit App Storage:** _Populate as you build_
- **Google Cloud Storage (GCS) Sidecar:** _Populate as you build_
- **pnpm workspaces:** [https://pnpm.io/workspaces](https://pnpm.io/workspaces)
- **Drizzle ORM:** [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **Zod:** [https://zod.dev/](https://zod.dev/)
- **Tailwind CSS:** [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **shadcn/ui:** [https://ui.shadcn.com/docs](https://ui.shadcn.com/docs)
- **Resend:** [https://resend.com/](https://resend.com/)
- **Anthropic Claude:** _Populate as you build_
- **Playwright:** [https://playwright.dev/docs/](https://playwright.dev/docs/)
- **Postgres `pg_dump`:** [https://www.postgresql.org/docs/current/app-pgdump.html](https://www.postgresql.org/docs/current/app-pgdump.html)
- **Restore Drill Documentation:** `docs/restore-drill.md`
