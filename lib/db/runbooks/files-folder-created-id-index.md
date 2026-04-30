# Runbook: `files_folder_created_id_idx`

This runbook covers the composite index on `public.files`:

```sql
create index if not exists files_folder_created_id_idx
  on public.files (folder_id, created_at desc, id desc);
```

It is defined in:

- Schema: `lib/db/src/schema/index.ts` (`files` table)
- Migration: `lib/db/migrations/0004_files-folder-created-id-index.sql`

The index makes folder file listings (which sort by `created_at desc, id desc`
and filter by `folder_id`) fast even when a folder contains many thousands of
files.

## Why this needs an operator runbook

The migration uses `CREATE INDEX` (not `CREATE INDEX CONCURRENTLY`) because the
migration runner (`lib/db/src/migrate.ts`) wraps each migration in a
transaction, and `CREATE INDEX CONCURRENTLY` is not allowed inside a
transaction.

`CREATE INDEX` takes a `SHARE` lock on the table, which **blocks concurrent
INSERTs/UPDATEs/DELETEs** (i.e. uploads) for the duration of the build. On a
small `files` table this is a few seconds. On a large production table with
many thousands of rows this can be long enough for users to notice slow
uploads.

The `CREATE INDEX IF NOT EXISTS` clause in the migration is what lets us work
around this: if an operator pre-creates the index outside the migration using
the non-blocking `CREATE INDEX CONCURRENTLY`, the migration becomes a no-op on
the next deploy.

## Recommended deploy paths

Pick one of the following before deploying the change that introduced
`migrations/0004_files-folder-created-id-index.sql` to a production database
that already has a meaningful number of `files` rows.

### Path A — Low-traffic window (simplest)

If you can deploy during a low-traffic window (e.g. overnight) and the brief
write lock is acceptable, just deploy normally. The migration will create the
index inline. Watch the API server logs for `Applied migrations:
0004_files-folder-created-id-index.sql` to confirm.

### Path B — Pre-create concurrently, then deploy (recommended for prod)

1. From a machine with `DATABASE_URL` (or `SUPABASE_DATABASE_URL`) pointing at
   the **production** database, run:

   ```bash
   pnpm --filter @workspace/db build-files-folder-index
   ```

   This runs `lib/db/src/scripts/build-files-folder-index-concurrently.ts`,
   which:
   - Checks whether `files_folder_created_id_idx` already exists.
   - If it exists and is valid, exits without doing anything.
   - If it exists but is `INVALID` (a previous concurrent build was
     interrupted), drops it concurrently and rebuilds it.
   - Otherwise issues `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...`, which
     does **not** block writes.
   - Verifies that the resulting index is present and valid.

2. Deploy the application. The `CREATE INDEX IF NOT EXISTS` in
   `migrations/0004_files-folder-created-id-index.sql` will become a no-op,
   and the migration runner will record the migration as applied.

## Recovery: rebuilding an `INVALID` index

`CREATE INDEX CONCURRENTLY` can leave behind an `INVALID` index if it is
interrupted (network drop, process kill, statement timeout, etc.). An invalid
index is not used by the planner, so folder file listings can quietly slow
back down.

To detect this, run:

```sql
select c.relname, i.indisvalid, i.indisready
from pg_class c
join pg_index i on i.indexrelid = c.oid
where c.relname = 'files_folder_created_id_idx';
```

If `indisvalid = false`, run the helper script again:

```bash
pnpm --filter @workspace/db build-files-folder-index
```

It will detect the invalid index, drop it with
`DROP INDEX CONCURRENTLY IF EXISTS`, and rebuild it concurrently. Both steps
are non-blocking.

## Why we don't just change the migration

We could split the index out of the migration runner and let the deploy
pipeline run a `CREATE INDEX CONCURRENTLY` step. We didn't, because:

- The migration runner is the single source of truth for schema state in
  development, CI, and review apps where a brief write pause during the build
  is irrelevant.
- The `IF NOT EXISTS` clause makes the production "pre-create concurrently,
  then deploy" path safe and idempotent without further code changes.

If a future migration adds another index that also risks a long build, prefer
the same pattern: ship `CREATE INDEX IF NOT EXISTS` in the migration, and add
a sibling concurrent-build script + runbook entry here.
