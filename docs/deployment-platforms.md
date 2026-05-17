# SlabPlan Deployment Platform Notes

SlabPlan is deployed with a split-hosting setup:

- GitHub: `tarobuild/slabplan`
- Vercel: React/Vite frontend
- Railway: Express API server
- Supabase: Postgres and private object storage
- Stripe: pending, for billing
- Anthropic: pending API key, for AI features

## Live Environments

| Environment | Frontend | API | Supabase |
|---|---|---|---|
| Production | `https://slabplan.vercel.app` | `https://slabplan-api-production.up.railway.app` | `slabplan-production` / `ifwxnudtubuvntsyfvor` |
| Staging | Vercel preview builds | `https://slabplan-api-staging.up.railway.app` | `slabplan-staging` / `grpjbugdrnqbtglyujqg` |

Production and staging use separate Supabase databases and separate Railway
environments. Keep it that way; do not point staging services at production
Supabase secrets.

## Railway API

Railway deploys from the repository root using `railway.json`.

Build command:

```bash
corepack enable && corepack prepare pnpm@10.33.0 --activate && pnpm install --frozen-lockfile && pnpm run build:api
```

Start command:

```bash
NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Healthcheck:

```text
/api/livez
```

Required Railway variables:

```text
NODE_ENV=production
LOG_LEVEL=info
SUPABASE_DATABASE_URL=
SUPABASE_URL=
SUPABASE_STORAGE_BUCKET=slabplan-files
SUPABASE_SERVICE_ROLE_KEY=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_UPLOAD_SECRET=
JWT_RESET_SECRET=
SESSION_SECRET=
APP_PUBLIC_URL=
CORS_ALLOWED_ORIGINS=
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com
AI_INTEGRATIONS_ANTHROPIC_API_KEY=
AGENT_MODEL=claude-sonnet-4-6
```

`AI_INTEGRATIONS_ANTHROPIC_API_KEY` is still pending. The API boots without it,
but AI features fail until it is set.

## Vercel Web

Vercel deploys the frontend from the repository root using `vercel.json`.

Build command:

```bash
corepack enable && corepack prepare pnpm@10.33.0 --activate && pnpm run build:web
```

Output directory:

```text
artifacts/cadstone/dist/public
```

Current Vercel variable split:

| Variable | Scope | Value |
|---|---|---|
| `VITE_API_ORIGIN` | Production | `https://slabplan-api-production.up.railway.app` |
| `VITE_API_ORIGIN` | Preview | `https://slabplan-api-staging.up.railway.app` |

## Supabase

Production project:

```text
Name: slabplan-production
Ref: ifwxnudtubuvntsyfvor
URL: https://ifwxnudtubuvntsyfvor.supabase.co
Region: us-east-2
Storage bucket: slabplan-files
```

Staging project:

```text
Name: slabplan-staging
Ref: grpjbugdrnqbtglyujqg
URL: https://grpjbugdrnqbtglyujqg.supabase.co
Region: us-west-1
Storage bucket: slabplan-files
```

Both projects use hand-written SQL migrations from `lib/db/migrations`.

Apply migrations intentionally:

```bash
set -a
. ./.env.supabase-production
set +a
NODE_ENV=production pnpm --filter @workspace/db run migrate
```

Use the matching `.env.supabase` file for staging. Local env files are ignored
by Git and must not be committed.

## Domain Shape

Current temporary domains:

```text
slabplan.vercel.app
slabplan-api-production.up.railway.app
slabplan-api-staging.up.railway.app
```

Preferred custom domains before public launch:

```text
app.slabplan.com -> Vercel frontend
api.slabplan.com -> Railway production API
staging.slabplan.com -> Vercel preview/staging frontend
staging-api.slabplan.com -> Railway staging API
```

When custom domains are added, update:

- Railway `APP_PUBLIC_URL`
- Railway `CORS_ALLOWED_ORIGINS`
- Vercel `VITE_API_ORIGIN`
- Email link generation settings
