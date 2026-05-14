# CAD Stone Networks — Launch Readiness Checklist

This document is the **single source of truth** for what must be green before
any production cutover (initial launch + every future deploy that touches
auth, schema, billing, or scoping). It pairs with `docs/restore-drill.md`
(quarterly DB restore) and `replit.md` (canonical env-var list).

Every item below is a checkbox + the exact command/probe that produced the
result. Anyone — not just the original implementer — should be able to
re-run this end-to-end.

> **About the 2026-05-06 column.** This is the **readiness-audit run**
> captured by Task #349. It is intentionally a *snapshot of the current
> state*, not a launch approval — several items are red and are tracked as
> follow-up tasks. The cutover go/no-go (§7) only fires once every box is
> green on the actual launch commit.

---

## 1. Automated gates — clean checkout, single workspace

Run from the repo root after `pnpm install --frozen-lockfile`.

| # | Gate | Command | 2026-05-06 result |
|---|---|---|---|
| 1.1 | Typecheck (libs + artifacts + scripts) | `pnpm typecheck` | ✅ pass — `tsc --build` + per-artifact `tsc -p tsconfig.json --noEmit` clean |
| 1.2 | OpenAPI codegen drift | `pnpm check-api-codegen` | ✅ pass — `OK: generated API clients are up to date with lib/api-spec/openapi.yaml.` |
| 1.3 | Eager-bundle budget (web) | `pnpm --filter @workspace/cadstone run check-eager-bundle` | ✅ pass — only Sentry empty-chunk warnings (`vendor-sentry-internal-feedback`, `…-replay`, `…-replay-canvas`), which are expected and harmless |
| 1.4 | Unused-code sweep | `pnpm knip` | ✅ pass — zero output (no unused files / exports / types / deps) |

`scripts/post-merge.sh` runs the schema-migration checks
(`pnpm --filter db check-migrations-journal && pnpm --filter db
migrate`) on every merge, but the four gates above are NOT wired into
that script today — they live in CI / the workspace validation system
and must be re-run from a clean checkout as part of every cutover.
Treat the table above as the gate; do not assume post-merge ran them.

---

## 2. Test suites

The Playwright e2e and api-server unit suites both depend on a real Postgres
17 cluster and seeded fixtures. Two supported entry points:

- **CI (canonical)** — `.github/workflows/e2e.yml` runs the full Playwright
  suite inside `mcr.microsoft.com/playwright:v1.59.1-jammy` against a
  Postgres 17 service container. Required repo secrets:
  `SEED_ADMIN_CESAR_PASSWORD`, `SEED_ADMIN_ANWAR_PASSWORD`,
  `SEED_WORKER_FIXTURE_PASSWORD`, `SEED_PM_FIXTURE_PASSWORD`,
  `E2E_JWT_SECRET`. **Cutover gate:** the CI run on the launch commit
  must be green.
- **Local** — `scripts/run-e2e-local.sh` (recreates the test DB, seeds users
  + the baseline E2E client/job, boots api-server + Vite, runs the suite).
  All four `SEED_*_PASSWORD` env vars + `JWT_SECRET` are required.

| # | Suite | Command | 2026-05-06 result |
|---|---|---|---|
| 2.1 | api-server unit + integration tests (58 specs) | `pnpm --filter @workspace/api-server run test` | ⚠️ deferred to CI — the workspace container kills background `pg_ctl` between commands so `ensure-test-db` can't connect; the same suite passes on every CI run merged into main |
| 2.2 | Playwright e2e (`artifacts/cadstone/tests/e2e/`) | `scripts/run-e2e-local.sh` *or* the GitHub Actions workflow | ⚠️ deferred to CI for the same reason; **must be green on the launch commit before cutover** |

---

## 3. Manual smoke test — role by role

These walk the production app in a real browser. **Caveat for the 2026-05-06
run:** the production database has only the two founding admin accounts and
zero clients/jobs/leads (verified by §4 of `docs/restore-drill.md`). The
admin happy path can be exercised end-to-end, but the PM at-risk drill-downs
and the crew "My Day" flow have nothing to populate them. Re-run §3.2 / §3.3
on the first quarterly verification *after* the first real client is
onboarded, and update the boxes below.

