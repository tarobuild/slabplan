# CAD Stone Networks — Workspace

## Overview

CAD Stone Networks is a pnpm monorepo project designed to be an internal construction management tool. It aims to streamline operations for Cadstone Works by providing functionalities for job tracking, lead management, scheduling, daily logging, and file management. The system also integrates AI-agent capabilities and a Model Context Protocol (MCP) server to support external integrations and AI-driven workflows. The architecture is optimized for a single Reserved VM deployment to manage stateful features efficiently.

## User Preferences

I want iterative development.
I prefer detailed explanations.
Ask before making major changes.
Do not make changes to folder `artifacts/mockup-sandbox`.
Do not make changes to files related to `mcp.test.ts`.

## System Architecture

The project is structured as a pnpm monorepo utilizing Node.js 24 and TypeScript 5.9.

**Backend (`artifacts/api-server`):**
- Built with Express 5, serving REST APIs at `/api` on port 8080.
- Authentication: JWT with in-memory access tokens and HTTP-only refresh cookies (bcrypt). Login refuses users whose `is_active` flag is `false` (constant-time-ish 401), so an admin can immediately revoke access without deleting the account.
- **Roles & seed users:** The schema enforces three roles — `admin`, `project_manager`, `crew_member` — via a check constraint in `lib/db/src/schema/index.ts`. `scripts/seed-users.mjs` seeds two real admins (Cesar and Anwar — both admins; they invite workers through the in-app flow). When run with `--db=local` it additionally seeds a synthetic `worker@cadstone.works` (`crew_member`) fixture used by the Playwright suite to prove worker-level role gates actually fire. All three passwords are env-driven with the same hardening (length, weak-pattern, all-numeric checks): `SEED_ADMIN_CESAR_PASSWORD`, `SEED_ADMIN_ANWAR_PASSWORD`, `SEED_WORKER_FIXTURE_PASSWORD`. The Playwright helpers in `artifacts/cadstone/tests/e2e/helpers/auth.ts` read `SEED_WORKER_FIXTURE_PASSWORD` from the same env so seed-time and login-time agree. The production seed never creates the worker fixture; real workers are added through the in-app invite flow only.
- Team management (admin-only, in-app): Cesar/Anwar are seeded as admins; everyone else is added through `POST /users` (admin gated, returns a one-time setup link plus a sha256-hashed token persisted server-side with a 7-day TTL). Admins can flip `isActive` and change `role` via `PATCH /users/:id` (with a guard that prevents self-deactivation), reissue a fresh setup link via `POST /users/:id/invite`, and the invitee redeems the raw token via `POST /auth/accept-invite` (single-use, atomic `UPDATE … WHERE invite_token_hash = …` clears the hash and stamps `password_set_at` in the same statement, then mints a session via `sendAuthResponse`). The frontend exposes the admin table at `/settings/users` (linked from the "Manage team" card on `/settings`) and the public `/accept-invite` page.
- File Storage: Replit App Storage (GCS via sidecar). Files are stored at `$PRIVATE_OBJECT_DIR/cadstone/uploads/...`, with `files.fileUrl` mapping to GCS objects. Direct local disk writes are prohibited.
- Role-gating: All API routes use central visibility helpers (`assertCanViewJob`, etc.) to enforce access control based on user roles, preventing unauthorized data access. Admins have full access.
- API for Agents: Features Personal Access Tokens (PATs) for authentication, RFC 7807 `application/problem+json` for error handling, `Idempotency-Key` replay for write endpoints, cursor pagination for large lists, and `X-RateLimit-*` headers.

**Frontend:**
- Developed with React, Vite, Tailwind CSS v4, and shadcn/ui.
- Uses `react-router-dom v6` for routing and Zustand for authentication state.
- TanStack Query (v5) is used for server-state caching and invalidation, with typed API integration via `@workspace/api-client-react` and payload validation using `@workspace/api-zod`.
- UI/UX follows shadcn/ui principles with a primary blue theme, light gray backgrounds, white cards, and consistent form/dialog patterns.
- Key features include a dashboard, comprehensive job, lead, schedule, and daily log management, and a shared file browser.
- An in-app AI Assistant (`src/components/agent/ChatPanel.tsx`) uses Anthropic Claude, providing read-only MCP tool access, SSE event streaming for responses, and persistence of conversations and usage. It enforces per-user token caps and rate limits.

