# SlabPlan Client-Ready Launch Checklist

## Source And Build

- [x] GitHub `tarobuild/slabplan` `main` contains the approved release commit.
- [x] Replit `@tarobuild/slabplan` has a clean worktree synced to GitHub `main`.
- [x] Typecheck, API codegen drift, unused-code, frontend bundle, and targeted upload tests pass.
- [x] The local Playwright release gate passes all 73 end-to-end tests.
- [ ] The GitHub Playwright release workflow passes all 73 end-to-end tests for
  the new release commit.
- [x] No Railway or Vercel runtime configuration remains.

## Replit

- [x] Autoscale is selected at 2 vCPU / 4 GiB with a one-machine launch cap.
- [x] Build and run commands match `.replit`.
- [x] All required production secrets are attached to the published app.
- [x] The new deployment is live and `/api/livez` and `/api/healthz` return success.
- [ ] WebSocket, login, invite email, AI, and billing smoke tests pass.
- [ ] Forgot-password email delivery and reset completion pass through the
  production Google Workspace SMTP account.
- [x] Public Terms and Privacy pages load, and registration records versioned
  consent.
- [x] Daily backup and verification remain enabled in GitHub Actions and write
  only to the retained Supabase data plane.
- [x] `slabplan.com` and `www.slabplan.com` resolve to Replit with valid HTTPS.

## Supabase

- [x] Supabase remains the only production PostgreSQL provider.
- [x] Supabase remains the only production private object store.
- [x] The organization is on a paid plan with a 500 GB storage limit available
  (for Pro, the spend cap must be disabled).
- [x] The project global file-size limit is 500 GB.
- [x] The private SlabPlan bucket inherits the 500 GB global limit.
- [x] The bucket is private and service-role access is available only to the API.
- [x] The scheduled database backup and its verification job pass.
- [x] The manual database restore drill passes.
- [ ] Confirm the Supabase PITR retention policy before broad production use.

## Large Uploads

- [x] A signed direct upload is organization-scoped.
- [x] TUS uses the storage-specific Supabase hostname.
- [ ] Uploads resume after interruption or browser restart.
- [x] Finalization verifies exact byte size and bounded magic bytes.
- [x] A file larger than 50 GB is accepted by policy without proxying through Replit.
- [x] Cross-tenant upload intent reuse is rejected.

## Release Evidence

- [x] Record the GitHub commit, Replit deployment URL, deployment ID, smoke-test date, and Supabase limit settings in `docs/slabplan-launch-status.md`.
