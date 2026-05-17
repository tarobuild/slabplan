# SlabPlan Deployment Platform Notes

SlabPlan's preferred production shape is split by responsibility:

- GitHub: source of truth.
- Supabase: Postgres and private object storage.
- Railway: Express API server.
- Vercel: React/Vite frontend.
- Stripe: billing, when subscription enforcement is ready.

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

The start command intentionally invokes `node` directly so the API process receives shutdown signals cleanly.

Required Railway variables for staging:

```text
NODE_ENV=production
SUPABASE_DATABASE_URL=
SUPABASE_URL=
SUPABASE_STORAGE_BUCKET=
SUPABASE_SERVICE_ROLE_KEY=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_UPLOAD_SECRET=
JWT_RESET_SECRET=
SESSION_SECRET=
APP_PUBLIC_URL=
CORS_ALLOWED_ORIGINS=
EMAIL_FROM=
EMAIL_REPLY_TO=
AI_INTEGRATIONS_ANTHROPIC_API_KEY=
AI_INTEGRATIONS_ANTHROPIC_BASE_URL=
```

Use the transaction-pooled Supabase URL for `SUPABASE_DATABASE_URL` unless Railway networking requires the session pooler. Keep `SUPABASE_DIRECT_DATABASE_URL` out of runtime unless a one-off admin script needs it.

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

The frontend defaults to same-origin `/api`. For a split-origin deployment, set:

```text
VITE_API_ORIGIN=https://api.slabplan.com
```

For preview deployments without a shared parent domain, prefer a Vercel external rewrite from `/api/:path*` to the Railway API so refresh cookies remain same-origin to the browser.

## Domain Shape

Preferred production domains:

```text
app.slabplan.com -> Vercel frontend
api.slabplan.com -> Railway API
```

Railway must allow the frontend origin in `CORS_ALLOWED_ORIGINS`, and `APP_PUBLIC_URL` should point at the user-facing frontend origin.