**AI Agent (in-app, read-only) — `artifacts/api-server/src/routes/agent.ts` + `lib/agent/*`:**
- Powered by Anthropic Claude (`@workspace/integrations-anthropic-ai`, default model `claude-sonnet-4-6`, configurable via `AGENT_MODEL` env var).
- Read-only MCP tool subset (search, list/get for jobs, leads, clients, schedule items, files, daily logs, activity, current user). Tool calls execute via a loopback `ApiClient` against `http://127.0.0.1:$PORT` carrying the user's bearer token, so all role-gating and visibility rules from REST are inherited automatically.
- SSE event stream: `status`, `user_message`, `tool_call`, `tool_result`, `delta`, `done`, `error`.
- Persistence: `agent_conversations`, `agent_messages`, `agent_usage_monthly` tables in `lib/db/src/schema/agent.ts`.
- Per-user monthly token cap (default 500K, configurable via `AGENT_MONTHLY_TOKEN_CAP`).
- Org-wide monthly token budget as a global cost kill switch (default 10M, configurable via `AGENT_MONTHLY_TOKEN_BUDGET`). Aggregated across all users from the same `agent_usage_monthly` table. Per-user and org-wide caps are checked in parallel on every send; either tripping returns 429. The org cap surfaces a distinct `org-usage-limit` problem type so the UI/runbook can tell it apart from the per-user `usage-limit`. Admin-only `GET /api/agent/usage/org` returns the month-to-date snapshot. Operational details (when it fires, how to raise it, where to read the counter) live in `docs/runbook.md`.
- Per-user in-flight cap on `POST /agent/conversations/:id/messages` (default 1, configurable via `AGENT_MAX_INFLIGHT`) — overflow returns 429 (`in-flight-limit`). Backed by an in-process `Map` in `lib/agent/inflight.ts`; same Reserved-VM caveat as the rate limiter.
- Per-user agent-message rate limit (default 20/min, configurable via `AGENT_RATE_LIMIT_PER_MIN`) layered on top of the general per-user API limiter, because one assistant turn fans out into a long-running Anthropic stream + many tool calls.
- Abort handling: `req.on("close")` aborts an `AbortController` plumbed into the orchestrator → Anthropic SDK (`messages.create({...}, { signal })`) and into every MCP tool fetch via `ApiClient`. On abort the orchestrator stops dispatching the next tool call, skips persisting a partial assistant row, but still meters consumed tokens against the monthly cap (no free retries).
- Citations are extracted from tool results and stored on the assistant message, surfaced as deep-link chips in the UI.

**Database (`lib/db`):**
- PostgreSQL with Drizzle ORM.
- Comprises 16 tables including users, jobs, folders, files, leads, schedule items, and activity logs.
- Migration management: schema changes are applied via `drizzle-kit push --force`
  against the live database, and the SQL files in `lib/db/migrations/` are
  replayed by the custom runner in `lib/db/src/migrate.ts` (tracked in the
  `workspace_schema_migrations` table by filename + checksum). The Drizzle
  journal at `lib/db/migrations/meta/_journal.json` is **not** kept in sync —
  it intentionally only records the initial `0000_far_doctor_strange`
  baseline, and later SQL files (`0004_files-folder-created-id-index`,
  `0005_pat-and-idempotency`, `0006_agent`) are orphan entries from the
  custom-runner perspective only. Do **not** run `drizzle-kit generate` here:
  it would diff the current schema against that stale baseline and produce
  bogus migrations. Use `drizzle-kit push --force` (and, when needed, a new
  hand-written SQL file in `lib/db/migrations/`) instead.
- Operator runbooks live under `lib/db/runbooks/`. For example,
  `files-folder-created-id-index.md` documents how to pre-create the
  `files_folder_created_id_idx` composite index using
  `pnpm --filter @workspace/db build-files-folder-index` (which runs
  `CREATE INDEX CONCURRENTLY`) before deploying to a large production
  database, so the migration's inline `CREATE INDEX IF NOT EXISTS` becomes a
  no-op and uploads aren't slowed by a write lock.
