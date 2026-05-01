# `@workspace/db`

# `@workspace/db`

Shared Drizzle schema (`src/schema/`) and the SQL migration runner used by
every artifact in the monorepo.

## Layout

- `src/schema/{index,agent}.ts` — the canonical Drizzle ORM schema. All
  application code reads/writes through these table definitions.
- `migrations/*.sql` — hand-written, **idempotent** SQL migrations applied
  in lexicographic order by the runner. Each is recorded by filename and
  sha256 in the `workspace_schema_migrations` table so it never re-runs
  with a different body.
- `src/migrate.ts` / `src/migrate-cli.ts` — the migration runner. On the
  first run against a database that was previously bootstrapped via
  `drizzle-kit push` (the `users` table already exists but
  `workspace_schema_migrations` doesn't), the runner records the
  non-idempotent baseline `0000_far_doctor_strange.sql` as already
  applied. Every later migration is written to be idempotent so it can
  run safely on top of that baseline.
- `migrations/meta/` — Drizzle-kit's snapshot/journal. **Not** consulted
  by the runner, but kept in sync (one snapshot + one journal entry per
  migration file) so future `drizzle-kit generate` calls diff against an
  accurate baseline. When you add a new `NNNN_*.sql`, also add a matching
  `NNNN_snapshot.json` (copy from the previous snapshot, give it a fresh
  `id`, and set `prevId` to the previous snapshot's `id`) and append an
  entry to `_journal.json`.

## Day-to-day workflow

1. Edit the Drizzle schema in `src/schema/`.
2. Hand-write an idempotent SQL migration with the next number prefix
   (e.g. `0010_my_change.sql`). Use `IF NOT EXISTS`, `DO $$ … pg_constraint
   lookup … END$$;`, and `CREATE INDEX IF NOT EXISTS` patterns so the file
   can be re-applied against any database state. `0008_folder_scope_columns.sql`
   and `0009_schema_audit_alignment.sql` are good templates.
3. Add a matching `migrations/meta/NNNN_snapshot.json` and `_journal.json`
   entry as described above (so `drizzle-kit generate` keeps a clean
   baseline).
4. Run `pnpm --filter @workspace/db migrate` against your local Postgres
   to apply it.
5. Verify there is no drift between the schema and migrations (see below).
6. Ship.

We deliberately do **not** use `drizzle-kit generate`. Generated migrations
are not idempotent and don't survive partial failures or hand-patched
databases.

## Verifying schema ↔ migrations parity

Anyone (or any future audit) can confirm `src/schema/` and
`migrations/*.sql` agree by diffing two fresh databases:

```bash
# Database A: built from migrations only.
createdb schema_migrations_db
DATABASE_URL="postgresql://…/schema_migrations_db" \
  pnpm --filter @workspace/db migrate

# Database B: built from the Drizzle schema only.
createdb schema_target_db
DATABASE_URL="postgresql://…/schema_target_db" \
  npx drizzle-kit push --config lib/db/drizzle.config.js --force

# Compare.
pg_dump --schema-only --no-owner --no-privileges -n public \
  -d "postgresql://…/schema_migrations_db" > /tmp/migrations.sql
pg_dump --schema-only --no-owner --no-privileges -n public \
  -d "postgresql://…/schema_target_db"     > /tmp/target.sql
diff /tmp/migrations.sql /tmp/target.sql
```

The diff is expected to contain a few **cosmetic** lines that are safe to
ignore:

- `workspace_schema_migrations` — the runner's own bookkeeping table; only
  exists in the migrations DB.
- `daily_log_settings_singleton_unique` — the migration declares it as a
  `UNIQUE` constraint while the schema declares it as a `uniqueIndex`. Both
  produce the same underlying btree-unique on `singleton`.
- A handful of foreign keys named `*_fkey` (Postgres default style used in
  older migrations like `0005`/`0006`) vs. `*_<table>_id_fk` (Drizzle's
  default style emitted by `drizzle-kit push`). Same column, same target,
  same `ON DELETE` behavior — just a different constraint name.
- Column ordering inside `CREATE TABLE` — `pg_dump` prints columns in the
  order they were added, so a column added by a later migration appears
  after `deleted_at` even when the schema lists it earlier. Functionally
  equivalent.

Anything else is real drift and should ship as a new idempotent migration
following the rules above.
