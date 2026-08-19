# SlabPlan Production Architecture

## Source Of Truth

- GitHub repository: `tarobuild/slabplan`
- Release branch: `main`
- Replit app: `@tarobuild/slabplan`
- Replit must publish the exact commit currently on GitHub `main`.
- CAD Stone is an upstream reference only. SlabPlan never pushes to or deploys from the CAD Stone repository.

## Hosting Boundary

SlabPlan uses Replit for the application runtime and Supabase for persistent data:

| Responsibility | Provider |
| --- | --- |
| React web app | Replit Reserved VM |
| Express API and Socket.IO | Replit Reserved VM |
| In-process sweepers and realtime fanout | Replit Reserved VM |
| Scheduled backups and storage audits | Replit Scheduled Deployments |
| PostgreSQL | Supabase |
| Private object storage | Supabase Storage |
| Large resumable uploads | Browser directly to Supabase TUS |

Do not configure Replit Database or Replit App Storage for production SlabPlan data. Do not configure Railway or Vercel deployments.

## Replit Deployment

Use a Reserved VM because the API maintains Socket.IO connections, in-memory concurrency guards, rate-limit state, and background sweepers. Autoscale is not a safe target until those responsibilities move to shared infrastructure.

Build command:

```bash
corepack pnpm install --frozen-lockfile --registry=https://registry.npmjs.org/ && corepack pnpm run build:web && corepack pnpm run build:api
```

Run command:

```bash
corepack pnpm run start:api
```

The API listens on `0.0.0.0` and `PORT`, serves `/api/*`, Socket.IO, private file routes, and the compiled React application from the same origin.

## Production Configuration

Required Replit published-app secrets:

- `SUPABASE_DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_STORAGE_BUCKET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_UPLOAD_SECRET`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

Required non-secret production settings:

- `NODE_ENV=production`
- `CADSTONE_STORAGE_BACKEND=supabase`
- `APP_PUBLIC_URL=https://slabplan.replit.app`
- `CANONICAL_HOST=slabplan.replit.app`
- `CORS_ALLOWED_ORIGINS=https://slabplan.replit.app`
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com`
- `AGENT_MODEL=claude-sonnet-4-6`

`SUPABASE_ANON_KEY` is required only when Supabase Auth login is enabled.
Stripe variables are required when paid plans are enabled. Sentry variables are
optional. Transactional email currently fails loudly and returns the manual
invite/reset link because no provider is approved and wired; do not add Resend
under the repository policy.

Store every credential in Replit Secrets; never commit values.

## Supabase Large Files

The private bucket and project global upload limit must both be set to `500 GB`
on a paid Supabase plan. Supabase represents this as `500 * 1024^3` bytes,
which matches the application limit. Pro projects must have the spend cap
disabled for the 500 GB limit to be available. Files above the small multipart
threshold use a signed TUS upload directly from the browser to the
storage-specific Supabase hostname. The Replit server receives metadata and
finalizes the database record, but never proxies the file body.

Every object path is prefixed by `organizations/<organization-id>/`. Signed upload intents, file rows, attachment rows, authorization checks, and activity records all retain the active organization.

## Scheduled Operations

Create Replit Scheduled Deployments for:

- Daily database backup at 09:00 UTC:
  `corepack pnpm --filter @workspace/api-server run backup:db`
- Daily backup verification at 12:00 UTC:
  `corepack pnpm --filter @workspace/api-server run backup:check`
- Weekly read-only storage drift audit:
  `node artifacts/api-server/scripts/audit-storage-drift.mjs --db=production`

Scheduled jobs use the same Supabase production secrets as the Reserved VM. Backup artifacts remain in private Supabase Storage.