- The cross-cutting operations runbook is `docs/runbook.md`. It records
  Supabase backup posture, object-storage backup posture, the most
  recent restore-drill outcome, and the canonical step-by-step Recovery
  Procedure (PITR, daily-snapshot restore, object-storage triage, post-
  restore verification). Re-read it before any production restore and
  update its drill log on a quarterly cadence (or after a schema change).
  The committed object-storage round-trip script it depends on is at
  `artifacts/api-server/scripts/storage-restore-drill.mjs`.
- **Test database provisioning:** `pnpm run setup-test-db` (re)creates the
  `cadstone_test` database at `127.0.0.1:5432` and runs `drizzle-kit push --force`
  to materialize the full schema. The api-server `pretest` hook calls
  `pnpm --filter @workspace/db run ensure-test-db`, which probes for sentinel
  tables and only runs `setup-test-db` when the schema is missing — so
  `pnpm --filter @workspace/api-server run test` is self-bootstrapping. Both
  scripts honor `TEST_DATABASE_URL` (or `CADSTONE_TEST_DATABASE_URL`) to retarget
  a different cluster and print a clear "start a local Postgres" message when
  the server is unreachable. The api-server test scripts pin `DATABASE_URL` to
  the same test URL so the existing `process.env.DATABASE_URL ??= testDatabaseUrl`
  pattern in the test files always lands on `cadstone_test` rather than any
  ambient Replit-provided `DATABASE_URL`.

**Model Context Protocol (MCP) Server (`lib/mcp-server`):**
- Wraps the REST API for external agents (Claude Desktop, Cursor, etc.).
- Authentication: PATs only.
- Transports:
    - HTTP/streamable: Mounted at `/api/mcp`, stateless per request. Loopback calls include `X-MCP-Tool` and a per-process `X-MCP-Internal` secret for attribution.
    - Stdio: `bin/cadstone-mcp.mjs` for clients without HTTP transport support. Attributes actions to the user but not specifically `agent_via_mcp` due to process separation.
- Auditing: All tool calls (reads and writes) are logged to `activity_log` with `mcp_tool_call` rows for complete attribution.

## Seed admin users

`artifacts/api-server/scripts/seed-users.mjs` upserts the two admin accounts
(`cesar@cadstone.works`, `anwar@cadstone.works`). It is intentionally
defensive:

- Requires an explicit `--db=local` or `--db=production` flag — there is no
  default target.
- `--db=production` additionally requires `--i-know-what-im-doing`.
- Reads passwords from `SEED_ADMIN_CESAR_PASSWORD` and
  `SEED_ADMIN_ANWAR_PASSWORD`. Each must be ≥ 12 chars and must not match
  the script's weak-pattern deny-list (e.g. `test`, `password`, `admin`,
  `cadstone`, all-numeric).
- Logs the target, lists the users it is about to write, and pauses 3 s
  before writing to production.
- Only inserts when a row for that email does not already exist — it never
  overwrites an existing `password_hash`.

Typical local invocation:

```bash
SEED_ADMIN_CESAR_PASSWORD='…' SEED_ADMIN_ANWAR_PASSWORD='…' \
  node artifacts/api-server/scripts/seed-users.mjs --db=local
```

### Rotating production admin passwords (runbook)

Use this when a password may have leaked (e.g. it appeared in git history
or a script log). The seed script does NOT rotate live passwords on
purpose, because it skips existing users.

1. Pick two new strong passphrases (≥ 12 chars, not in the deny-list).
   Keep them only in your password manager.
2. Hash each one with bcrypt (cost 10) — e.g. via a one-off Node REPL:
   `node -e "import('bcrypt').then(b => b.default.hash(process.argv[1], 10).then(console.log))" '<new password>'`
3. In the production database (Supabase SQL editor or `psql` against
   `SUPABASE_DATABASE_URL`), run:
   ```sql
   UPDATE users
      SET password_hash = $1, updated_at = now()
    WHERE email = 'cesar@cadstone.works' AND deleted_at IS NULL;
   ```
   …and the equivalent for `anwar@cadstone.works`.
4. Communicate the new passwords to Cesar / Anwar through a secure
   channel (password manager share, not chat / email).
5. Invalidate any active sessions for those accounts if the leak is
   considered hostile (delete refresh-token rows / restart the API).
