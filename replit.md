# CAD Stone Networks

Centralizes and streamlines construction management operations, offering job tracking, lead management, scheduling, daily logging, and file management for Cadstone Works.

## Run & Operate

- **Run Dev Server:** `pnpm dev`
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **Codegen (API):** `pnpm --filter @workspace/api-spec run codegen` (regenerates API client and Zod schemas)
- **Codegen drift check:** `pnpm check-api-codegen`
- **Unused-code sweep:** `pnpm knip` (config in `knip.json`; registered as a CI validation step — must exit clean)
- **DB Push:** `drizzle-kit push --force` (for schema changes)
- **Env Vars (canonical list — checked into `docs/launch-checklist.md` §4.1):**
    - **Required in production (cutover-blocking if missing):**
      - DB: `SUPABASE_DATABASE_URL` (and dev/test fallback `DATABASE_URL`)
      - Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_UPLOAD_SECRET`, `JWT_RESET_SECRET`, `SESSION_SECRET`
      - Email: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_PUBLIC_URL` (invites, password resets, optional email transport for backup alerts)
      - CORS / origins: `CORS_ALLOWED_ORIGINS` *or* `APP_ORIGIN` (one must list the customer-facing origin — `artifacts/api-server/src/lib/cors.ts` reads both, plus `FRONTEND_ORIGIN` / `PUBLIC_APP_ORIGIN` / `CUSTOM_DOMAIN_ORIGIN` / Replit-managed domain vars, into one allow-list); `NODE_ENV=production`
      - AI: `AI_INTEGRATIONS_ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
      - Storage: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`
      - Monitoring: `SENTRY_DSN_API` (server boot fails without it in prod)
    - **Recommended:** `SENTRY_DSN_WEB` (warning-only if missing; client errors will not be captured)
    - **Optional / tunables:**
      - `AGENT_MODEL` (AI Assistant model override)
      - `BACKUP_TRIGGER_SECRET`, `BACKUP_WEBHOOK_URL` (arms the GitHub Actions DB backup cron — see `docs/restore-drill.md` §6)
      - `BACKUP_ALERT_EMAIL`, `BACKUP_ALERT_WEBHOOK_URL` (backup alert fan-out; see `docs/restore-drill.md`)
      - `BACKUP_SIZE_TOLERANCE_PCT`, `BACKUP_HISTORY_WINDOW_DAYS` (backup-size sanity check tuning)
      - Rate limits: `LOGIN_IP_MAX`, `LOGIN_IP_WINDOW_MS`, `LOGIN_EMAIL_MAX`, `LOGIN_EMAIL_WINDOW_MS`, `AI_PARSE_PER_USER_MAX`, `AI_PARSE_PER_USER_WINDOW_MS`, `UPLOAD_PER_USER_MAX`, `UPLOAD_PER_USER_WINDOW_MS`
      - Sentry build-time (web source-map upload only — never reach the browser): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB`; runtime tag overrides: `SENTRY_ENVIRONMENT` / `VITE_SENTRY_ENVIRONMENT`, `VITE_RELEASE_SHA` / `REPLIT_GIT_COMMIT_SHA`; smoke endpoint: `SENTRY_TEST_TOKEN`
    - **Sentry plumbing (Task #348):** the web DSN, release SHA, and environment are injected into the client bundle via Vite `define` (`__SENTRY_DSN_WEB__`, `__SENTRY_RELEASE__`, `__SENTRY_ENVIRONMENT__`) — deliberately NOT via `envPrefix`, so `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT_WEB` never reach the browser. Source-map upload during web build requires those three; maps are emitted only when all three are set, uploaded to Sentry, then deleted from `dist/public/assets` so they never ship to end users. PII filter (`artifacts/api-server/src/lib/pii-filter.ts`, mirrored in `artifacts/cadstone/src/lib/sentry.ts`) drops events whose payload contains an email, phone number, or US street address. Runbook: when an error appears in Sentry, check `release`/`environment` tags and the attached `route`+`requestId` extras to correlate with Pino logs.
- **Launch readiness:** see `docs/launch-checklist.md` for the cutover gate (automated gates, CI test runs, manual smoke, env-var audit, security scanners, architect sign-off).

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
- **Sentry Init (server):** `artifacts/api-server/src/lib/sentry.ts` (loaded first in `src/index.ts`)
- **Sentry Init (web):** `artifacts/cadstone/src/lib/sentry.ts` (loaded first in `src/main.tsx`)
- **Sentry PII filter + tests:** `artifacts/api-server/src/lib/pii-filter.ts`, `test/pii-filter.test.ts`
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
- **Playwright e2e in CI (Task #344):** The Playwright-bundled chromium can't load its shared libs on Nix. Two supported entry points: (1) CI — `.github/workflows/e2e.yml` runs the suite inside `mcr.microsoft.com/playwright:v1.59.1-jammy` against a Postgres 17 service container; required repo secrets are `SEED_ADMIN_CESAR_PASSWORD`, `SEED_ADMIN_ANWAR_PASSWORD`, `SEED_WORKER_FIXTURE_PASSWORD`, `SEED_PM_FIXTURE_PASSWORD`, `E2E_JWT_SECRET`. (2) Local — `scripts/run-e2e-local.sh` recreates the test DB, seeds users + the baseline E2E client/job, boots api-server + Vite, and runs the suite. The local script auto-points at `pkgs.chromium` from `replit.nix` via `CHROMIUM_PATH` (the playwright config already honors it).

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
- **Launch Readiness Checklist:** `docs/launch-checklist.md`
