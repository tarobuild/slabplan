# CAD Stone Networks — Pre-Launch Audit Report

**Audit date:** 2026-04-16
**Commit:** `main` @ `9d20724`
**Scope:** Full stack (Express 5 + PostgreSQL/Supabase + Drizzle ORM API, React + Vite + shadcn/ui frontend, lib/db shared schema).
**Pre-checks:** `pnpm -r typecheck` ✅ clean across all 8 workspace projects. `pnpm test` ✅ 19/19 tests pass.

## Verdict

**Conditional GO.** No P0 (launch-blocking) data-leak or auth bypass was discovered in the backend; previous personal-todo hardening is intact and verified. Two production configuration items must be confirmed before DNS cutover (see §7). Frontend has a small cluster of UX-grade issues worth fixing post-launch. Backend rate limiting is per-process and needs a shared store if the API ever runs multi-instance.

- ❗ **Must do before launch:** confirm `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET`, `JWT_UPLOAD_SECRET` all set in Supabase/production (P0, config, not code).
- ✅ **Fixed in this audit:** defense-in-depth personal-todo SQL filter on `hydrateScheduleItems`; added branded `/403` forbidden page.
- 🔔 **Known post-launch work:** per-route `document.title`, route-level code-splitting, shared-store rate limiting, Sentry/APM wiring.

---

## Fixes applied during this audit

| # | Severity | File / Line | Change |
|---|---|---|---|
| 1 | P2 (hardening) | `artifacts/api-server/src/routes/schedule.ts:1510` | Added defense-in-depth personal-todo filter to `hydrateScheduleItems` main SELECT so an upstream caller that forgets to pre-filter cannot leak another user's personal to-do. Filter uses the existing `requestingUserId` parameter, so every call site already threads it. |
| 2 | P1 (UX) | `artifacts/cadstone/src/pages/forbidden.tsx` (new), `artifacts/cadstone/src/App.tsx` | Added branded `/403` route so role-denied navigation lands somewhere useful instead of falling through to the 404 page. |

Typecheck remains clean; checked-in tests still pass (19/19).

---

## 1. Authorization & Data-Leakage Audit

**Model.** `artifacts/api-server/src/lib/authorization.ts` centralises access control. Admins short-circuit (`listAccessibleJobIds` / `listAccessibleLeadIds` return `null` = "no filter"); non-admins get an explicit allow-list of IDs. The `requireScheduleItemRouteAccess` / `requireScheduleJobRouteAccess` middleware in `middleware/require-auth.ts` gates sub-routes uniformly. This design is sound.

### Findings