6. Update `SEED_ADMIN_CESAR_PASSWORD` / `SEED_ADMIN_ANWAR_PASSWORD` in
   Replit Secrets only if you want future fresh-database seeds to land
   the same value. Otherwise leave them unset between runs so the values
   are not sitting in environment storage.

Never paste the new passwords into chat with the agent or into this
script's source — the agent must not learn them.

## Production Operations

- **Runbook:** [`docs/runbook.md`](docs/runbook.md) — single-page playbook for
  incidents, secret rotation, alerting setup, and "who do I call". Read before
  paging anyone; update after any production incident.
- **Smoke check:** `https://cadstonesystems.com/api/healthz` (unauthenticated,
  returns `{"status":"ok"}`). Wired into the external uptime monitor and the
  api-server's startup health probe.
- **Alerting:** Replit Deployments log-based alerts (crash loop, 5xx spike,
  unhandled error) plus an UptimeRobot HTTPS monitor against the smoke check.
  Setup steps in §2 of the runbook.

### Production database — two URLs, only one is real

The deployment has TWO Postgres connections available at runtime:

- `SUPABASE_DATABASE_URL` (Supabase `aws-1-us-west-2.pooler.supabase.com`) —
  the **real production database**. All real activity (jobs, daily logs,
  schedule items, activity log) lives here. Drizzle schema pushes target this
  DB.
- `DATABASE_URL` (Replit-managed Helium PG, `helium/heliumdb`) — a stale
  legacy DB carried over from before the Supabase migration. Has the user rows
  but only stub data in secondary tables.

`lib/db/src/index.ts` selects `SUPABASE_DATABASE_URL || DATABASE_URL`, so
Supabase wins **as long as the secret is propagated to the deployment
runtime**. If a deploy ever falls back to Helium silently, login crashes
because Helium's schema is older. To detect this fast, the connection module
logs `[db] connecting via <SOURCE> host=<host> db=<db>` at startup — check
deployment logs after every publish.

**2026-05-01 incident:** Login returned "internal service error" after a
republish because the auth query referenced `is_active` and the deploy was
hitting Helium, whose `users` table was missing four columns added during
the Codex security audit. Fix applied: `ALTER TABLE users ADD COLUMN IF NOT
EXISTS … (is_active, invite_token_hash, invite_token_expires_at,
password_set_at)` against Helium, plus admin password reset in Helium to
match the Supabase value. Long-term fix: consolidate to a single DB
(deferred — see follow-up task).

## Security Operations

### Playwright auth-state files must never be committed

`artifacts/cadstone/tests/e2e/.auth/{cesar,anwar}.json` are written by
`auth.setup.ts` after a successful login and contain live `cadstone_refresh_token`
and `cadstone_upload_token` cookies — i.e. real, signed JWTs that grant the
seeded admin/worker accounts. The whole `artifacts/cadstone/tests/e2e/.auth/`
directory is gitignored and must stay that way; do not run `git add -f` on
anything inside it. `auth.setup.ts` calls `fs.mkdirSync(..., { recursive: true })`
so the directory is created on demand for fresh checkouts.

### JWT secret rotation

The api-server signs three independent JWTs from environment-managed secrets:
`JWT_ACCESS_SECRET` (short-lived bearer access token), `JWT_REFRESH_SECRET`
(refresh cookie), and `JWT_UPLOAD_SECRET` (upload + file-view tokens). All three
live in Replit Secrets — there is no checked-in fallback in production
(`auth.ts` throws if any of them are missing when `NODE_ENV=production`).

Rotate any/all of these secrets via the Replit Secrets UI (or
`requestEnvVar({ requestType: "secret", keys: [...] })` from the agent —
never `setEnvVars` for secrets) whenever they may have been exposed,
including: a leaked auth-state file landing in git history, a leaked log
line, a developer device compromise, or routine rotation. After updating
any secret, restart the `artifacts/api-server: API Server` workflow and
re-run `pnpm --filter @workspace/cadstone exec playwright test --project=setup`
to regenerate the local `.auth/*.json` files. Rotating a secret immediately
invalidates every token previously signed with the old key.

## Security Advisories

### Resolved: postcss <8.5.10 (GHSA-qx2v-qp2m-jg93, moderate severity)

