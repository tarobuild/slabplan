# AGENTS.md

This repo is a production codebase for CAD Stone Networks, owned by Tarobuild and operated for client Cadstone. Real users depend on it.

Before making changes, read `replit.md` for product, architecture, workflow, and owner preferences. Follow it strictly, especially the gotchas and protected areas.

## Workflow Rules

1. Never commit directly to `main`. Always create a branch named `codex/<short-feature-name>`.
2. Always open a pull request. Do not merge it yourself.
3. Before starting work, run `git checkout main && git pull origin main` so the branch starts from the latest trunk.
4. Keep one feature or fix per branch. Do not bundle unrelated changes.
5. Before opening a PR, run:
   - `pnpm install`
   - `pnpm typecheck`
   - `pnpm check-api-codegen`
   - `pnpm knip`
6. Fix any red checks before opening the PR, unless the owner explicitly accepts the risk.
7. PR descriptions must list:
   - What changed
   - Why
   - Manual test steps
   - Follow-ups, including env vars, DB migrations, or owner decisions
8. Do not add Resend or new Sentry instrumentation. These are explicitly excluded by the owner.

## Repo-Specific Constraints

- Do not make changes to `artifacts/mockup-sandbox`.
- Do not make changes to files related to `mcp.test.ts`.
- Generated API client and Zod schema files are not edited by hand. Update the OpenAPI spec first, then regenerate.
- If an API handler and `openapi.yaml` disagree, fix the spec first, then regenerate.