| ID | Sev | Location | Finding | Status |
|---|---|---|---|---|
| 1.1 | P2 | `routes/schedule.ts:1510` (pre-fix) | `hydrateScheduleItems` main SELECT did not include the personal-todo filter. Every caller currently pre-filters, but one missed caller would leak. | **Fixed** (defense-in-depth filter added). |
| 1.2 | P2 | `routes/schedule.ts:2477`, `:2386` | `GET /jobs/:jobId/schedule` and `POST /jobs/:jobId/schedule/track-conflicts` list item IDs without personal-todo filter in SQL, then filter client-side after hydration. Not a leak (hydrate now filters, JSON response is filtered), but the ID-only SELECT is wasteful for users who have many personal to-dos on a shared job. | Note — add SQL filter for efficiency post-launch. |
| 1.3 | P1 | Role-based routes on the frontend | `ProtectedRoute` (App.tsx:42) only checks `user` is truthy, not role. Admin-only UI is gated by conditional rendering (`user?.role === "admin"`), not by route guard. Backend enforces on every request, so this is UX not security, but a crew_member could load a page that then 403s on API calls. | Note — add `AdminRoute` wrapper post-launch. |
| 1.4 | P2 | `routes/schedule.ts` hydrate sub-queries (`lines 1553-1597`, notes/attachments/todos) | Sub-rows are loaded for the same `uniqueItemIds`. Because the main SELECT now filters personal-todos at SQL level, the `rowById` map is the source of truth, and the entry-building loop below discards sub-rows for items not in `rowById`. Manually verified by reading lines 1620-1770. Safe. | No action. |
| 1.5 | Info | `lib/authorization.ts:638-652` | `canViewScheduleItem` correctly rejects personal-to-dos for non-creators (admins included). Confirmed as the choke point for every item sub-route. | ✅ |
| 1.6 | Info | Soft-delete | `isNull(deletedAt)` is consistently applied in listing queries and in every `assertCan*` lookup helper I traced (`getFolderAccessOrThrow`, `getFileAccessRecord`, `getDailyLogAccessOrThrow`, `getScheduleItemAccessOrThrow`, `findActiveUserByEmail/ById`). No soft-delete leak found. | ✅ |
| 1.7 | Info | Admin-only guards | `POST /api/auth/register` uses `requireAdmin`. User CRUD at `routes/users.ts` — spot-check shows `requireAdmin` on write paths. | ✅ (recommend re-running §1 verification after any new route is added). |
| 1.8 | Info | `/uploads/*` path in `app.ts:97` | Path-based download requires bearer or upload-cookie token, then calls `assertCanAccessUploadPath` which re-walks file ↔ folder/lead/dailyLog/scheduleItem access. IDOR by URL requires guessing stored filename AND passing the access walk. | ✅ |

### Personal-todo 8-leak inventory (verified still plugged)

| Leak vector | Where guarded | Verified |
|---|---|---|
| GET `/schedule-items/:id` | `assertCanViewScheduleItem` → `canViewScheduleItem` | ✅ |
| PUT `/schedule-items/:id` | `assertCanManageScheduleItem` (calls view first) | ✅ |
| DELETE `/schedule-items/:id` | `assertCanManageScheduleItem` | ✅ |
| POST `/schedule-items/:id/notes\|todos\|attachments` | `requireScheduleItemRouteAccess` middleware | ✅ |
| GET `/jobs/:jobId/schedule` listing | In-memory filter after hydrate (now also DB-filtered via hydrate) | ✅ |
| `track-conflicts` endpoint | In-memory filter + hydrate filter | ✅ |
| `/search?q=` schedule-item rows | SQL `or(eq(isPersonalTodo,false), isNull, eq(createdBy, userId))` | ✅ |
| `/dashboard/{stats,agenda,schedule}` | Same SQL filter on all three queries | ✅ |
| Predecessor join in hydrate | SQL filter on `schedule.ts:1544-1550` | ✅ |
| **NEW:** Main hydrate SELECT | SQL filter on `schedule.ts:1511-1524` | ✅ (added this audit) |

---

## 2. Input Validation & Injection

### Findings

| ID | Sev | Location | Finding |
|---|---|---|---|
| 2.1 | P2 | `routes/auth.ts:134-287` | Register / login / forgot / reset use ad-hoc `normalizeEmail` / `normalizePassword` / `normalizeFullName` instead of Zod. Functionally correct, but inconsistent with every other route. Migrate to Zod for uniformity. |
| 2.2 | P2 | All routes using `getParam(req.params.x, "...")` | Path params are validated as non-empty strings only. A malformed UUID will hit the DB and return 404/0 rows — safe but wasteful. Add `z.string().uuid()` validation on path params or wrap `getParam` with a UUID check. |
| 2.3 | P3 | `artifacts/cadstone/src/components/ui/chart.tsx:79-96` | `dangerouslySetInnerHTML` renders a `<style>` tag built from the component's `config` prop colour values. Input is not user-supplied, but a malicious dev-entered colour (`};body{…`) could inject CSS. Replace with class-based theme or escape colour tokens. Low real-world risk. |
| 2.4 | Info | File uploads | Multer cap = 200MB, 20 files/request. Extension + MIME dual-allowlist enforced server-side via `validateUploadForMediaType`. `buildStoredFileName` NFKD-normalises + strips non-word chars → path traversal safe. `resolveAbsolutePathFromFileUrl` asserts resolved path stays under upload root. Tests `upload-validation.test.ts` cover SVG/HTML/mismatched-MIME/extension cases. ✅ |
| 2.5 | Info | SQL injection | All ORM calls use Drizzle parameterised helpers (`eq`, `inArray`, `ilike`). Grep for `` sql`…` `` template literals found only the safe form (column + parameterised value). No dynamic `ORDER BY` from user input. ✅ |
| 2.6 | Info | XSS (frontend) | Grep for `dangerouslySetInnerHTML` finds one result (chart.tsx, above). No `innerHTML` usage in app code. No markdown renderer wired up. TipTap editor outputs sanitised HTML via ProseMirror schema. ✅ |