- Status: Resolved (Task #212). `pnpm.overrides` in `pnpm-workspace.yaml` pins
  `postcss` to `^8.5.12` so all consumers (Vite, Tailwind v4) resolve a single
  patched version. Confirmed in `pnpm-lock.yaml` and via `pnpm audit`.
- Why it was low risk regardless: PostCSS is a dev-time only transitive — it
  does not run in the deployed runtime. The override is kept anyway so client
  handoff `pnpm audit` reports stay clean of medium/high advisories.
- Re-check: bump to the next patched 8.x as upstream advisories require, or
  remove the override once Vite/Tailwind transitives resolve a new-enough
  postcss on their own.

### Deferred: @tootallnate/once <3.0.1 (GHSA-vpq2-c234-7xj6, low severity)

- Status: Knowingly deferred. This is the only outstanding production advisory reported by `pnpm audit --prod` and is expected to remain there until upstream Google releases a major version of `@google-cloud/storage` that drops `teeny-request`.
- Path: `@workspace/api-server > @google-cloud/storage > teeny-request > http-proxy-agent@5.0.0 > @tootallnate/once@2.0.0`.
- Upstream advisory: https://github.com/advisories/GHSA-vpq2-c234-7xj6
- Why we cannot patch it today:
  - `@google-cloud/storage` is pinned at the current latest, `7.19.0` (no `8.x` line exists yet, and `7.19.0` was published 2026-02-05). `pnpm update @google-cloud/storage` is a no-op.
  - Adding `pnpm.overrides` for `@tootallnate/once` to the patched `3.0.1` breaks `@google-cloud/storage` at runtime: `3.x` is ESM-only but `http-proxy-agent@5.0.0` consumes it via `require(...)`, throwing `ERR_REQUIRE_ESM` on the first GCS call.
  - Overriding `http-proxy-agent` to `^6` or `^7` removes the bad transitive but breaks `teeny-request@9.0.0`, which does `const Agent = require('http-proxy-agent'); new Agent(proxyOpts)`. `http-proxy-agent@>=6` switched to a named export (`{ HttpProxyAgent }`), so `new Agent(...)` throws `TypeError: Agent is not a constructor` (verified locally against `http-proxy-agent@7.0.2`).
  - Overriding `teeny-request` to `^10` breaks `@google-cloud/storage` because v10 depends on the ESM-only `node-fetch@3` and the new proxy-agent API, neither of which the storage SDK's CJS code can load.
- Why it is low risk for us:
  - Severity is low. The flaw is in `@tootallnate/once`'s once-event listener semantics, only reachable through `http-proxy-agent`'s proxy-CONNECT flow.
  - That flow only executes when `teeny-request` is given an HTTP/HTTPS proxy (via `HTTP_PROXY` / `HTTPS_PROXY` env vars or an explicit `proxy` request option). Our deployments do not set these env vars and we never pass a `proxy` option to GCS, so the vulnerable code path is not exercised in production.
  - The package is a deep transitive of object-storage uploads/downloads only — it is not on any user-input parsing, auth, or rendering path.
- Re-check on or before: 2026-11-01 (~6 months out). On that date, re-run `pnpm audit --prod` and recheck:
  1. Is `@google-cloud/storage@8.x` published, or has 7.x dropped `teeny-request`? If yes, upgrade and remove this section.
  2. Has `teeny-request` shipped a CJS-friendly release that no longer pulls `http-proxy-agent@5`? If yes, override it.
  3. Otherwise, push the re-check date out another 6 months and update this entry.
- Allowed audit baseline: `pnpm audit --prod` is expected to report exactly one advisory — this one. Any additional finding is not covered by this deferral and must be triaged.
- See also: the comment block in `pnpm-workspace.yaml` under `overrides:` documents the same constraint at the override-site, and Task #100 captured the original triage.

## External Dependencies

- **Monorepo Tool:** pnpm workspaces
- **Package Manager:** pnpm
- **API Framework:** Express 5
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Validation:** Zod
- **Frontend Framework:** React
- **Build Tools:** Vite, esbuild
- **Styling:** Tailwind CSS v4, shadcn/ui
- **HTTP Client:** Axios
- **State Management:** Zustand
- **Routing:** react-router-dom v6
- **Notifications:** Sonner
- **Icons:** Lucide-react
- **AI Model:** Anthropic Claude
- **File Storage:** Replit App Storage (Google Cloud Storage)