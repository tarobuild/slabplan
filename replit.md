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

Routes:
- `GET /api/healthz` — health check
- `POST /api/auth/login|register|logout|refresh|forgot-password|reset-password`
- `GET/PUT /api/users/me`, `GET /api/users`
- `GET/POST /api/jobs`, `GET/PUT/DELETE /api/jobs/:id`
- `GET/POST /api/jobs/:jobId/folders`
- `PUT/DELETE /api/folders/:id`, `POST /api/folders/:id/copy|move`
- `GET/POST /api/folders/:id/files`
- `GET /api/files/:id/download`, `DELETE /api/files/:id`
- `GET/POST /api/leads`, `GET/PUT/DELETE /api/leads/:id`
- `POST /api/leads/:id/contacts|attachments|convert-to-job`
- `GET /api/activity`
- **Pending** (Task #3): Schedule items and Daily Logs routes

### `artifacts/cadstone`
React + Vite + Tailwind CSS v4 + shadcn/ui frontend. Runs on port assigned by `$PORT`.
Base path: `/`. Proxies `/api` to `localhost:8080`.

Key files:
- `src/App.tsx` — wouter router, protected routes, silent refresh on mount
- `src/lib/api.ts` — Axios instance (auto Bearer token + 401 refresh interceptor)
- `src/store/auth.ts` — Zustand auth store (user, accessToken, setAuth, clearAuth)
- `src/components/layout/` — AppLayout, TopNav, Sidebar
- `src/pages/` — login, register, dashboard (stub), jobs (stub), job-detail (stub), leads (stub), settings

Theme: Primary blue `#2563EB` (221 83% 53%), page bg `#F9FAFB`, white cards, `#E5E7EB` borders. Full dark mode via `.dark` class.

Design rules: shadcn/ui everywhere, all forms in Dialog modals, AlertDialog for deletes, 14px body text, information-dense tables.

Frontend dependencies: axios, zustand, wouter, sonner (toasts), lucide-react, shadcn/ui

### `lib/db`
Drizzle ORM + PostgreSQL. 16 tables.

Key tables: users, jobs, folders, files, leads, lead_contacts, lead_attachments, schedule_items, schedule_assignees, daily_logs, daily_log_attachments, daily_log_tags, tags, activity_log

Seed: `pnpm --filter @workspace/db run seed` → 3 users, 5 jobs, 3 leads
Seed credentials: `cruz.martinez@cadstone.internal` / `Cadstone123!` (also maria.garcia, jake.thompson)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run seed` — seed database with test data

## Codex Guide

The comprehensive Codex frontend build guide is at:
`artifacts/cadstone/CODEX_FRONTEND_GUIDE.md`

It documents all API endpoints, all pages to build (Dashboard, Jobs, Job Detail with tabs, Files, Photos, Videos, Schedule, Daily Logs, Leads), design rules, component patterns, and build order.

## Feature Status

- ✅ Task #1: Foundation — DB schema (16 tables), JWT auth, app shell
- ✅ Task #2: Jobs & File Management — routes for jobs, folders, files
- ⏳ Task #3: CRM, Schedule & Daily Logs — leads partial (basic GET only), schedule and daily logs routes pending
- ⏳ Task #4: Dashboard & Polish
- ✅ Task #5: Frontend scaffold — CSS theme, API client, auth store, router, layout shell, stub pages, Codex guide
