# AGENTS.md — Rules for AI Coding Agents (Codex, etc.)

This file is read automatically by Codex and other AI coding agents at the start of every session. **Follow these rules without exception.**

This is the **CAD Stone Networks** production codebase, owned by Tarobuild and operated for the client Cadstone. Real users depend on it. Treat every change as production-grade.

---

## Golden Rules

1. **Never push directly to `main`.** Always work on a branch and open a Pull Request.
2. **One feature / fix per branch.** Don't bundle unrelated changes.
3. **Read `replit.md` first.** It contains the project overview, run commands, env vars, stack, and conventions. Conform to them.
4. **No mocked/placeholder data in production paths.** If something can't be wired up cleanly, fail loudly rather than silently fall back.
5. **No new dependencies without justification.** Prefer existing libraries already in the monorepo.
6. **No Resend, no Sentry additions.** Owner has explicitly excluded these from new work. (Existing Sentry plumbing is grandfathered — do not extend it.)

---

## Branch & PR Workflow

```bash
# 1. Always start from latest main
git checkout main
git pull origin main

# 2. Create a descriptive branch
git checkout -b codex/<short-feature-name>
#   examples: codex/delete-user-endpoint, codex/fix-daily-log-comment-delete

# 3. Make your changes, commit with a clear message
git add -A
git commit -m "feat(api): add DELETE /users/:id endpoint with audit log"

# 4. Push the branch (NEVER to main)
git push -u origin codex/<short-feature-name>

# 5. Open a Pull Request on github.com/tarobuild/Cadstone-Works-Tool
#    - Title: short summary
#    - Description: what changed, why, and any manual test steps
```

The owner reviews and merges PRs manually. **Do not self-merge.**

---

## Before You Code — Required Checks

Run these commands and ensure they pass before opening a PR:

```bash
pnpm install                       # ensure deps are in sync
pnpm typecheck                     # must be clean
pnpm check-api-codegen             # API client must be in sync with the spec
pnpm knip                          # no dead/unused code
pnpm --filter @workspace/cadstone run check-eager-bundle  # frontend bundle health
```

If you change the API spec (`artifacts/api-spec`), regenerate the client:
```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Project Conventions (read `replit.md` for the full list)

- **Monorepo:** pnpm workspaces. Packages live under `artifacts/` (`api-server`, `cadstone` web app, `api-spec`, `mockup-sandbox`).
- **Stack:** Node.js 24 + TypeScript 5.9, Express 5 backend, React + Vite frontend, Drizzle ORM, PostgreSQL (Supabase), Zod, Tailwind v4 + shadcn/ui, Anthropic Claude for AI features.
- **API contract:** OpenAPI spec in `artifacts/api-spec` is the source of truth. Generated client lives alongside; never hand-edit generated files.
- **Auth:** JWT-based (access + refresh + upload + reset secrets). Personal Access Tokens are scoped per-user.
- **Database:** Drizzle migrations via `drizzle-kit`. Use `drizzle-kit push --force` only with explicit owner approval.
- **No silent fallbacks.** If an env var or service is missing, throw — don't pretend.

---

## Things That Will Get a PR Rejected

- Pushing directly to `main`
- Adding Resend or new Sentry instrumentation
- Hard-coded secrets, API keys, or production URLs
- Disabling typecheck, knip, or codegen-drift checks to make CI pass
- Mocked/dummy data in code paths that ship to production
- Unrelated formatting churn mixed into a feature PR
- Schema changes without a corresponding Drizzle migration plan

---

## Communication

- Be explicit about trade-offs in PR descriptions.
- Flag anything that needs a follow-up (env var, manual DB step, owner decision) at the top of the PR body.
- If a task is ambiguous, open a draft PR with questions rather than guessing.