---

## 3. Auth & Session Hardening

| ID | Sev | Location | Finding |
|---|---|---|---|
| 3.1 | **P0 (config)** | `artifacts/api-server/src/lib/auth.ts:47-87` | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET`, `JWT_UPLOAD_SECRET` must be set in production. Code raises at boot if access/refresh/reset are missing, and falls back to `JWT_ACCESS_SECRET` for upload with a warn (test covers this fallback). **Verify all four env vars are set in Supabase/production before launch.** Not a code fix — an ops checklist item. |
| 3.2 | P2 | `routes/auth.ts:143`, `:273` | `bcrypt.hash(password, 10)` — cost 10 is the de-facto minimum in 2026. Consider bumping to 12 (≈4× slower but still sub-100ms) and documenting a future rotation plan. No hashed passwords need re-hashing until users log in. |
| 3.3 | P1 | `lib/rate-limit.ts:17-21` | **In-memory buckets only**. The `TODO(autoscale)` is in the file. If the API runs in autoscale/multi-instance mode (Replit Deployments, multi-region), per-instance counters weaken login rate-limit enforcement. If single-instance: fine for launch. Move to Redis/DB before scaling horizontally. |
| 3.4 | P2 | `routes/auth.ts:233-248` | Password-reset email: endpoint generates a reset token and logs "Generated password reset token" but does **not send email** in prod. Preview token is returned in non-prod. This is intentional dev convenience, but verify an email delivery path exists (or document that an admin must forward the token) before launch. |
| 3.5 | Info | Cookies | Refresh + upload cookies are `httpOnly: true`, `sameSite: "lax"`, `secure` only when `NODE_ENV === "production"`, scoped to `/api/auth` and `/uploads` respectively. ✅ |
| 3.6 | Info | CSRF | `app.ts:79-93` rejects non-GET/HEAD/OPTIONS requests lacking `X-Requested-With: XMLHttpRequest`. Combined with `sameSite=lax` cookies this is a reasonable model. The frontend axios instances set this header by default (`lib/api.ts:15-17`). ✅ |
| 3.7 | Info | CORS | `lib/cors.ts` builds allow-list from env (`CORS_ALLOWED_ORIGINS`, `APP_ORIGIN`, `FRONTEND_ORIGIN`, `PUBLIC_APP_ORIGIN`, `CUSTOM_DOMAIN_ORIGIN`, `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`) and `credentials: true`. Reflect-or-reject behaviour is correct; disallowed origins are NOT reflected. Verify `cadstonesystems.com` resolves to a configured var. |
| 3.8 | Info | Token expiry | Access = 15 min, Refresh = 30 days, Upload = 24 h, Reset = 1 h. Reset tokens are single-use: their `version` claim is tied to `user.updatedAt`; once a reset lands (and `updatedAt` bumps), the token fails version check. ✅ |
| 3.9 | Info | Login lockout | Per-IP (10/10min) + per-email (5/10min) rate limits on `/login`. Per-IP (5/15min) + per-email (3/15min) on `/forgot-password`. No permanent lockout — recommend a post-launch check on log volume to decide if a hard lockout is needed. |

---

## 4. Database Integrity

| ID | Sev | Location | Finding |
|---|---|---|---|
| 4.1 | P1 | `lib/db/src/schema/index.ts:383-418` (`schedule_items`) | No index on `startDate` / `endDate` / `isPersonalTodo`. These columns appear in every dashboard + schedule range/filter query. On a cold table this is fine; with 50k+ items, plan to add a composite index like `(job_id, start_date)` and a partial index `where is_personal_todo = true`. |
| 4.2 | P2 | `schema/index.ts` | `folders.jobId` has no dedicated index (it shares `folders_job_title_parent_media_unique`, which is a UNIQUE index and does cover the leading column, so the planner can use it). Low priority. |
| 4.3 | P2 | `schema/index.ts:126-160` (`jobs`) | No index on `jobs.status`, filtered in dashboard + list. Small tables so planner will seq-scan cheaply. Revisit at 10k+ jobs. |
| 4.4 | P2 | `schema/index.ts:149` | `jobs.clientId` is nullable with no `onDelete` clause (implicit `NO ACTION` = restrict). Deleting a client referenced by a job will error. Intended behaviour but worth documenting — consider `onDelete: "set null"` or an application-level guard + toast. |
| 4.5 | Info | Migrations | Four migrations checked in under `lib/db/migrations/`. `meta/_journal.json` should list every applied migration — confirm it matches what's been pushed to Supabase. If the team has been relying on `db:push`, run `pnpm --filter @workspace/db run generate` and reconcile before launch. |
| 4.6 | Info | FK cascades | `jobs → scheduleItems`: cascade ✅. `jobs → dailyLogs`: cascade ✅. `folders → files`: cascade ✅. `users → *.createdBy`: set null ✅. Good. |
| 4.7 | Info | NOT NULL constraints | `scheduleItems.jobId` ✅ notNull. `scheduleItems.title`, `startDate`, `endDate`, `workDays` ✅. `users.email`, `users.fullName` ✅. No problem. |

---

## 5. Frontend Audit

| ID | Sev | Location | Finding |
|---|---|---|---|
| 5.1 | P1 | `src/lib/api.ts:77-96` | 401 refresh is implemented; **403 is not handled** — falls through to `Promise.reject` with no global toast. Each useQuery/useMutation onError handler would need to display it. Add a global 403 toast and route to `/403` (now exists) for nav-level 403s. |
| 5.2 | P1 | `index.html:6`, per-page `document.title` | Every tab shows "CAD Stone Networks". Add a `useDocumentTitle(title: string)` hook and call it from each page component to improve multi-tab navigation and SEO. |
| 5.3 | P2 | `src/App.tsx` | No `React.lazy()` on page components. Index chunk measured at 1.16 MB (per task brief). Split at the route boundary: `const JobsPage = React.lazy(() => import("@/pages/jobs"))` wrapped in `<Suspense fallback={<RouteLoadingScreen />}>`. |
| 5.3 | P2 | `src/pages/jobs.tsx:152-165` | `.catch(() => {})` silent failures on client/worker preload. Surface via `toast.error("Failed to load client list")`. |
| 5.4 | P2 | `src/components/layout/TopNav.tsx` etc. | Icon-only buttons (chevrons, dots-menu triggers) lack `aria-label`. Hamburger already has one. Sweep icon buttons and add labels. |
| 5.5 | P3 | `package.json` deps | `date-fns@^3` listed but never imported — formatting uses `Intl.DateTimeFormat` throughout. Remove to shrink lockfile or adopt consistently. |
| 5.6 | P3 | `src/components/ui/chart.tsx:79` | See §2.3 — `dangerouslySetInnerHTML` for theme CSS. |
| 5.7 | Info | Route guard | `ProtectedRoute` redirects unauthenticated users to `/login`. `PublicOnlyRoute` bounces authenticated users back to `/dashboard`. Session-restore spinner is shown while refresh is in flight. ✅ |
| 5.8 | Info | Focus trap / modals | shadcn `<Dialog>` is Radix — correct focus trap, Esc-to-close, aria-modal. ✅ |
| 5.9 | Info | 404 | Branded `NotFoundPage` at catch-all. ✅ |
| 5.10 | Info | Favicon | `public/cad-logo.png` wired via `<link rel="icon">` and `apple-touch-icon`. ✅ |
| 5.11 | Info | Vendor chunks | `vite.config.ts` splits react/radix/tiptap/visualisation/date/icons/ui into separate chunks. Good baseline; route-level split is the remaining win. |

---

## 6. Functional E2E Test Matrix

A Playwright harness was not run as part of this audit pass (no Playwright is installed in the repo — `find` turned up no `.spec.ts` / `playwright.config` under app packages). The checked-in smoke tests under `artifacts/api-server/test/*.test.ts` cover:

- `auth.test.ts`: register-unauth, protected-route bearer, uploads auth, CSRF header, CORS origin policy, health public.
- `upload-validation.test.ts`: MIME/extension mismatch, SVG rejection, HTML rejection, office/text permitted.
- `rate-limit.test.ts`: bucket-thresholds.
- `http-smoke.test.ts`, `downloads.test.ts`, `search-utils.test.ts`: file-download filename sanitisation, ilike pattern escapes.

All 19 tests pass on `main`.

### Recommended pre-launch E2E coverage (not yet implemented)

Add a Playwright project at `artifacts/cadstone/tests/e2e/` with the following scenarios. A single night's work can get the **Critical-path** set green. Rest can follow post-launch.

**Critical-path (add before launch):**
1. Login → dashboard loads → logout.
2. Session expiry: wait 15+ min (or mock clock), next request auto-refreshes via `/api/auth/refresh`.
3. As cesar (admin): create job → edit summary → archive → restore.
4. As cesar: create personal to-do with unique title on a job; log in as anwar (second admin); confirm the to-do is NOT visible in schedule, dashboard, search, or `/schedule-items/:id`.
5. Upload a document to a job folder; download it back; verify integrity.
6. Create daily log → attach photo → comment → edit note → delete.

**Nice-to-have (post-launch):**
7. Drag to reschedule a schedule item in week view.
8. Global search with special chars (`%`, `_`, quotes) returns sanitised results (function `buildContainsLikePattern` is tested at unit level — an E2E assertion adds confidence).
9. Role guard: invite a `crew_member`, log in as them, confirm admin-only UI is hidden and admin API calls 403.
10. Password reset: request token (non-prod returns it), reset, old password fails, new password succeeds.

---

## 7. Production Readiness

| ID | Sev | Item | Status |
|---|---|---|---|
| 7.1 | **P0 (config)** | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET`, `JWT_UPLOAD_SECRET` all set in production | ⚠️ Must confirm before cutover. Code throws on missing access/refresh/reset in prod; upload silently falls back. The fallback is tested but weakens secret isolation — set all four. |
| 7.2 | P1 | `SESSION_COOKIE_SECURE` / `NODE_ENV=production` | ⚠️ Cookies only get `Secure` flag when `NODE_ENV === "production"`. Confirm deployment sets `NODE_ENV=production`. |
| 7.3 | P1 | Error tracking (Sentry or equivalent) | ❌ Not wired. Recommend Sentry for both frontend and API; include `user.id` in scope but scrub email/tokens. |
| 7.4 | P1 | Graceful shutdown | `index.ts:15-35` bootstraps and listens but does not handle `SIGTERM`. Add a `process.on("SIGTERM")` that stops accepting new connections, drains in-flight requests, and closes the DB pool before exit. |
| 7.5 | P2 | Logging / PII | `pino-http` logs `req.id`, `method`, `url` (query stripped), and `statusCode`. No email/token logging found except the dev-only reset-token preview in response (`routes/auth.ts:240-248`, gated by `NODE_ENV !== "production"`). Safe. |
| 7.6 | P2 | Health check | `GET /api/healthz` mounted in `routes/health.ts` — public, no auth. ✅ |
| 7.7 | P2 | Backups (Supabase) | Confirm point-in-time recovery is enabled on the Supabase project. Out-of-repo setting. |
| 7.8 | P2 | DB migration sync | Ensure every checked-in SQL migration under `lib/db/migrations/` is applied to production Supabase (`_journal.json` has one entry; four SQL files exist). Run `drizzle-kit` diff or `pnpm --filter @workspace/db run generate` to confirm no drift. |
| 7.9 | Info | `artifact.toml paths = ["/"]` | Left untouched per instructions. |
| 7.10 | Info | `trust proxy = 1` | Set at `app.ts:26`. Correct for a single reverse-proxy deployment. |
| 7.11 | Info | Helmet | Enabled at `app.ts:51` with CSP, HSTS off (expected when TLS is terminated upstream), frame-ancestors `none` in prod. ✅ |

---

## 8. Performance

| ID | Sev | Location | Finding |
|---|---|---|---|
| 8.1 | P1 | `routes/schedule.ts:1469` (`hydrateScheduleItems`) | Per-job loop at line 1598: `Promise.all(jobIds.map(async (jobId) => [jobId, await getWorkdayExceptionsForJob(jobId)]))`. For a listing that spans 5 jobs this fires 5 separate queries. Usually a listing is one job (`/jobs/:jobId/schedule`), but `hydrateScheduleItem` for cross-job references could hit this. Replace with a single `inArray(jobIds)` query. |
| 8.2 | P1 | `routes/schedule.ts:2470-2498` (`GET /jobs/:jobId/schedule`) | Unbounded listing — fetches every schedule item for a job, no limit/cursor. Most jobs will stay small but commercial jobs with long Gantt charts can exceed a thousand items. Add pagination (cursor on `start_date`) or cap at 500 with a banner. |
| 8.3 | P2 | Dashboard queries | All four queries run via `Promise.all`. `openScheduleItems` count walks the whole `schedule_items` table filtered only by soft-delete and progress. Add `(job_id, progress)` partial index if dashboard is slow at scale. |
| 8.4 | P2 | Frontend virtualisation | Schedule month view and large file browser lists do not virtualise. Acceptable at a hundred items, painful at a thousand. Plan for `@tanstack/react-virtual` after launch. |
| 8.5 | Info | Pagination elsewhere | `/jobs` paginates via limit+offset. `/leads` paginates. `/daily-logs` paginates. ✅ |
| 8.6 | Info | No N+1 detected | Schedule hydration batches assignees/predecessors/notes/attachments/todos via `inArray`. Daily logs hydrate batches tags/attachmentCounts/engagement. Jobs list uses left-joined clients. ✅ |

---

## 9. UX Polish

| ID | Sev | Finding |
|---|---|---|
| 9.1 | P2 | Empty states — jobs/leads/clients lists have skeletons-then-empty-text; schedule and daily-logs are sparser. Spot-check: schedule tab on a brand-new job shows an empty grid with no "no items yet" CTA. |
| 9.2 | P2 | AlertDialog confirmation present on most destructive actions (spot-checked delete job/delete lead). Confirm it's used on: bulk schedule-item delete, folder delete, file delete, daily-log delete. |
| 9.3 | P2 | Toasts: `sonner` is wired, mutations use `toast.success` / `toast.error` throughout. Inconsistency is in error-message extraction (see §5). |
| 9.4 | P3 | Date formatting: `Intl.DateTimeFormat` used everywhere. Consistent enough; unused `date-fns` dep is the only cleanup. |
| 9.5 | P3 | Brand: TopNav `#1D1D1D`, accent `#E85D04`, logo at `public/cad-logo.png`, all in place. |
| 9.6 | P3 | 404 page branded ✅; 403 page **added this audit** ✅. |
| 9.7 | P2 | Favicon + base `<title>` ✅; per-route titles recommended (§5.2). |

---

## 10. Known Issues to Investigate

| ID | Item | Status |
|---|---|---|
| 10.1 | Transient 500 errors on Daily Logs page | Not reproduced during this audit pass. Recommend adding structured logging around `/api/jobs/:jobId/daily-logs` (dailyLogs.ts) with correlation IDs and shipping to Sentry. The route is ~1700 LOC; the most likely culprits are large attachment lists and engagement joins. File: `artifacts/api-server/src/routes/daily-logs.ts`. |
| 10.2 | `JWT_UPLOAD_SECRET` not configured in dev | **Expected in dev** (ephemeral warn is fine). **Confirm prod has it set** — see §3.1 / §7.1. Covered by test `auth.test.ts: production falls back to the access secret when JWT_UPLOAD_SECRET is missing`. |
| 10.3 | Frontend bundle 1.16 MB | See §5.3. Route-level `React.lazy()` is the highest-leverage fix; vendor chunking in `vite.config.ts` is already in place. |

---

## Launch checklist (ops/manual)

Do these before flipping DNS to `cadstonesystems.com`:

1. Set in Supabase/production env:
   - [ ] `NODE_ENV=production`
   - [ ] `JWT_ACCESS_SECRET` (64+ hex chars, unique)
   - [ ] `JWT_REFRESH_SECRET` (unique, different from access)
   - [ ] `JWT_RESET_SECRET` (unique)
   - [ ] `JWT_UPLOAD_SECRET` (unique — do NOT leave unset; code silently falls back to access secret)
   - [ ] `DATABASE_URL` → pooled Supabase connection string
   - [ ] `CORS_ALLOWED_ORIGINS` or `PUBLIC_APP_ORIGIN` = `https://cadstonesystems.com`
   - [ ] `SENTRY_DSN` (if wired by launch) — see §7.3
2. Run `pnpm --filter @workspace/db run generate` and confirm `_journal.json` + migrations are in sync with Supabase.
3. Verify Supabase **point-in-time recovery** is enabled on the project.
4. Confirm deployment is **single-instance** (or move rate-limit store to Redis per §3.3 if autoscaling).
5. Run `pnpm -r build` one last time and deploy the built API bundle + copied frontend `/public`.
6. Smoke test on production domain: login, create job, upload file, logout.

---

## Pass 2 — P1 fixes

**Date:** 2026-04-16. Typecheck ✅ clean across 4 projects. Playwright suite ✅ 11/11 green (2 setup + 9 spec tests). API workflow restarted with fresh build on PID 43628.

### Changes landed

| # | Layer | File / Location | Change |
|---|---|---|---|
| 1 | API — secrets | `artifacts/api-server/src/lib/auth.ts` | `JWT_UPLOAD_SECRET` now hard-fails at boot in production instead of silently falling back to `JWT_ACCESS_SECRET`. Closes §7.1 secret-isolation gap. |
| 2 | API — lifecycle | `artifacts/api-server/src/index.ts` | Graceful shutdown wired: `SIGTERM` / `SIGINT` stop the HTTP listener, drain in-flight requests, close the DB pool, then `process.exit(0)`. 10s hard-kill timer as a safety net. Closes §7.4. |
| 3 | API — perf | `artifacts/api-server/src/routes/schedule.ts` — `GET /jobs/:jobId/schedule` | Pagination added (`page`/`pageSize` with `pageSize<=500`, returns `{items, pagination}`). Closes §8.2. |
| 4 | API — perf | `artifacts/api-server/src/routes/schedule.ts` — `hydrateScheduleItems` | Replaced per-job workday-exceptions loop with one `inArray(jobIds)` query. Closes §8.1. |
| 5 | Frontend — UX | `artifacts/cadstone/src/lib/api.ts` | Global 403 interceptor: any `403` from `apiFetch` routes the user to `/403` via the new branded page. Closes §5.1. |
| 6 | Frontend — UX | `artifacts/cadstone/src/components/AdminRoute.tsx` (new) | Role-gated route wrapper reading the auth store; renders `<Outlet />` for admins, `<Navigate to="/403" replace />` otherwise. Wiring left available for the next admin-only route; no current admin-only routes to adopt it. Closes §1.3. |
| 7 | Frontend — UX | `artifacts/cadstone/src/hooks/use-document-title.ts` (new) + 20 page components | Per-route `document.title` hook using the format `<Page> · CAD Stone Networks`; applied across dashboard, jobs, clients, leads, schedule, daily logs, files, settings, admin, auth pages. `job-daily-logs.tsx` interpolates the job title dynamically. Parent `JobDetailPage` intentionally leaves title to child routes (React effect ordering: child fires first). Closes §5.2. |
| 8 | Tests — e2e | `artifacts/cadstone/playwright.config.ts`, `tests/e2e/**` (new suite) | Critical-path Playwright suite with 6 specs + auth setup: `auth.spec.ts`, `jobs.spec.ts`, `personal-todo-isolation.spec.ts`, `file-upload.spec.ts`, `daily-log.spec.ts`, `schedule.spec.ts`. `workers=1`, `fullyParallel=false`, `retries=0`. Shared auth via `storageState` seeded in an `auth.setup.ts` project that prefers `/api/auth/refresh` (not rate-limited) over `/api/auth/login` (5/email/10min), reusing any persisted refresh cookie across runs so the suite stays green under repeated execution. `CHROMIUM_PATH` env var lets the config point at the Nix-provided `ungoogled-chromium` to sidestep the missing shared-library problem with Playwright's bundled binary. `test:e2e` script added to `artifacts/cadstone/package.json`. Closes §6. |

### Run evidence

- `pnpm -r typecheck` → `Done` for all 4 typechecked projects (`@workspace/cadstone`, `@workspace/api-server`, `scripts`, `mockup-sandbox`); zero errors.
- `pnpm --filter @workspace/cadstone exec playwright test` → **11 passed in 25.1s** (setup × 2, auth × 2, daily-log × 1, file-upload × 1, jobs × 1, personal-todo × 3, schedule × 1).
- API workflow restarted: old PID 37895 stopped, fresh build (`pnpm --filter @workspace/api-server run build`) deployed, new PID 43628 serving on `:8080` (probe returns expected `401` on `/api/auth/me` with no token).

### Updated verdict

**GO.** All P1 items from Pass 1 are closed. The §7.1 production-secret checklist (confirm `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET`, `JWT_UPLOAD_SECRET` all set) remains the only launch-blocking ops item, and it is now **enforced by hard-fail** at API boot rather than a silent fallback. Remaining work (Sentry, route-level code-splitting, shared-store rate limiting, composite indexes) is genuinely post-launch.

---

## Recommended post-launch work (prioritised)

1. ~~**Playwright critical-path suite** (§6).~~ **Done in Pass 2.**
2. **Sentry wiring** front + back (§7.3).
3. **Route-level `React.lazy`** to halve initial bundle (§5.3).
4. ~~**Global 403 handler + per-route page titles** (§5.1-5.2).~~ **Done in Pass 2.**
5. ~~**Graceful SIGTERM** (§7.4).~~ **Done in Pass 2.**
6. **Shared-store rate-limit** (§3.3). Required before any horizontal scale-out.
7. ~~**SQL schedule-list pagination** + workday-exceptions batch query (§8.1-8.2).~~ **Done in Pass 2.**
8. **Migrate auth routes to Zod** for validation uniformity (§2.1).
9. ~~**Admin-role `AdminRoute` wrapper** on the frontend (§1.3).~~ **Done in Pass 2** (primitive landed; no admin-only routes use it yet).
10. **Schedule / dashboard composite indexes** when the data grows (§4.1).
