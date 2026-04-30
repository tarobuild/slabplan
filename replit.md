# CAD Stone Networks — Workspace

## Overview

pnpm workspace monorepo — TypeScript, Express 5 backend, React + Vite + shadcn/ui frontend. Internal construction management tool for Cadstone Works.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Build**: esbuild (CJS bundle for API), Vite (frontend)

## Packages

### `artifacts/api-server`
Express 5 REST API server running on port 8080. All routes mounted at `/api`.
Auth: JWT (access token in-memory + httpOnly refresh cookie via bcrypt).
File storage: Replit App Storage (GCS via sidecar). All uploads write to `$PRIVATE_OBJECT_DIR/cadstone/uploads/...`; the `files.fileUrl` column keeps the `/uploads/<jobId>/<mediaType>/<filename>` shape and is mapped to a GCS object at read time. Do NOT write to local disk — the deployed filesystem is ephemeral. Always pass `contentType: uploadedFile.mimetype` to `writeUploadedBuffer`.

Routes:
- `GET /api/healthz` — health check
- `POST /api/auth/login|logout|refresh|forgot-password|reset-password`
- `POST /api/auth/register` — admin-only user creation
- `GET/PUT /api/users/me`, `GET /api/users`
- `GET/POST /api/jobs`, `GET/PUT/DELETE /api/jobs/:id`
- `GET/POST /api/jobs/:jobId/folders`
- `PUT/DELETE /api/folders/:id`, `POST /api/folders/:id/copy|move`
- `GET/POST /api/folders/:id/files`
- `GET /api/files/:id/download`, `DELETE /api/files/:id`
- `GET/POST /api/leads`, `GET/PUT/DELETE /api/leads/:id`
- `POST /api/leads/:id/contacts|attachments|convert-to-job`
- `GET /api/activity`
- `GET /api/dashboard/stats`
- `GET/POST /api/jobs/:jobId/daily-logs`, `GET /api/daily-logs/:id`
- `GET/POST /api/jobs/:jobId/schedule`, `GET/PUT/DELETE /api/schedule-items/:id`

### `artifacts/cadstone`
React + Vite + Tailwind CSS v4 + shadcn/ui frontend. Runs on port assigned by `$PORT`.
Base path: `/`. Proxies `/api` to `localhost:8080`.
Router: **react-router-dom v6** (BrowserRouter + nested routes).

Key files:
- `src/App.tsx` — react-router-dom v6 BrowserRouter, protected routes, silent refresh on mount
- `src/lib/api.ts` — Axios named exports: `api` (auth interceptor) and `authApi` (raw). `bootstrapAuthSession` for session restore on app load.
- `src/store/auth.ts` — Zustand auth store (user, accessToken, setAuth, clearAuth)
- `src/components/layout/` — AppLayout, TopNav, Sidebar
- `src/components/FileBrowser.tsx` — shared file browser (folders + files) for Documents/Photos/Videos tabs
- `src/pages/` — All pages are fully implemented (no more stubs)

### Pages (all fully implemented)
- `/dashboard` — stat cards (active jobs, open leads, schedule items, my logs) + recent activity feed
- `/jobs` — jobs table with search, status filter, pagination + Create Job modal + delete
- `/jobs/:jobId/summary` — editable job form (all fields, work days toggles, save)
- `/jobs/:jobId/files/documents` — folder browser + file upload (documents)
- `/jobs/:jobId/files/photos` — folder browser + file upload (photos)
- `/jobs/:jobId/files/videos` — folder browser + file upload (videos)
- `/jobs/:jobId/schedule` — schedule items table + Add Item modal (color, dates, progress)
- `/jobs/:jobId/daily-logs` — daily log cards with search + New Log modal
- `/sales/leads` — leads table with search, status filter + New Lead modal + delete

Theme: Primary blue `#2563EB` (221 83% 53%), page bg `#F9FAFB`, white cards, `#E5E7EB` borders.

Design rules: shadcn/ui everywhere, all forms in Dialog modals, AlertDialog for deletes, 14px body text (`text-sm`), information-dense tables.

Frontend dependencies: axios, zustand, react-router-dom v6, sonner (toasts), lucide-react, shadcn/ui

### `lib/db`
Drizzle ORM + PostgreSQL. 16 tables.

Key tables: users, jobs, folders, files, leads, lead_contacts, lead_attachments, schedule_items, schedule_assignees, daily_logs, daily_log_attachments, daily_log_tags, tags, activity_log

Seed: `pnpm --filter @workspace/db run seed` → 3 users, 5 jobs, 3 leads
Seed credentials (local helium DB only): `cruz.martinez@cadstone.internal` / `Cadstone123!` (also `maria.garcia`, `jake.thompson`).

