# CAD Stone Networks — Workspace

## Overview

CAD Stone Networks is a pnpm monorepo project designed as an internal construction management tool for Cadstone Works. Its primary purpose is to centralize and streamline operations, offering robust functionalities for job tracking, lead management, scheduling, daily logging, and file management. The system also integrates AI-agent capabilities and a Model Context Protocol (MCP) server to support external integrations and AI-driven workflows. This project aims to enhance operational efficiency and management within the construction business.

## User Preferences

I want iterative development.
I prefer detailed explanations.
Ask before making major changes.
Do not make changes to folder `artifacts/mockup-sandbox`.
Do not make changes to files related to `mcp.test.ts`.

## System Architecture

The project is structured as a pnpm monorepo using Node.js 24 and TypeScript 5.9.

**Backend (`artifacts/api-server`):**
- Built with Express 5, providing REST APIs at `/api` on port 8080.
- **Authentication:** JWT with in-memory access tokens and HTTP-only refresh cookies. Includes role-based access control (`admin`, `project_manager`, `crew_member`) with seeded user accounts and an in-app team management system.
- **Job creation is admin-only** (post-#277 owner directive). Only admins can `POST /api/jobs` and `POST /api/jobs/:id/assignees`; PMs continue to edit jobs they manage via `PUT /api/jobs/:id` but cannot create new ones or assign workers. The frontend hides every "+ New Job" affordance (dashboard split-button, jobs-list empty states, in-job sidebar) for non-admin roles.
- **File Storage:** Utilizes Replit App Storage (GCS via sidecar) for secure file management.
- **Role-gating:** Centralized visibility helpers enforce access control based on user roles across all API routes.
- **API for Agents:** Features Personal Access Tokens (PATs), RFC 7807 problem details for errors, `Idempotency-Key` for write endpoints, cursor pagination, and `X-RateLimit-*` headers.

**Frontend:**
- Developed using React, Vite, Tailwind CSS v4, and shadcn/ui.
- **UI/UX:** Adheres to shadcn/ui principles with a primary blue theme, light gray backgrounds, and consistent component patterns.
- **Key Features:** Dashboard, job, lead, schedule, daily log management, and a shared file browser.
- **UX affordances:** Dashboard split-button (`+ New Job` / chevron menu with Daily Log, Schedule Item, Lead). Global keyboard shortcuts (`/` focuses search, `n` opens New Job, `g j/d/c/l` navigate Jobs/Daily Logs/Clients/Leads, `?` opens help overlay; suppressed while typing in inputs). Sticky job-detail header with shadow on scroll. Inline status popover on Jobs list rows for admins/PMs (optimistic update with rollback on failure). Empty states differentiate zero-jobs vs filtered-no-match. Create Job step 1 includes Start Date and Estimated Completion fields with a post-create toast hint when no start date is set.
- **AI Assistant:** An in-app AI Assistant uses Anthropic Claude, providing read-only MCP tool access, SSE event streaming, conversation persistence, and enforcing per-user token caps and rate limits.
- **Frontend role gating (`canWrite` convention):** `src/lib/role-access.ts` exports `WRITE_ROLES` (`["admin", "project_manager"]`) and a `canWriteRole(role)` helper. Pages that mix read affordances (Export, History, Filter) with write affordances (Set Baseline, Workday Exception, Settings cog, New Schedule Item, Delete All) derive `const canWrite = canWriteRole(currentUser?.role)` and pass it as a `canWrite: boolean` prop to subcomponents (e.g. `ScheduleToolbar`, `BaselineTab`, `ExceptionsTab`). Write affordances are **hidden** when `canWrite` is false — never rendered as disabled "ghost" buttons. Daily Logs uses a per-row variant: a log's Edit/Delete is only shown to admin/PM or to the log's author (`log.createdBy === user.id`). Server-side authorization remains the source of truth; this is purely UI hardening so crew members get a clean read-only view.
- **Top-level ErrorBoundary:** `src/components/ErrorBoundary.tsx` wraps `<QueryClientProvider>` + `<RouterProvider>` in `App.tsx`. A thrown render error shows a recoverable Reload card instead of blanking the app; the underlying error is logged via `console.error` with the React component stack for triage.

**AI Agent (in-app, read-only):**
- Powered by Anthropic Claude, configurable via `AGENT_MODEL` env var.
- Provides read-only MCP tool access for jobs, leads, clients, schedule items, files, daily logs, activity, and current user. Tool calls inherit all role-gating and visibility rules.
- Features SSE event streaming for responses.
- Persists conversations and usage in `agent_conversations`, `agent_messages`, and `agent_usage_monthly` tables.
- Implements per-user monthly token caps and an organization-wide monthly token budget. Includes per-user in-flight and rate limits.
- Supports abort handling for ongoing operations and extracts citations from tool results.

**Health endpoints (api-server):**
- `GET /api/livez` — shallow always-200 liveness probe used by container-level health checks. Returns `{status:"ok"}`. Has no dependencies and never blocks the load balancer from routing traffic.
- `GET /api/healthz` — deep readiness probe. Runs `SELECT 1` against the primary DB and a `bucket.exists()` head call against the upload bucket in parallel with a hard 1.5s timeout per check. Returns `200 {status:"ok", db:true, storage:true, durationMs, errors:[]}` on success or `503 {status:"degraded", db:bool, storage:bool, durationMs, errors:[{code,message}]}` if any dependency is unhealthy. Failures are logged via `logger.warn` with `errorCode: "HEALTHZ_DEGRADED"` so an operator can grep production logs without reading bodies.
- `POST /api/_client-error` — anonymous sink for browser-side render crashes caught by the frontend `ErrorBoundary`. Validates a small zod payload (`message`, `stack?`, `componentStack?`, `url`, `userAgent?`, `releaseSha?`), truncates stacks to 8 KB, strips query strings/fragments from `url`, and emits a structured `logger.warn` with `errorCode: "CLIENT_RENDER_CRASH"`. Returns 204 with no body. Has its own per-IP rate limit (default 30/min, override via `CLIENT_ERROR_PER_IP_MAX` / `CLIENT_ERROR_PER_IP_WINDOW_MS`) so a buggy client cannot flood the log sink. Mounted before `requireAuth` because a render crash may happen before auth state hydrates; if a valid Bearer token is present the user id is attached to the log entry on a best-effort basis.

**Pre-release smoke check (Playwright golden path):**
Before publishing, run `pnpm --filter @workspace/cadstone exec playwright test golden-path-admin golden-path-roles` against a freshly-seeded local DB. The golden-path admin spec walks one job from sign-in → create client → create job → schedule item → daily log + PDF attachment → financials estimate + % complete edit → mark complete, asserting each step's resulting record renders on its dashboard / list view. The role-restricted spec covers the same flow for PM and crew personas, asserting admin-only writes return 403 and write affordances are hidden in the UI. Both specs live in `artifacts/cadstone/tests/e2e/`. The e2e suite has zero `test.skip()` calls — any conditional-skip site has been converted to either a hard fixture or a loud `throw` so silent coverage loss surfaces in CI.

The same two specs also re-run under the `mobile-chromium` Playwright project (iPhone 13 viewport, `hasTouch: true`) — they are wired to both the default `chromium` project and the new `mobile-chromium` project in `playwright.config.ts`, so the default `playwright test` invocation above covers both viewports in one pass. On mobile, each spec asserts the hamburger nav trigger (`aria-label="Open navigation menu"`) is visible, the desktop top nav (`nav.hidden.lg:flex`) is hidden, and drives the first navigation through the Sheet drawer (`gotoViaTopNav` in `tests/e2e/helpers/mobile.ts`) so layout / tap-target / drawer regressions surface before they reach foremen and crew in the field. To run only the mobile variant: `pnpm --filter @workspace/cadstone exec playwright test golden-path-admin golden-path-roles --project=mobile-chromium`.

**Production deploy smoke check (api-server):**
After every deploy, verify the bundled server can sniff binary uploads (regression guard for `file-type` ESM dynamic-import bundling):
1. `curl -fsS https://<deploy-host>/api/healthz` — expect `200` and a body with `db:true, storage:true`. A `503` (with `db:false` or `storage:false`) means a dependency is broken; investigate before letting traffic continue to flow.
2. As an admin, upload a small PDF, DOCX and XLSX to a folder via `POST /api/folders/:id/files` (multipart, with `X-Requested-With: XMLHttpRequest`). Expect `201` for all three. A `415` with "Unsupported file type" on a real PDF/DOCX indicates `file-type`'s dynamic deps (`strtok3`, `token-types`, `@tokenizer/inflate`) were not shipped — re-check `artifacts/api-server/build.mjs` externals and `package.json` dependencies, and that `node_modules` is deployed alongside `dist/`.
3. As an admin/PM, on a job upload an `.xlsx` estimate via `POST /api/jobs/:jobId/financials/estimate` (multipart, with `X-Requested-With: XMLHttpRequest`). Expect `200` and the parsed CSV preview to come back from Anthropic. A 5xx or `Cannot find package 'exceljs'` indicates `exceljs` was not externalized correctly — re-check `build.mjs` externals.

**Spreadsheet parsing (api-server):**
The api-server uses `exceljs` (not `xlsx` / SheetJS Community) to read uploaded `.xlsx` estimate and invoice spreadsheets. The `xlsx` package was removed in #286 because it had two HIGH CVEs (CVE-2023-30533 prototype pollution and CVE-2024-22363 ReDoS) and was permanently abandoned on npm — fixes only ship via `cdn.sheetjs.com`. Legacy `.xls` (binary BIFF) uploads return a clean 400 asking the user to "Save As .xlsx" and re-upload, since exceljs only reads OOXML. The thin parsing helper lives at `src/lib/spreadsheet.ts` (`parseXlsxToSheets`).

**API contract (`lib/api-spec` → `lib/api-zod`, `lib/api-client-react`):**
- `lib/api-spec/openapi.yaml` is the **source of truth** for the API contract. Never edit anything under `lib/api-{client-react,zod}/src/generated/` by hand — those files are regenerated by `pnpm --filter @workspace/api-spec run codegen` and `pnpm check-api-codegen` enforces they match the spec.
- When a handler in `artifacts/api-server` and the spec disagree, fix the **spec** to describe what the handler actually does, then regenerate. If the create-vs-update payload differs (e.g. `POST /jobs` requires `clientId` but `PUT /jobs/{id}` doesn't), express that as two schemas in the spec rather than relaxing one to fit both.
- For each non-trivial contract rule, add a **contract test** under `artifacts/api-server/test/*-contract.test.ts` that imports the generated zod schemas from `@workspace/api-zod` and asserts both sides agree (see `jobs-contract.test.ts` for the pattern). This catches future drift before MCP/generated-client callers see a confusing 400.
- Money fields are always `type: integer` with `maximum: 9007199254740991` (JS `Number.MAX_SAFE_INTEGER`) — **never** `format: int64`, which orval compiles to `bigint`. Calendar-date fields are `type: string` with `pattern: ^\\d{4}-\\d{2}-\\d{2}$` and **no** `format: date` — `format: date` makes orval emit `z.coerce.date()` which silently turns ISO timestamps into `Date` objects.
- **All writes go through generated mutation hooks** from `@workspace/api-client-react` (e.g. `useClientsPostClients`, `useLeadsPutLeadsId`, `useDailyLogsDeleteDailyLogsId`). New code must not call `api.post/put/patch/delete` from `@/lib/api` for endpoints that have generated hooks. Centralize cache invalidation per entity (e.g. `invalidateClientsList` + `invalidateClientDetail` helpers using the `getXxxQueryKey()` partial-match) and surface failures via `toastApiError`/`classifyApiError` from `@/lib/api-errors`, which transparently handle both `ApiError` (from `customFetch`) and `AxiosError`. Multipart uploads are the one exception: orval drops the body from the hook variables, so call the bare generated function with `body: formData` (`leadsPostLeadsIdAttachments`, `dailyLogsPostDailyLogsIdAttachments`, `dailyLogsPostDailyLogsIdCommentAttachments`) — that still uses `customFetch`, not axios. Endpoints with no generated hook today (financials, daily-log settings, daily-log custom-fields) continue to use `api.*` until added to `openapi.yaml`.

**Database (`lib/db`):**
- PostgreSQL with Drizzle ORM, comprising 16 tables.
- Schema changes are managed via `drizzle-kit push --force` and custom SQL migration files.
- Test database provisioning is automated for local development and testing.
- **Schema-level integrity guards (Task #290):** the database (not just the
  TypeScript layer) enforces these invariants — all backed by CHECK / FK
  constraints in `0012_schema_hardening.sql`:
  - `financial_trackers.job_id` is `NOT NULL` and `ON DELETE CASCADE`, so
    deleting a job removes its tracker (and SOV areas, line items,
    invoices, and payments through the existing per-table cascades).
  - `jobs.contract_type` accepts only `NULL`, `'fixed_price'`, or `'open_book'`.
  - `folders.media_type` accepts only `'document'`, `'photo'`, `'video'`.
  - `agent_messages.stopped_reason` accepts `NULL` plus the Anthropic SDK
    stop_reason values (`end_turn`, `max_tokens`, `stop_sequence`,
    `tool_use`, `pause_turn`, `refusal`) and the orchestrator sentinels
    (`aborted`, `api_error`, `max_iterations`); OpenAI-style values
    (`length`, `content_filter`, `tool_calls`, `error`) are tolerated for
    forward compatibility.
  - `client_contacts` requires at least one of `first_name` / `last_name`
    to be non-null.

**Transactional email (`artifacts/api-server/src/lib/email.ts`):**
- Resend (https://resend.com) is the configured provider. The thin wrapper exports `sendInvite({to, inviteLink, inviterName, inviteeName?})` and `sendPasswordReset({to, resetLink})`. Both throw on provider failure — no silent no-ops — so the caller can surface the error to the admin and fall back to copy/paste of the one-time link.
- Required env (set via Replit secrets, never in code): `RESEND_API_KEY` and `EMAIL_FROM` (a verified Resend sender, e.g. `Cadstone <noreply@mail.cadstoneworks.com>`). Optional `EMAIL_REPLY_TO`.  Outbound URLs are built from `APP_PUBLIC_URL` (production) or `REPLIT_DEV_DOMAIN` (dev).
- The invite admin screen (`POST /api/users`, `POST /api/users/:id/invite`) calls the helper, then writes the outcome to `users.last_invite_email_sent_at` / `users.last_invite_email_error` and returns it on the response (`emailDelivery: { emailed, emailError, lastInviteEmailSentAt }`). The Users page surfaces this as "Last emailed …" / "Email failed — share link manually" under the Invite-pending badge, plus a toast at create time.
- Tests stub the sender via `__setEmailSenderForTests` (see `artifacts/api-server/test/user-invites.test.ts`) — production code paths never hit Resend during the test suite.

**Database backups (`artifacts/api-server/scripts/db-backup.mjs`):**
- A standalone Node script that runs `pg_dump | gzip` against `SUPABASE_DATABASE_URL` (falling back to `DATABASE_URL`) and uploads the result to `backups/db/YYYY-MM-DD.sql.gz` in the configured `DEFAULT_OBJECT_STORAGE_BUCKET_ID`. Designed to be invoked once per day from a Replit Scheduled Deployment ("cron").
- **`pg_dump` toolchain pin:** the script shells out to `pg_dump`, which comes from `pkgs.postgresql_17` in `replit.nix` (the `.replit` `modules` line additionally lists `postgresql-16`). Pinning the Postgres major version in Nix is what guarantees deterministic dump format across runs — bumping Supabase's server version requires bumping `postgresql_17` in lockstep so the client stays >= server. Do **not** rely on a system `pg_dump` outside Nix; the Scheduled Deployment must inherit the same Nix env as the api-server.
- Same step prunes old backups: keep daily for 14 days, weekly for 12 weeks, monthly for 12 months. Newest-per-bucket wins. Today's freshly-uploaded backup is always kept regardless of policy.
- **Backup alerting (Task #310):** the script alerts on any failed run via `scripts/lib/backup-alerts.mjs`, which fans out to Resend email (`BACKUP_ALERT_EMAIL` + the existing `RESEND_API_KEY` / `EMAIL_FROM`) and/or a Slack-compatible incoming webhook (`BACKUP_ALERT_WEBHOOK_URL`). Failure alerts include the most recent successful backup's object name, size, and upload timestamp so on-call sees how stale the last good copy is. Companion verifier `scripts/db-backup-check.mjs` (`pnpm --filter @workspace/api-server run backup:check`) runs nightly after the backup cron and alerts when today's `backups/db/YYYY-MM-DD.sql.gz` is missing OR when its size falls outside ±50 % of the trailing 7-day median (tolerance configurable via `BACKUP_SIZE_TOLERANCE_PCT`, window via `BACKUP_HISTORY_WINDOW_DAYS`; the size check is skipped when fewer than 3 prior backups exist). Both scripts emit pino JSON with `component: "db-backup"` / `component: "db-backup-check"` and the same `event:` keys (`backup_failed`, `missing_today`, `size_anomaly`, `alert_email_sent`, `alert_webhook_sent`, `alert_no_channels_configured`) so the deployment-log dashboard groups them. See `docs/restore-drill.md` for the on-call runbook entry that documents where alerts come from.
- Logs as one structured JSON line per significant step (`event: backup_start | backup_uploaded | prune_summary | prune_deleted | backup_done | backup_failed`) so the deployment-logs viewer can ingest it cleanly.
- **Two scheduling options ship in the repo; pick one (running both is harmless — same UTC-day object name):**
  1. **GitHub Actions (default):** `.github/workflows/db-backup.yml` runs at 09:00 UTC daily and POSTs to the api-server's `/api/internal/run-db-backup` webhook (`artifacts/api-server/src/routes/internal-backup.ts`). The webhook is shared-secret authenticated (`BACKUP_TRIGGER_SECRET`, 32+ chars) and spawns the `db-backup.mjs` script *inside* the production deployment, so the actual `pg_dump` and object-storage upload run with the Replit sidecar credentials they need. Required GH secrets: `BACKUP_WEBHOOK_URL` (full URL to the route on the production domain) and `BACKUP_TRIGGER_SECRET`. Same secret must be set on the api-server deployment.
  2. **Replit Scheduled Deployment:** create a new "Scheduled" deployment in the Replit UI with build `pnpm --filter @workspace/api-server install --frozen-lockfile`, run `pnpm --filter @workspace/api-server run backup:db`, schedule `0 9 * * *`. It must inherit `SUPABASE_DATABASE_URL` and `DEFAULT_OBJECT_STORAGE_BUCKET_ID`. No webhook secret needed in this mode.
- The npm script entry point is `pnpm --filter @workspace/api-server run backup:db` regardless of which scheduler triggers it.
- The webhook returns 503 when `BACKUP_TRIGGER_SECRET` is unset, so the route is dormant until an operator opts in.
- The recovery drill is documented in `docs/restore-drill.md` (mirrors `artifacts/api-server/scripts/storage-restore-drill.mjs`). Run quarterly. Production recovery procedure (real outage) is in §A of that doc.

**API Rate Limits (`artifacts/api-server/src/lib/rate-limit.ts`):**
- All limiters are token buckets keyed by IP, email, or authenticated user; counters live in the shared `rate_limit_buckets` Postgres table (Task #296) so multiple API instances behind a load balancer enforce one global budget instead of `instances × max`. Each consume is a single atomic `INSERT ... ON CONFLICT ... RETURNING` against the row, so concurrent requests on the same key (across processes or pool connections) cannot race. Window math uses Postgres `now()` so app-server clock skew can never widen a window. Counters survive an API restart but are reclaimed lazily — every limiter call kicks an opportunistic best-effort `DELETE` of rows whose window ended >60s ago. Defaults are tunable via env vars and the limiter responds with `application/problem+json` (`type=…/rate-limited`, `status=429`) plus a `Retry-After` header. The limiter fails open on a Postgres outage (logs an error, lets the request through) so a DB hiccup cannot lock every user out of the API.
- **Login (`POST /api/auth/login`):** 5 failed attempts per IP per 15 min (`LOGIN_IP_MAX`, `LOGIN_IP_WINDOW_MS`) plus a defense-in-depth 5 attempts per email per 15 min (`LOGIN_EMAIL_MAX`, `LOGIN_EMAIL_WINDOW_MS`). A successful login clears BOTH buckets so a legitimate user who mistypes their password a few times is not locked out for the rest of the window.
- **AI parse endpoints (`POST /api/jobs/:jobId/financials/estimate`, `POST /api/jobs/:jobId/financials/invoices`):** 20 req / hour per authenticated user (`AI_PARSE_PER_USER_MAX`, `AI_PARSE_PER_USER_WINDOW_MS`). Caps spend on the upstream LLM provider.
- **Upload endpoints (file/attachment routes under `/api/folders/:id/files`, `/api/daily-logs/*/attachments`, `/api/leads/:id/attachments`, `/api/schedule-items/:id/attachments`, `/api/resources/folders/:id/upload`):** 100 req / hour per authenticated user (`UPLOAD_PER_USER_MAX`, `UPLOAD_PER_USER_WINDOW_MS`). Protects object storage from runaway clients.
- Coverage tests live in `artifacts/api-server/test/audit-fixes.test.ts` (login burst + 429 envelope, daily-log/job-assignee/lead-convert authz gates).

**Model Context Protocol (MCP) Server (`lib/mcp-server`):**
- Wraps the REST API for external agents, authenticating via PATs.
- Supports HTTP/streamable and Stdio transports.
- Audits all tool calls to `activity_log` for complete attribution.

## External Dependencies

- **Monorepo Tool:** pnpm workspaces
- **API Framework:** Express 5
- **Database:** PostgreSQL (primary is Supabase, secondary is Replit-managed Helium PG)
- **ORM:** Drizzle ORM
- **Validation:** Zod
- **Frontend Framework:** React
- **Build Tools:** Vite
- **Styling:** Tailwind CSS v4, shadcn/ui
- **HTTP Client:** Axios
- **State Management:** Zustand
- **Routing:** react-router-dom v6
- **Notifications:** Sonner
- **Icons:** Lucide-react
- **AI Model:** Anthropic Claude
- **File Storage:** Replit App Storage (Google Cloud Storage)