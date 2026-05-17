# SlabPlan Operations Runbook

This is the quick operator guide for the live SlabPlan deployment.

## Current URLs

| Item | URL |
|---|---|
| Production app | `https://slabplan.vercel.app` |
| Production API | `https://slabplan-api-production.up.railway.app` |
| Production health | `https://slabplan-api-production.up.railway.app/api/healthz` |
| Staging API | `https://slabplan-api-staging.up.railway.app` |
| Staging health | `https://slabplan-api-staging.up.railway.app/api/healthz` |

The production health endpoint should return:

```json
{"status":"ok","db":true,"storage":true,"errors":[]}
```

`durationMs` is expected to vary.

## Smoke Checks

Run these after every deploy:

```bash
curl -i https://slabplan-api-production.up.railway.app/api/livez
curl -i https://slabplan-api-production.up.railway.app/api/healthz
curl -I https://slabplan.vercel.app/login
```

Expected:

- `/api/livez` returns HTTP 200 and `{"status":"ok"}`.
- `/api/healthz` returns HTTP 200 with `db:true` and `storage:true`.
- `/login` returns HTTP 200 from Vercel.

Staging API smoke:

```bash
curl -i https://slabplan-api-staging.up.railway.app/api/healthz
```

## Where Things Live

- GitHub repo: `tarobuild/slabplan`
- Vercel project: `slabplan`
- Railway project: `slabplan-api`
- Railway environments: `production`, `staging`
- Supabase production: `slabplan-production`
- Supabase staging: `slabplan-staging`
- Private storage bucket in both Supabase projects: `slabplan-files`

## Deploy Flow

Production deploys from GitHub `main`.

1. Push code to `main`.
2. Railway production API builds automatically.
3. Vercel production frontend builds automatically.
4. Run the smoke checks above.

Railway staging is a separate environment in the same Railway project. It should
use the staging Supabase project only.

## Common Failure Modes

### API is down

Check Railway service logs first.

Likely causes:

- Missing environment variable.
- Supabase password/connection string issue.
- Missing Supabase storage bucket.
- Migration failure at boot.

Immediate checks:

```bash
curl -i https://slabplan-api-production.up.railway.app/api/livez
curl -i https://slabplan-api-production.up.railway.app/api/healthz
```

### Database is down or misconfigured

Open Supabase production project `slabplan-production`.

Check:

- Project is not paused.
- Database status is healthy.
- Railway `SUPABASE_DATABASE_URL` points to production, not staging.
- Migrations are applied.

### Storage is down or misconfigured

Open Supabase Storage in the matching environment.

Check:

- Bucket `slabplan-files` exists.
- Bucket is private.
- Railway `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` match the same Supabase project as the database.

### AI features fail

The rest of the app should stay online. AI features require:

```text
AI_INTEGRATIONS_ANTHROPIC_API_KEY
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com
```

The API intentionally boots without the key so non-AI workflows are not blocked.

### Email does not send

Transactional email is still pending. Before invites/password resets are used
for real users, configure an email provider and set:

```text
EMAIL_FROM
EMAIL_REPLY_TO
provider API key
APP_PUBLIC_URL
```

## Before Public Launch

Do not treat SlabPlan as launch-ready until these are done:

- Custom domains are connected.
- Transactional email works.
- Anthropic API key is installed and AI usage is verified.
- Stripe billing and webhooks are configured.
- Monitoring/alerting is configured.
- Tenant isolation and file access have a focused security review.
- Backups/restore drill are verified for the Supabase production project.
