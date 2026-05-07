-- Task #385: deliberate no-op migration that proves the auto-migrate-on-
-- deploy wiring works.
--
-- Adds a comment to `files.duration_seconds` (the column whose missing
-- migration broke the Files page in production). On the next deploy this
-- migration's row in `workspace_schema_migrations` should appear and the
-- boot log should say "Migrations applied: 0020_verify_auto_migrate.sql".
-- COMMENT ON COLUMN is fully idempotent (it overwrites whatever comment
-- was previously set), so re-applying it is safe.

comment on column "files"."duration_seconds" is
  'Probed on upload by the client; nullable for non-video rows and rows uploaded before Task #368. See Task #385 for the deploy-time migration verification.';