**Important — DB selection.** `lib/db/src/index.ts` prefers
`SUPABASE_DATABASE_URL` over `DATABASE_URL` when both are set. In this Replit
workspace `SUPABASE_DATABASE_URL` is exported at the workspace level, so the
running dev API server (and any script that imports `@workspace/db` without
unsetting it) talks to the Supabase prod-pooler DB, **not** the local helium
DB. The seeded `*.cadstone.internal` accounts therefore do not work against
the dev API; the live admin accounts in the Supabase DB
(`cesar@cadstone.works`, `anwar@cadstone.works`) do. The unit-test suites in
`artifacts/api-server/test/*.test.ts` `delete process.env.SUPABASE_DATABASE_URL`
in their `before()` hook before importing `@workspace/db` so they reach
helium and never burn through Supabase's 15-connection pooler cap. Apply the
same pattern in any new test file or script that needs the local DB.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run check-api-codegen` — re-run `@workspace/api-spec` codegen and fail if the generated React Query (`lib/api-client-react/src/generated/`) or Zod (`lib/api-zod/src/generated/`) clients drift from `lib/api-spec/openapi.yaml`
- `pnpm run validate` — `typecheck` + `check-api-codegen` (CI-style check; both are also registered as named validation commands)
- `pnpm run build` — typecheck + build all packages
- `pnpm test` — run the checked-in automated test suite
- `pnpm --filter @workspace/db run migrate` — apply checked-in SQL migrations
- `pnpm --filter @workspace/db run generate` — generate future Drizzle migrations
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run seed` — seed database with test data

## Auth & password management

This app does **not** have a self-serve "forgot password" / "reset password"
flow. Account creation is admin-only (`POST /api/auth/register` with the
`requireAdmin` middleware) and there is intentionally no transactional email
provider wired up.

For a team of ~5 employees, the cost of standing up an email service (domain
verification, DNS, deliverability, spam filtering, ongoing maintenance) is not
justified. Instead, the admin manages passwords directly:

- **New user:** admin calls `POST /api/auth/register` and shares the chosen
  password with the user out of band (e.g. in person or via a secure channel).
- **Forgotten / rotated password:** the user contacts the admin. The admin
  hands the new password value to the agent as a secret, and the agent
  rewrites `users.password_hash` for that account directly with bcrypt.

If the user count grows or the admin no longer wants to be in the loop, the
right next step is wiring a real transactional email integration (Resend or
SendGrid) and re-introducing `/forgot-password` + `/reset-password`. There is
a regression test in `artifacts/api-server/test/auth.test.ts` that asserts
those routes stay un-exposed until that decision is made deliberately.

## Deployment target — Reserved VM, not autoscale

The production deploy **must** run as a single Reserved VM (deployment type
`vm` in the Publishing pane). Do not use autoscale.

Two pieces of state live in the API server's process memory and silently break
when there is more than one instance:

1. **Rate limiter** (`artifacts/api-server/src/lib/rate-limit.ts`) — counters
   live in an in-process `Map`, so each autoscale instance enforces its own
   limit. Effective limits become `instances × configured_max`.
2. **File-view JTI replay store** (`usedFileViewJtis` in
   `artifacts/api-server/src/lib/auth.ts`) — single-use download tokens are
   tracked in-process. Across multiple instances, a token used on instance A
   is still "fresh" on instance B, defeating the replay protection.

The deployment type cannot be set programmatically — it is configured in the
Publishing pane. If you ever switch to autoscale, both of the above must first
be moved to a shared store (Postgres or Redis).

## Feature Status

