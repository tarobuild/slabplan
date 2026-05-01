# `@workspace/db`

Drizzle schema, migrations, and seed helpers for the application database.

- Schema lives in `src/schema/` and is the source of truth for the table
  shapes used by the rest of the codebase.
- Applied SQL migrations live in `migrations/` and are executed in order by
  the migrate CLI (`pnpm --filter @workspace/db run migrate`).
- The `migrations/meta/` directory is drizzle-kit's snapshot bookkeeping and
  is what `drizzle-kit generate` uses to compute the diff for the next
  migration.

## Adding a new migration

There are two supported ways to author a migration. **Pick one per change.**
Don't mix the two for the same migration.

### 1. Generated migrations (preferred)

For ordinary additive schema changes — new tables, new columns, new
indexes, new enums, new foreign keys — let drizzle-kit do the work:

1. Edit the schema in `lib/db/src/schema/` to describe the desired final
   state.
2. From the repo root, run:

   ```bash
   pnpm --filter @workspace/db run generate
   ```

   This compares the current schema against the most recent snapshot in
   `migrations/meta/` and writes a new `NNNN_<slug>.sql` file along with a
   matching `NNNN_snapshot.json` and an entry in `_journal.json`.
3. Inspect the generated SQL. Tweak it if necessary (e.g. swap `CREATE
   INDEX` for `CREATE INDEX CONCURRENTLY` would not be safe here — see
   "Hand-written migrations" below for that case).
4. Apply it locally with `pnpm --filter @workspace/db run migrate` and
   commit the SQL file together with the updated meta files.

### 2. Hand-written migrations

Use this only when the change cannot be expressed by the schema +
generator, for example:

- Data backfills (`UPDATE ...`) that have to run as part of the deploy.
- DDL drizzle-kit can't emit cleanly (e.g. partial / expression indexes,
  policies, triggers).
- Ops-sensitive DDL that needs a runbook (see
  `runbooks/files-folder-created-id-index.md` for an example).

When you go this route:

1. Add the SQL file at `migrations/NNNN_<slug>.sql`, picking the next free
   number after the last entry in `migrations/meta/_journal.json`.
2. Update `lib/db/src/schema/` so the schema reflects the post-migration
   state. **This step is not optional** — if the schema and the database
   drift apart, the next call to `pnpm run generate` will try to "fix" the
   drift by emitting a phantom migration.
3. Refresh the snapshot so future generated migrations diff against the
   current state. The cheapest way is to run `pnpm --filter @workspace/db
   run generate` immediately after step 2; if everything is in sync it
   will print `No schema changes, nothing to migrate` and rewrite the
   snapshot files in place. If it instead proposes a diff, the schema in
   step 2 doesn't match the SQL you wrote — fix the schema, don't accept
   the generated migration.
4. Apply locally with `pnpm --filter @workspace/db run migrate` and commit
   the SQL file together with the updated meta files.

## Why the meta directory matters

`drizzle-kit generate` reads the latest entry in
`migrations/meta/_journal.json`, loads the matching `NNNN_snapshot.json`,
and diffs it against the schema in `src/schema/`. If the journal /
snapshot fall behind the actual database (because a hand-written
migration was committed without refreshing meta), the next call to
`generate` will try to recreate everything that has been added since the
stale snapshot. That's why every hand-written migration must be followed
by a snapshot refresh.
