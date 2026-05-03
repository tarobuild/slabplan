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

**AI Agent (in-app, read-only):**
- Powered by Anthropic Claude, configurable via `AGENT_MODEL` env var.
- Provides read-only MCP tool access for jobs, leads, clients, schedule items, files, daily logs, activity, and current user. Tool calls inherit all role-gating and visibility rules.
- Features SSE event streaming for responses.
- Persists conversations and usage in `agent_conversations`, `agent_messages`, and `agent_usage_monthly` tables.
- Implements per-user monthly token caps and an organization-wide monthly token budget. Includes per-user in-flight and rate limits.
- Supports abort handling for ongoing operations and extracts citations from tool results.

**Database (`lib/db`):**
- PostgreSQL with Drizzle ORM, comprising 16 tables.
- Schema changes are managed via `drizzle-kit push --force` and custom SQL migration files.
- Test database provisioning is automated for local development and testing.

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