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
| React web app | Replit Autoscale |
| Express API and Socket.IO | Replit Autoscale |
| In-process sweepers and realtime fanout | Replit Autoscale, maximum 1 machine at launch |
| Scheduled database backup and restore checks | GitHub Actions against Supabase |
| PostgreSQL | Supabase |
| Private object storage | Supabase Storage |
| Large resumable uploads | Browser directly to Supabase TUS |

Do not configure Replit Database or Replit App Storage for production SlabPlan
data. Do not configure Railway or Vercel application deployments. Vercel is
retained only as the `slabplan.com` registrar and DNS host.

## Replit Deployment

The launch deployment uses Autoscale at 2 vCPU / 4 GiB RAM with a maximum of
one machine. This is the cost-appropriate configuration for the initial 1-2
users while keeping in-memory concurrency guards, rate-limit state, Socket.IO
connections, and sweepers on one process. Move to a Reserved VM, or externalize
that state, before enabling multiple Autoscale machines or when production
usage requires an always-on process.

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
- `APP_PUBLIC_URL=https://www.slabplan.com`
- `CANONICAL_HOST=www.slabplan.com`
- `CORS_ALLOWED_ORIGINS=https://www.slabplan.com,https://slabplan.com`
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

GitHub Actions remains the production scheduler for database operations. This
keeps the backup independent of an Autoscale web process that may be at zero
machines and avoids maintaining a second Replit deployment with duplicate
production credentials.

- Daily database backup at 09:00 UTC:
  `corepack pnpm --filter @workspace/api-server run backup:db`
- Backup verification runs immediately after the daily backup in the same
  `.github/workflows/db-backup.yml` job.
- The manual restore drill is defined in
  `.github/workflows/db-restore-drill.yml`.

These jobs use repository-scoped Supabase secrets. Backup artifacts remain in
private Supabase Storage. No Railway runtime participates in backups.
