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
- Typed API & Validation: High-traffic resource pages (`clients`, `jobs`, `leads`, `schedule`, `daily logs`) consume `@workspace/api-client-react` (typed react-query hooks + imperative functions) for reads, and `@workspace/api-zod` payload schemas through the `validatePayload` helper (`src/lib/validate-payload.ts`) for client-side validation of create/update mutations.
- UI/UX: Adheres to shadcn/ui design principles, with a primary blue theme (`#2563EB`), light gray backgrounds, white cards, and 14px body text. All forms are in Dialog modals, and deletions use AlertDialogs.
- Key features: Dashboard with stats and activity feed, job management (create, view, edit, delete), lead management (create, view, delete), schedule management, daily logs with BuilderTrend-style activity feeds, and a shared file browser for documents, photos, and videos.
- In-App AI Assistant: A right-side chat drawer (`src/components/agent/ChatPanel.tsx`) opened from a Sparkles "Assistant" button in the top nav. Streams responses from the backend via SSE, renders citation chips that deep-link to the cited entity (job/lead/client/file/schedule), persists conversations per user, and shows monthly usage progress.

**AI Agent (in-app, read-only) — `artifacts/api-server/src/routes/agent.ts` + `lib/agent/*`:**
- Powered by Anthropic Claude (`@workspace/integrations-anthropic-ai`, default model `claude-sonnet-4-6`, configurable via `AGENT_MODEL` env var).
- Read-only MCP tool subset (search, list/get for jobs, leads, clients, schedule items, files, daily logs, activity, current user). Tool calls execute via a loopback `ApiClient` against `http://127.0.0.1:$PORT` carrying the user's bearer token, so all role-gating and visibility rules from REST are inherited automatically.
- SSE event stream: `status`, `user_message`, `tool_call`, `tool_result`, `delta`, `done`, `error`.
- Persistence: `agent_conversations`, `agent_messages`, `agent_usage_monthly` tables in `lib/db/src/schema/agent.ts`.
- Per-user monthly token cap (default 500K, configurable via `AGENT_MONTHLY_TOKEN_CAP`).
- Citations are extracted from tool results and stored on the assistant message, surfaced as deep-link chips in the UI.

**Database (`lib/db`):**
- PostgreSQL with Drizzle ORM.
- Comprises 16 tables including users, jobs, folders, files, leads, schedule items, and activity logs.
- Migration management via Drizzle.
- Operator runbooks live under `lib/db/runbooks/`. For example,
  `files-folder-created-id-index.md` documents how to pre-create the
  `files_folder_created_id_idx` composite index using
  `pnpm --filter @workspace/db build-files-folder-index` (which runs
  `CREATE INDEX CONCURRENTLY`) before deploying to a large production
  database, so the migration's inline `CREATE INDEX IF NOT EXISTS` becomes a
  no-op and uploads aren't slowed by a write lock.

**Model Context Protocol (MCP) Server (`lib/mcp-server`):**
- Wraps the REST API for external agents (Claude Desktop, Cursor, etc.).
- Authentication: PATs only.
- Transports:
    - HTTP/streamable: Mounted at `/api/mcp`, stateless per request. Loopback calls include `X-MCP-Tool` and a per-process `X-MCP-Internal` secret for attribution.
    - Stdio: `bin/cadstone-mcp.mjs` for clients without HTTP transport support. Attributes actions to the user but not specifically `agent_via_mcp` due to process separation.
- Auditing: All tool calls (reads and writes) are logged to `activity_log` with `mcp_tool_call` rows for complete attribution.

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