### 3.1 — Admin (Cesar)

- [ ] Sign in at `https://cadstonesystems.com` → lands on Admin Home (`/`).
- [ ] Top nav shows: Home · Clients · Schedule · Daily Logs · Sales · Reports · Resources.
- [ ] Create a lead from `/leads/new` → appears in Sales.
- [ ] Convert that lead to a job → status flips, job appears in `/jobs`.
- [ ] File a daily log against the new job → shows in `/daily-logs`.
- [ ] Create a schedule item against the new job → appears in `/schedule`; mark complete; verify the at-risk count on Home goes down.
- [ ] Create a change order on the job → appears under the job's CO tab.
- [ ] Mark an invoice paid → A/R Aging report (`/reports/ar-aging`) reflects the change.

### 3.2 — Project Manager (deferred until real data exists)

- [ ] Sign in as a PM user → lands on PM Home (`PMHomePage`).
- [ ] Top nav shows the same admin set **except** Reports (Reports is admin-only).
- [ ] Open each at-risk drill-down on Home (overdue schedule items, pending COs, past-due invoices, missing daily logs).
- [ ] Drill into one of each → counts on the drill-down page match the Home tile.

### 3.3 — Crew member (deferred until real data exists)

- [ ] Sign in as a crew user → lands on `MyDayPage` (`/`).
- [ ] Top nav shows: Home · My Jobs · Resources (no Reports, no admin links).
- [ ] File a daily log against an assigned job, attaching ≥ 1 photo.
- [ ] After full page reload, the photo is still attached and renders inline in "My Day".
- [ ] Confirm there is no path to `/clients`, `/leads`, `/reports`, `/schedule`, or `/daily-logs` (`/403` on attempted direct nav).

### 3.4 — Mobile responsive (Chrome DevTools, 390 × 844)

Run as the admin once §3.1 is green so there is data to see.

- [ ] `MobileBottomNav` appears (fixed bottom tabs); `TopNav` collapses.
- [ ] Bottom-tab links work for admin (Home / Schedule / Daily Logs / Clients / Resources).
- [ ] Breadcrumbs collapse to the truncated form on narrow viewports.
- [ ] Settings rail collapses to the chip row.
- [ ] Capture screenshots of Home + one drill-down + Settings and link them
      under this section.

---

## 4. Production environment audit

Verified via `viewEnvVars` against the production deployment scope on
2026-05-06.

### 4.1 — Required env vars (must be present in production)

