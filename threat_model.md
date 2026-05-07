# Threat Model

## Project Overview

CAD Stone Networks is a construction-management application for Cadstone Works. It is a pnpm monorepo with a production React/Vite frontend (`artifacts/cadstone`) and an Express 5 API (`artifacts/api-server`) backed by PostgreSQL via Drizzle and private object storage for uploaded files. Authentication uses short-lived JWT access tokens, HTTP-only refresh cookies, legacy upload/file-view tokens for file access, and personal access tokens (PATs) for MCP/programmatic access.

Production assumptions for this scan:
- `NODE_ENV=production` in deployed environments.
- Platform-managed TLS protects client/server traffic in production.
- `artifacts/mockup-sandbox` is development-only and should be ignored unless production reachability is proven.
- Test helpers, migration verification scripts, and local-only tooling are out of scope unless they influence production behavior.

## Assets

- **User accounts and sessions** — user identities, roles, access tokens, refresh cookies, upload/file-view tokens, and PATs. Compromise enables impersonation or unauthorized API/file access.
- **Construction business data** — jobs, clients, schedules, daily logs, leads, reports, invoices, and attachments. Much of this is tenant-confidential operational and financial data.
- **Uploaded files and annotations** — project documents, media, and file metadata stored in private object storage. These may contain sensitive project and customer information.
- **Administrative capabilities** — user invitation, deactivation, reporting, file management, and backup triggers. Abuse could impact all users or the entire dataset.
- **Application secrets** — JWT signing secrets, session secret, database credentials, email/API keys, backup secret, and storage credentials. Exposure could undermine trust boundaries globally.
- **Audit and activity data** — activity log rows, file-view telemetry, and MCP audit records used to investigate sensitive actions.

## Trust Boundaries

- **Browser to API** — all frontend requests cross into the Express API. The browser is untrusted; every protected route must authenticate and authorize server-side.
- **API to PostgreSQL** — route handlers and helper libraries query shared business data directly. Missing predicates or auth checks can leak or alter cross-user data.
- **API to object storage** — uploaded files are stored outside the app process and streamed back through API-controlled routes. File identifiers and metadata must not allow path confusion, unauthorized reads, or browser-executable responses.
- **Public to authenticated routes** — a limited set of endpoints are intentionally reachable before `requireAuth` (auth, health, client-error sink, signed file views, MCP, backup trigger). These are high-scrutiny surfaces because they bypass the normal authenticated router.
- **Interactive user to PAT/MCP access** — PAT-authenticated automation is a separate channel that intentionally bypasses the browser CSRF model. Scope enforcement and route isolation must hold for this path as well.
- **Manager/admin to regular-user boundary** — user management, reports, company-wide views, and some file/folder actions require elevated roles; frontend hiding is not sufficient without server checks.
- **Internal/dev to production boundary** — scripts, test fixtures, mockup sandbox, and local tooling exist in the repo but should not influence deployed behavior.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`, `artifacts/cadstone/src/main.tsx`.
- **Highest-risk code areas:** `artifacts/api-server/src/routes/{auth,mcp,files,files-signed,users,schedule,daily-logs,reports,agent}.ts`, `artifacts/api-server/src/lib/{authorization,auth,storage,file-serving,file-manager,personal-access-tokens,rate-limit}.ts`.
- **Public/pre-auth surfaces:** `/api/auth/*`, `/api/_client-error`, `/api/livez`, `/api/healthz`, `/api/internal/run-db-backup`, `/api/files/:id/view-signed`, `/api/mcp`, `/uploads/*`, public spec routes.
- **Authenticated/admin surfaces:** most `/api/*` routes after `requireAuth`; admin/manager-only paths include reports, user management, company-wide schedule/daily-log views, and some job/client mutations.
- **Dev-only areas to usually ignore:** `artifacts/mockup-sandbox/**`, tests, local scripts, migration verification utilities, and CI-only helpers unless they affect production execution paths.
- **Validated weak spots from the 2026-05-07 scan:** login failure timing in `/api/auth/login`; file authorization paths where folder reassignment or `includeDeleted=true` can change effective access; pre-`requireAuth` MCP audit ingestion; aggregate dashboard queries that must mirror `listAccessible*Ids` scoping.

## Threat Categories

### Spoofing

The application relies on bearer JWTs, refresh cookies, signed file-view/upload tokens, and PATs. All protected API and file-serving paths must validate the correct token type, reject deactivated users, and prevent weaker alternate channels from bypassing the normal authentication model. Public or pre-auth routes must not accidentally accept unauthenticated access because they are mounted before `requireAuth`.

### Tampering

Users can create and modify jobs, schedules, daily logs, files, annotations, and user-management records. The server must derive authorization from the authenticated identity and resource ownership/role checks, not from client-provided identifiers alone. File uploads, moves, and annotations must validate input and enforce destination/source permissions consistently.

Particular attention is required wherever file access is derived from folder metadata rather than the original business-object attachment. Moving a file between folders can effectively re-scope who may read it, so folder moves must preserve owning object boundaries, not just broad attributes like `jobId` or `mediaType`.

### Information Disclosure

This codebase stores sensitive operational records and private uploads. Every listing, detail, download, signed-view, and `/uploads/*` path must scope access to the caller’s permitted jobs/leads/clients/files. Error handling, logging, and public endpoints must avoid leaking secrets, internal paths, stack traces, or other users’ data. Uploaded content must be served with safe headers so browser rendering cannot turn stored files into an XSS vector.

Soft-delete behavior is part of this boundary: once a file is placed in trash, ordinary viewers should not keep receiving it unless the product explicitly treats trash as still-visible content. Aggregate endpoints such as dashboard summaries must also apply the same scope filters as detail/list routes, or they can leak company-wide counts even when raw records remain protected.

### Denial of Service

Public auth endpoints, file-serving routes, client-error intake, agent routes, and backup triggers can be abused for resource exhaustion. The system must preserve rate limits, bounded uploads, and reasonable timeout behavior so unauthenticated or low-privilege callers cannot disproportionately consume CPU, storage, or third-party service budgets.

Pre-`requireAuth` endpoints that still accept bearer credentials, especially MCP transport and audit helpers, need explicit rate-limit and abuse controls. Otherwise they can bypass the normal per-identity limiter applied deeper in the router tree.

### Elevation of Privilege

Role separation between crew members, project managers, and admins is central to the product. Any route that omits `requireAdmin`, `requireManagerOrAbove`, or the deeper `assertCanAccess*` / `assertCanManage*` checks risks horizontal or vertical privilege escalation. PAT/MCP routes require extra scrutiny because they intentionally bypass browser-specific protections and may reach the same business actions through a different trust boundary.