- ✅ Backend: 16 DB tables, JWT auth, all routes (jobs, files, leads, schedule, daily-logs, dashboard, activity)
- ✅ Frontend: All pages fully built (dashboard, jobs, job detail with 6 tabs, leads)
- ✅ File management: Folder browser + file upload on all three file tabs
- ✅ Jobs: Create, view, edit, delete with full form
- ✅ Leads: Create, view, delete with status badges and revenue tracking
- ✅ Schedule: Full dialog with 2-column layout (left: title/assignees/sub-tabs, right: dates/time range/color/progress/reminder), start+end time support, multi-day via work days
- ✅ Daily Logs: Default tab when opening a job, BuilderTrend-style activity feed (date-grouped, avatars, inline photo thumbnails, blockquote notes), most recent first, create/edit with weather notes, privacy, keyword search
- ✅ AI-agent API foundation (Task #107): Personal Access Tokens (`cs_pat_…`, SHA-256 hashed), RFC 7807 `application/problem+json` envelopes (including a catch-all 404 for unknown `/api/*` paths), `Idempotency-Key` replay (mounted after `requireAuth`; persists 2xx/4xx/5xx so retries replay byte-for-byte), cursor pagination on activity/jobs/leads/files/schedule (page-based still supported), `X-RateLimit-*` + `Retry-After` headers, public `/openapi.json` and `/.well-known/ai-plugin.json`, settings UI for token management. Cursor support for daily-logs and search is intentionally deferred to follow-up #113 — both still work via page-based pagination today.

## API surface for agents (Task #107)

External integrations (scripts, AI agents) authenticate with a Personal
Access Token via `Authorization: Bearer cs_pat_…`. PATs are issued from
the Settings page, stored as SHA-256 hashes, scoped `read` or
`read_write`, and bypass the browser-only `X-Requested-With` CSRF gate.
Errors are emitted as `application/problem+json` (RFC 7807) with
`type/title/status/detail/instance`; `message` is mirrored for legacy
clients. Write endpoints honor `Idempotency-Key` and replay the cached
response for 24h (keyed by `user × key × method × path`, body-hash
guarded). Heavy list endpoints (jobs, leads, activity) accept an opaque
`?cursor=` alongside the existing `?page=`. All responses through a rate
limiter carry `X-RateLimit-Limit/Remaining/Reset`; 429s also carry
`Retry-After`. The OpenAPI spec at `/openapi.json` documents all of the
above and powers the codegen in `lib/api-client-react` + `lib/api-zod`.

## Conventions

### Role-gating (API)
Every `/api` route handler that touches a tenant resource resolves the
caller's role from `req.auth!.role` and routes through the central
visibility helpers (`assertCanViewJob`, `assertCanViewFile`,
`assertCanViewFolder`, `assertCanViewLead`, `assertCanViewScheduleItem`,
`assertCanViewDailyLog`). These helpers throw `HttpError(403, ...)` when a
non-admin is not assigned to the underlying resource. List endpoints apply
the same intersection in their query (e.g. `jobsVisibleToUser`,
`leadsVisibleToUser`) so paginated lists never leak rows. Admins
short-circuit the check (`role === 'admin' → allowed`). The matching unit
suites are `visibility-regression.test.ts`, `pagination.test.ts`,
`file-annotations.test.ts`, and `http-smoke.test.ts` — any new route or
list query must extend them.

### File uploads (disk → object storage)
File uploads land in the API as multipart, are validated against an
allowlist, and are then handed to `writeUploadedBuffer` which writes to
Replit App Storage (GCS via the sidecar). The on-disk path under
`PRIVATE_OBJECT_DIR/cadstone/uploads/<jobId>/<mediaType>/<filename>` is
preserved as the `files.fileUrl` value for backwards-compat lookups; the
GCS object name is derived from that path. Never write to local disk
directly — the deployed Reserved-VM filesystem is ephemeral. Always pass
`contentType: uploadedFile.mimetype` so the stored object's MIME type is
correct.

## Launch verification — Task #101 (sign-off)

Snapshot of pre-launch state:

- `pnpm exec tsc --noEmit` — clean across all packages.
- `pnpm --filter @workspace/api-server test` — 116 / 116 pass
  (suites: 0, fail: 0, skipped: 0). Includes visibility-regression,
  pagination, file-annotations, and http-smoke.
- `pnpm --filter @workspace/cadstone test` — 58 / 58 pass
  (suites: 9, fail: 0, skipped: 0). Covers `RoleGate`,
  `pdf-annotation-editor`, `pdf-annotation-geometry`, `api-errors`
  classifier, and `role-access`.
- End-to-end browser pass via the testing skill (Chromium / Playwright
  driver, single-project run against the live dev workflows). Two
  sequential runs were used because the second one had to be re-scoped
  after finding both live `*@cadstone.works` accounts are admins: a
  22-step admin run (steps 1–22 passed) plus a 12-step temp-worker
  friendly-403 run (steps 1–12 passed). Areas exercised:
    1. Admin login (`cesar@cadstone.works`)
    2. Dashboard (4 stat cards + activity feed)
    3. Jobs list, search & pagination
    4. Create job (unique title, `nanoid` suffix)
    5. Documents tab — folder + file upload
    6. Schedule view + personal todo / schedule item
    7. Activity feed entry for the run's actions
    8. Wrong-role friendly 403 — exercised with a temporary
       `crew_member` user (`e2e-worker-temp@cadstone.test`) directly
       inserted in Supabase and deleted right after; the SPA renders an
       inline "Access denied" state, the worker's `/jobs` list does not
       leak the admin-created probe job, and the worker dashboard
       renders without crashing.
- `pnpm audit --prod` — 1 LOW: `@tootallnate/once <3.0.1` reached
  transitively via `@google-cloud/storage > teeny-request > http-proxy-agent`.
  Not directly reachable from app code; deferred (see below).
- All 3 workflows boot: `artifacts/api-server: API Server`,
  `artifacts/cadstone: web`, `artifacts/mockup-sandbox: Component Preview Server`.

### Deferred items
- `@tootallnate/once` LOW transitive vuln — pinned upstream in
  `@google-cloud/storage`. Re-evaluate when GCS publishes a patched release.
- No self-serve password reset / forgot-password flow — admin manages
  passwords directly. See "Auth & password management" above.
- The dev API server reads from Supabase prod-pooler (see "Important —
  DB selection" above). Prefer running ad-hoc scripts or new test files
  with `delete process.env.SUPABASE_DATABASE_URL` to avoid burning the
  15-connection pooler cap.
- File-download token replay store and rate-limit counters live in
  process memory — the deploy must stay on a Reserved VM (single
  instance). See "Deployment target — Reserved VM, not autoscale".