The canonical list is mirrored in `replit.md` ("Run & Operate" → "Env
Vars"). Status reflects what is set on the
`https://cadstone-works-tool.replit.app` deployment today.

| Variable | Required? | Status |
|---|---|---|
| `SUPABASE_DATABASE_URL` | required | ✅ present (global secret) |
| `DATABASE_URL` | required (shadow of Supabase URL for dev/test fallthrough) | ✅ present |
| `JWT_ACCESS_SECRET` | required | ✅ present |
| `JWT_REFRESH_SECRET` | required | ✅ present |
| `JWT_UPLOAD_SECRET` | required | ✅ present |
| `JWT_RESET_SECRET` | required | ✅ present |
| `SESSION_SECRET` | required | ✅ present |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | required (AI assistant) | ✅ present |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | required (AI proxy) | ✅ present |
| `STORAGE_PROVIDER` | required for upload storage | ✅ `supabase` |
| `SUPABASE_URL` | required when `STORAGE_PROVIDER=supabase` | ✅ present |
| `SUPABASE_STORAGE_BUCKET` | required when `STORAGE_PROVIDER=supabase` | ✅ `cadstone-files` |
| `SUPABASE_SERVICE_ROLE_KEY` | required when `STORAGE_PROVIDER=supabase` | ✅ present |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | legacy Replit upload storage / DB backups only | optional when uploads use Supabase |
| `PRIVATE_OBJECT_DIR` | legacy Replit upload storage only | optional when uploads use Supabase |
| `PUBLIC_OBJECT_SEARCH_PATHS` | legacy Replit upload storage only | optional when uploads use Supabase |
| `CORS_ALLOWED_ORIGINS` *or* `APP_ORIGIN` | required (one of them must list the customer-facing origin — `corsOrigin` in `artifacts/api-server/src/lib/cors.ts` reads both, plus several other aliases, into one allow-list) | ✅ satisfied via `CORS_ALLOWED_ORIGINS=https://cadstonesystems.com` (production scope). `APP_ORIGIN` is not separately set — that is fine because the same value is supplied via `CORS_ALLOWED_ORIGINS`. If you ever clear `CORS_ALLOWED_ORIGINS`, you **must** set `APP_ORIGIN` (or one of the documented aliases) instead, or the API will reject every browser request |
| `NODE_ENV` | required | ✅ `production` (production scope) |
| `RESEND_API_KEY` | required (transactional email — invites, password resets, backup alert email transport) | ❌ **MISSING — launch-blocker** |
| `EMAIL_FROM` | required (paired with `RESEND_API_KEY`) | ❌ **MISSING — launch-blocker** |
| `APP_PUBLIC_URL` | required (link generation in transactional email — see `artifacts/api-server/src/routes/users.ts:43`) | ❌ **MISSING — launch-blocker** |
| `SENTRY_DSN_API` | required in production (server boot fails without it — Task #348) | ❌ **MISSING — launch-blocker** |
| `SENTRY_DSN_WEB` | recommended (warning-only if missing) | ❌ missing — Sentry will not capture browser errors |

**Action required before cutover:** add the 5 ❌ entries above. Use
`requestEnvVar` from the env-secrets skill so they are stored as global
secrets (which is how every other secret on this deployment is stored —
production-scoped env vars on Replit are read alongside global secrets).
Once added, re-run §4 and flip the boxes.

### 4.2 — Live production probes

| # | Probe | Command | 2026-05-06 result |
|---|---|---|---|
| 4.2.1 | Health endpoint up | `curl -sS -w '%{http_code}\n' https://cadstone-works-tool.replit.app/api/healthz` | ⚠️ HTTP 200 but body is `{"status":"ok"}` — **the deep readiness payload is missing the `db`/`storage`/`durationMs`/`errors` fields defined in `HealthGetHealthzResponse`**. Two possibilities: (a) the deployed bundle predates the deep-readiness change in `artifacts/api-server/src/routes/health.ts`, or (b) the Zod parser is silently stripping unknown keys. Either way, the cutover gate requires a redeploy of the latest commit and re-probing — the response **must** include `"db":true,"storage":true` before launch |
| 4.2.2 | Liveness endpoint unauthenticated | `curl -sS -w '%{http_code}\n' https://cadstone-works-tool.replit.app/api/livez` | ❌ HTTP 401 `"Authentication required."` — **a real production discrepancy**. Per source (`artifacts/api-server/src/routes/index.ts:33` mounts `healthRouter` before `requireAuth`), `/livez` is intended as an unauthenticated shallow liveness probe and should return 200. Most likely cause: the deployed bundle is an older revision where the route mount order or the route itself differs. Action: redeploy from current `main`, re-probe, and only proceed when this returns 200 with body `{"status":"ok"}` |
| 4.2.3 | CORS allowlist contains real customer domain | `viewEnvVars` against `production` | ✅ `CORS_ALLOWED_ORIGINS=https://cadstonesystems.com` |
| 4.2.4 | Login rate limiter throttles | 22× `POST /api/auth/login` with `X-Requested-With: XMLHttpRequest`, bad credentials, same IP | ✅ requests 1–5 → `401`, request 6 onward → `429` (per-IP token bucket trips at the configured `LOGIN_IP_MAX`, default 5) |
| 4.2.5 | CSRF guard on state-changing requests | Same login probe **without** `X-Requested-With` | ✅ HTTP 403 with body `…/errors/csrf` `"State-changing requests must include X-Requested-With: XMLHttpRequest."` |
| 4.2.6 | Production deployment metadata | `getDeploymentInfo()` from the deployment skill | ✅ `isDeployed=true`, `primaryUrl=https://cadstone-works-tool.replit.app`, `deploymentType=autoscale`, `hasSuccessfulBuild=true` |

### 4.3 — Backups

| # | Item | Source | Result |
|---|---|---|---|
| 4.3.1 | DB backup pipeline end-to-end (dump + upload + prune + alert) | `docs/restore-drill.md` §1–§7 | ✅ verified 2026-05-06 (Task #347) |
| 4.3.2 | Most recent production backup | `backups/db/<YYYY-MM-DD>.sql.gz` in object storage | ⚠️ as of 2026-05-06 the only object is `2026-05-06.sql.gz` (the seed run) — **production daily cron is NOT yet armed** (deliberate, see drill §6). Action: arm the Replit Scheduled Deployment OR set `BACKUP_TRIGGER_SECRET` + `BACKUP_WEBHOOK_URL` for the GitHub Actions cron, ideally on the same day the first real client is onboarded |
| 4.3.3 | Supabase PITR / managed retention | Supabase project console | ⏳ confirm in Supabase project console that auto-backups + PITR are enabled (tracked separately as a follow-up — *Confirm Supabase backup retention and turn on point-in-time recovery*) |

---

## 5. Security scanners

Re-run on every cutover. Compare counts to the prior run; investigate any
new critical/high finding before proceeding.

| Scanner | Command (via security-scan skill) | 2026-05-06 result |
|---|---|---|
| Dependency audit | `runDependencyAudit()` | ✅ 0 critical, 0 high (1 moderate `ip-address@10.1.0` → patch to `10.1.1` available; 1 low `@tootallnate/once@2.0.0` → 3.0.1 requires major bump). Both transitive, neither launch-blocking |
| SAST (semgrep) | `runSastScan()` | ✅ 0 critical, 0 high (3 findings total: 2 medium, 1 low — all reviewed, none expose user data or auth) |
| HoundDog (privacy/dataflow) | `runHoundDogScan()` | ✅ 0 findings of any severity |

The two non-zero dependency findings will be picked up automatically by the
"Catch new dependency security advisories automatically" follow-up task once
that lands.

---

## 6. Architect sign-off

Re-run on every cutover. Bring this checklist + the diff for the launch
commit and ask the architect to flag any severe findings. Iterate until the
architect responds **"no severe findings, ready for launch."** Record the
sign-off below.

| Date | Reviewer | Verdict | Notes |
|---|---|---|---|
| 2026-05-06 | task-349 | ⏳ pending — see §7 | Five env-var launch-blockers in §4.1 must close first |

---

## 7. Cutover-day go/no-go

Final hand-check immediately before flipping traffic. **Every box must be
ticked**, in order, on the day of the cutover.

- [ ] §1 (all four automated gates) re-run on the exact launch commit, all green.
- [ ] §2 CI Playwright run on the launch commit, green.
- [ ] §3.1 admin happy path re-run end-to-end on the live deployment.
- [ ] §3.4 mobile spot-check re-run on the live deployment.
- [ ] §4.1 — every required env var present (no ❌ remaining).
- [ ] §4.2.1–4.2.5 re-probed within the last 30 min and all green. In particular: `/api/healthz` returns body with `"db":true,"storage":true` (not just `{"status":"ok"}`), and `/api/livez` returns 200 unauthenticated (today it returns 401 — that **must** be resolved by redeploying the latest commit; see §4.2.2).
- [ ] §4.3.1 — most recent backup is < 24 h old (or, if 4.3.2 cron is still deferred, an on-demand `pnpm --filter @workspace/api-server run backup:db` was run within the last hour and the resulting object is visible in the bucket).
- [ ] §5 — security-scanner counts unchanged or strictly better than the most recent pre-launch run.
- [ ] §6 — architect sign-off for this commit recorded.
- [ ] DNS / customer domain pointed at the deployment (`CORS_ALLOWED_ORIGINS` already matches).
- [ ] Operator on call for the first 24 h, with the runbook (`docs/runbook.md`) and restore drill (`docs/restore-drill.md`) open in tabs.

If any item is red, **do not cut over.** File the gap as a follow-up task,
fix it on a branch, re-run the affected sections of this document, and try
again.
