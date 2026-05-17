# SlabPlan Smoke Test

Date: 2026-05-17

## Summary

Result: passed for the tested production and staging paths.

This smoke test excluded transactional email setup. The AI provider smoke was
run after installing and rotating the Anthropic key and adding Anthropic
credits; it completed successfully and recorded organization token usage.

## Staging API Workflow

Environment: `https://slabplan-api-staging.up.railway.app/api`

Temporary workspace:

- Admin: `slabplan.smoke+20260517184213@tarobuild.com`
- Worker: `slabplan.worker+20260517184213@tarobuild.com`

Passed checks:

- Created workspace/admin.
- Loaded billing status.
- Created client.
- Created job.
- Created document folder.
- Uploaded a private file.
- Listed the private file.
- Created schedule item.
- Created daily log.
- Created lead.
- Converted lead to job.
- Invited non-admin user.
- Accepted non-admin invite.
- Confirmed non-admin billing checkout is blocked with `403`.

Created IDs:

- Client: `9ed9bf77-eccf-4396-be5c-05d47ebb30bb`
- Job: `3f465e9f-6d5f-4215-808c-11ce25c75f6e`
- Folder: `bf9592cc-d5f8-42c5-991d-36b58ac9ba74`
- Lead: `b03140de-4106-42e5-89b8-c4c692984054`
- Converted job: `43cc95ca-68c0-44b5-a1d2-1b4eaec20261`

## Production Browser Workflow

Environment: `https://slabplan.vercel.app`

Temporary workspace:

- Admin: `slabplan.browser.final+20260517190653@tarobuild.com`
- Sign-out check admin: `slabplan.signout+20260517192207@tarobuild.com`

Passed checks:

- Created production workspace.
- Signed in through the production web login form.
- Reached dashboard.
- Loaded Billing settings.
- Confirmed Starter, Team, and Pro plans render.
- Loaded Diagnostics settings.
- Sent controlled browser-origin Sentry diagnostic event.
- Confirmed browser request to Sentry ingestion host:
  `o4511406173061120.ingest.us.sentry.io`.
- Verified mobile login layout at `390px` width has no horizontal overflow:
  `scrollWidth=390`, `clientWidth=390`.
- Created a fresh production workspace and signed out through the account menu.
- Confirmed the logout route cleared the session and returned the browser to
  `/login`.

## Production Fixes Found During Smoke

The production browser smoke exposed two real issues, both fixed and deployed:

- Vercel CSP blocked calls to Railway API and Sentry ingestion.
- Generated React API hooks were using relative `/api/...` URLs instead of the
  configured Railway API origin.

The Railway production auth cookie setting was also verified after deployment:
refresh and upload cookies now return `SameSite=None` with `Secure`, which is
required while the temporary frontend/API hosts are on different sites.

## Residual Gaps

- Invite/password-reset email smoke test waits on transactional email setup.
- Custom domains are intentionally deferred.

## Follow-up AI Smoke

Environment: `https://slabplan-api-staging.up.railway.app/api`

Temporary workspace:

- Admin: `slabplan.ai.20260517204747@tarobuild.com`

Passed checks:

- Created workspace/admin.
- Created AI conversation.
- Sent assistant message through the real Anthropic provider.
- Received the expected response text: `SlabPlan AI smoke passed`.
- Verified organization AI usage metering:
  `inputTokens=2946`, `outputTokens=10`, `requests=1`,
  `totalTokens=2956`.

## Supabase Backup Follow-up

- Supabase org `slabplan` is upgraded to Pro.
- `slabplan-production` scheduled backups page shows a physical backup dated
  `2026-05-17 07:52:07 +0000`.
