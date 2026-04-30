# CAD Stone Networks — Workspace

## Overview

CAD Stone Networks is an internal construction management tool built as a pnpm monorepo. It features a TypeScript, Express 5 backend and a React, Vite, shadcn/ui frontend. The project's vision is to streamline construction project management for Cadstone Works, offering capabilities for job tracking, lead management, scheduling, daily logging, and file management. It also integrates an AI-agent API and a Model Context Protocol (MCP) server to enable external integrations and AI-driven workflows. The system is designed for a single Reserved VM deployment to maintain stateful features like rate limiting and file-view JTI replay stores.

## User Preferences

I want iterative development.
I prefer detailed explanations.
Ask before making major changes.
Do not make changes to folder `artifacts/mockup-sandbox`.
Do not make changes to files related to `mcp.test.ts`.

## System Architecture

The project is structured as a pnpm monorepo using Node.js 24 and TypeScript 5.9.

**Backend (`artifacts/api-server`):**
- Built with Express 5, serving REST APIs at `/api` on port 8080.
- Authentication: JWT with in-memory access tokens and HTTP-only refresh cookies (bcrypt).
- File Storage: Replit App Storage (GCS via sidecar). Files are stored at `$PRIVATE_OBJECT_DIR/cadstone/uploads/...`, with `files.fileUrl` mapping to GCS objects. Direct local disk writes are prohibited.
- Role-gating: All API routes use central visibility helpers (`assertCanViewJob`, etc.) to enforce access control based on user roles, preventing unauthorized data access. Admins have full access.
- API for Agents: Features Personal Access Tokens (PATs) for authentication, RFC 7807 `application/problem+json` for error handling, `Idempotency-Key` replay for write endpoints, cursor pagination for large lists, and `X-RateLimit-*` headers.

**Frontend (`artifacts/cadstone`):**
- Built with React, Vite, Tailwind CSS v4, and shadcn/ui.
- Runs on a dynamically assigned port, proxying `/api` requests to `localhost:8080`.
- Routing: `react-router-dom v6` for protected and nested routes.
- State Management: Zustand for authentication state. TanStack Query (v5) is wired in `src/lib/query-client.ts` for server-state caching/invalidation; the QueryClient is provided in `App.tsx`, the typed client's auth bridge is configured via `setAuthTokenGetter`, and `subscribeToDataRefresh` invalidates per-resource query keys.
- Typed API & Validation: High-traffic resource pages (`clients`, `jobs`, `leads`, `schedule`, `daily logs`) consume `@workspace/api-client-react` (typed react-query hooks + imperative functions) for reads, and `@workspace/api-zod` payload schemas through the `validatePayload` helper (`src/lib/validate-payload.ts`) for client-side validation of create/update mutations. `@workspace/api-client-react` declares `@tanstack/react-query` as a **peer** dependency (not a direct dep) so consumers provide a single instance — declaring it as a regular dep caused pnpm to install a second copy resolved against the catalog react (19.x), giving the generated hooks a different `QueryClientContext` than the app's `QueryClientProvider` and producing "No QueryClient set" at runtime. Vite's `resolve.dedupe` also includes `@tanstack/react-query` as a safety net.
- UI/UX: Adheres to shadcn/ui design principles, with a primary blue theme (`#2563EB`), light gray backgrounds, white cards, and 14px body text. All forms are in Dialog modals, and deletions use AlertDialogs.
- Key features: Dashboard with stats and activity feed, job management (create, view, edit, delete), lead management (create, view, delete), schedule management, daily logs with BuilderTrend-style activity feeds, and a shared file browser for documents, photos, and videos.
- In-App AI Assistant: A right-side chat drawer (`src/components/agent/ChatPanel.tsx`) opened from a Sparkles "Assistant" button in the top nav. Streams responses from the backend via SSE, renders citation chips that deep-link to the cited entity (job/lead/client/file/schedule), persists conversations per user, and shows monthly usage progress.

**AI Agent (in-app, read-only) — `artifacts/api-server/src/routes/agent.ts` + `lib/agent/*`:**
- Powered by Anthropic Claude (`@workspace/integrations-anthropic-ai`, default model `claude-sonnet-4-6`, configurable via `AGENT_MODEL` env var).
- Read-only MCP tool subset (search, list/get for jobs, leads, clients, schedule items, files, daily logs, activity, current user). Tool calls execute via a loopback `ApiClient` against `http://127.0.0.1:$PORT` carrying the user's bearer token, so all role-gating and visibility rules from REST are inherited automatically.
- SSE event stream: `status`, `user_message`, `tool_call`, `tool_result`, `delta`, `done`, `error`.
- Persistence: `agent_conversations`, `agent_messages`, `agent_usage_monthly` tables in `lib/db/src/schema/agent.ts`.
- Per-user monthly token cap (default 500K, configurable via `AGENT_MONTHLY_TOKEN_CAP`).
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
- **Validation:** Zod (`zod/v4`), `drizzle-zod`
- **Frontend Framework:** React
- **Build Tools:** Vite (frontend), esbuild (backend)
- **Styling:** Tailwind CSS v4, shadcn/ui
- **HTTP Client:** Axios
- **State Management:** Zustand
- **Routing:** react-router-dom v6
- **Notifications:** Sonner (toasts)
- **Icons:** Lucide-react
- **File Storage:** Replit App Storage (backed by Google Cloud Storage - GCS)
