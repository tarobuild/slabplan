# SlabPlan Deployment Platform Notes

SlabPlan is deployed with a split-hosting setup:

- GitHub: `tarobuild/slabplan`
- Vercel: React/Vite frontend
- Railway: Express API server
- Supabase: Postgres and private object storage
- Stripe: Tarobuild account, test-mode SlabPlan catalog created
- Anthropic: pending API key, for AI features
- Sentry: Tarobuild org, SlabPlan web/API projects created

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
SENTRY_DSN_API=
SENTRY_ENVIRONMENT=production
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_TEAM=
STRIPE_PRICE_PRO=
```

`AI_INTEGRATIONS_ANTHROPIC_API_KEY` is still pending. The API boots without it,
but AI features fail until it is set.

Railway production uses `SENTRY_ENVIRONMENT=production`; Railway staging uses
`SENTRY_ENVIRONMENT=staging`.

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
| `SENTRY_DSN_WEB` | Production + Preview | SlabPlan web project DSN |
| `SENTRY_ENVIRONMENT` | Production | `production` |
| `SENTRY_ENVIRONMENT` | Preview | `staging` |

Vercel needs a new deployment after Sentry env changes because the web DSN is
compiled into the Vite build.

## Monitoring

Sentry is configured in the Tarobuild Sentry organization:

| Project | Runtime | Env var |
|---|---|---|
| `slabplan-web` | Vercel React/Vite frontend | `SENTRY_DSN_WEB` |
| `slabplan-api` | Railway Express API | `SENTRY_DSN_API` |

Default Sentry email issue alerts are enabled through project setup. Source map
upload is still optional and requires a future `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, and `SENTRY_PROJECT_WEB` build-time setup.

## Stripe Billing

Stripe is configured under the Tarobuild Stripe account in **test mode only**.
No live products or prices were created.

Recommended self-serve tiers are capped at `$249/mo`:

| Plan | Test product ID | Test price ID | Monthly test price | Intended fit |
|---|---|---|---:|---|
| Starter | `prod_UXCaQQajw04YXP` | `price_1TY8B5GReLNurDCd7A4G2wEK` | `$79` | Small shop getting organized |
| Team | `prod_UXCaWRSA5OBBGi` | `price_1TY8BHGReLNurDCdda2gcHwR` | `$149` | Active fabrication team |
| Pro | `prod_UXCatr5E30rz7o` | `price_1TY8BSGReLNurDCdXFEB32u8` | `$249` | Established shop needing more control |

Feature posture:

- Starter: jobs, clients, leads, schedule, files, basic reports, limited AI parsing.
- Team: Starter plus daily logs, team activity, financial tracker, standard AI usage.
- Pro: Team plus advanced reports/exports, higher AI allowance, priority support.

Stripe env vars point the app at the test-mode prices:

```text
STRIPE_PRICE_STARTER=
STRIPE_PRICE_TEAM=
STRIPE_PRICE_PRO=
```

Checkout, customer portal, and signed webhook endpoints exist in the API. Keep
Stripe in test mode until cancellation behavior, failed-payment behavior, and
tenant access gating are fully smoke-tested.

Test-mode Stripe webhook endpoints:

| Environment | Endpoint ID | URL |
|---|---|---|
| Production | `we_1TY8DOGReLNurDCdWveX0DpN` | `https://slabplan-api-production.up.railway.app/api/billing/stripe/webhook` |
| Staging | `we_1TY8DOGReLNurDCdys8AAMlb` | `https://slabplan-api-staging.up.railway.app/api/billing/stripe/webhook` |

## Email

Use the existing Tarobuild Resend account, but verify a SlabPlan sender domain
after the domain is purchased. Preferred sender shape:

```text
SlabPlan <noreply@slabplan.com>
support@slabplan.com
billing@slabplan.com
```

Email can wait until domain setup. Until then, invites, password resets, and
billing emails are not production-like.

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
