# SlabPlan Client-Ready Launch Checklist

## Source And Build

- [ ] GitHub `tarobuild/slabplan` `main` contains the approved release commit.
- [ ] Replit `@tarobuild/slabplan` is synced to that exact commit.
- [ ] Typecheck, API codegen drift, unused-code, frontend bundle, and targeted upload tests pass.
- [ ] No Railway or Vercel runtime configuration remains.

## Replit

- [ ] Reserved VM is selected and paid.
- [ ] Build and run commands match `.replit`.
- [ ] All production secrets are attached to the published app.
- [ ] The deployment is live and `/api/livez` and `/api/healthz` return success.
- [ ] WebSocket, login, invite email, AI, and billing smoke tests pass.
- [ ] Daily backup and backup-check Scheduled Deployments are enabled.

## Supabase

- [ ] Supabase remains the only production PostgreSQL provider.
- [ ] Supabase remains the only production private object store.
- [ ] The organization is on a paid plan.
- [ ] The project global file-size limit is 500 GB.
- [ ] The private SlabPlan bucket file-size limit is 500 GB.
- [ ] The bucket is private and service-role access is available only to the API.
- [ ] Database backups, PITR policy, and restore drill are verified.

## Large Uploads

- [ ] A signed direct upload is organization-scoped.
- [ ] TUS uses the storage-specific Supabase hostname.
- [ ] Uploads resume after interruption or browser restart.
- [ ] Finalization verifies exact byte size and bounded magic bytes.
- [ ] A file larger than 50 GB is accepted by policy without proxying through Replit.
- [ ] Cross-tenant upload intent reuse is rejected.

## Release Evidence

- [ ] Record the GitHub commit, Replit deployment URL, deployment ID, smoke-test date, and Supabase limit settings in `docs/slabplan-launch-status.md`.
