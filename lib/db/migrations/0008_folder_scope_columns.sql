-- Folder scoping: align the `folders` table with the Drizzle schema by
-- introducing the `folder_scope` enum, the four scope-related columns
-- (`scope`, `lead_id`, `daily_log_id`, `schedule_item_id`), their foreign
-- keys, indexes and the scope-aware unique indexes.
--
-- The original 0000 migration created `folders` as a job-only table with
-- `job_id NOT NULL`. The Drizzle schema has long since modelled folders as
-- a polymorphic container scoped to a job, lead, daily log, schedule item
-- or the global resources area, but no migration ever caught up.
-- `drizzle-kit push --force` cannot bridge the gap on databases that
-- already hold rows because the `scope` column is NOT NULL with no default.
--
-- Backfill rule (per task spec): existing rows are tagged `'job'` when
-- `job_id` is set, and `'resource'` otherwise.
--
-- The whole script is idempotent so it is safe to apply against databases
-- that have been partially patched by `drizzle-kit push` or by hand.

-- 1. Enum --------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'folder_scope') THEN
    CREATE TYPE "folder_scope" AS ENUM (
      'resource', 'job', 'lead', 'daily_log', 'schedule_item'
    );
  END IF;
END$$;
--> statement-breakpoint

-- 2. New columns -------------------------------------------------------------
ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "scope" "folder_scope";
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "lead_id" uuid;
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "daily_log_id" uuid;
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN IF NOT EXISTS "schedule_item_id" uuid;
--> statement-breakpoint

-- 3. Backfill scope for existing rows ---------------------------------------
UPDATE "folders"
   SET "scope" = CASE
     WHEN "job_id" IS NOT NULL THEN 'job'::"folder_scope"
     ELSE 'resource'::"folder_scope"
   END
 WHERE "scope" IS NULL;
--> statement-breakpoint

-- 4. Constrain scope ---------------------------------------------------------
ALTER TABLE "folders" ALTER COLUMN "scope" SET NOT NULL;
--> statement-breakpoint

-- 5. The original 0000 migration created `folders.job_id` as NOT NULL. The
--    Drizzle schema has long allowed it to be nullable so resource / lead /
--    daily-log / schedule-item folders can exist without a job. Drop the
--    constraint defensively (no-op if it has already been dropped via push).
ALTER TABLE "folders" ALTER COLUMN "job_id" DROP NOT NULL;
--> statement-breakpoint

-- 6. Foreign keys for the new scope columns ---------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folders_lead_id_leads_id_fk'
  ) THEN
    ALTER TABLE "folders"
      ADD CONSTRAINT "folders_lead_id_leads_id_fk"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folders_daily_log_id_daily_logs_id_fk'
  ) THEN
    ALTER TABLE "folders"
      ADD CONSTRAINT "folders_daily_log_id_daily_logs_id_fk"
      FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folders_schedule_item_id_schedule_items_id_fk'
  ) THEN
    ALTER TABLE "folders"
      ADD CONSTRAINT "folders_schedule_item_id_schedule_items_id_fk"
      FOREIGN KEY ("schedule_item_id") REFERENCES "schedule_items"("id") ON DELETE CASCADE;
  END IF;
END$$;
--> statement-breakpoint

-- 7. Lookup indexes ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS "folders_scope_idx"
  ON "folders" USING btree ("scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_lead_id_idx"
  ON "folders" USING btree ("lead_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_daily_log_id_idx"
  ON "folders" USING btree ("daily_log_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_schedule_item_id_idx"
  ON "folders" USING btree ("schedule_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_parent_folder_id_idx"
  ON "folders" USING btree ("parent_folder_id");
--> statement-breakpoint

-- 8. Replace the original job-only unique indexes with the scope-aware
--    versions defined in the Drizzle schema. The original indexes did not
--    filter on scope, so they would now incorrectly conflict with
--    resource-scoped folders that share a title. Depending on how the DB
--    was provisioned (drizzle-kit push vs. SQL migration), they may exist
--    either as a plain unique index or as a UNIQUE table constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"folders"'::regclass
       AND conname = 'folders_job_title_parent_media_unique'
  ) THEN
    ALTER TABLE "folders"
      DROP CONSTRAINT "folders_job_title_parent_media_unique";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = '"folders"'::regclass
       AND conname = 'folders_job_title_root_media_unique'
  ) THEN
    ALTER TABLE "folders"
      DROP CONSTRAINT "folders_job_title_root_media_unique";
  END IF;
END$$;
--> statement-breakpoint
DROP INDEX IF EXISTS "folders_job_title_parent_media_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "folders_job_title_root_media_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "folders_job_title_parent_media_unique"
  ON "folders" USING btree ("job_id","title","parent_folder_id","media_type")
  WHERE "deleted_at" IS NULL
    AND "scope" = 'job'
    AND "job_id" IS NOT NULL
    AND "parent_folder_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "folders_job_title_root_media_unique"
  ON "folders" USING btree ("job_id","title","media_type")
  WHERE "deleted_at" IS NULL
    AND "scope" = 'job'
    AND "job_id" IS NOT NULL
    AND "parent_folder_id" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "folders_resource_title_parent_media_unique"
  ON "folders" USING btree ("title","parent_folder_id","media_type")
  WHERE "deleted_at" IS NULL
    AND "scope" = 'resource'
    AND "job_id" IS NULL
    AND "parent_folder_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "folders_resource_title_root_media_unique"
  ON "folders" USING btree ("title","media_type")
  WHERE "deleted_at" IS NULL
    AND "scope" = 'resource'
    AND "job_id" IS NULL
    AND "parent_folder_id" IS NULL;
