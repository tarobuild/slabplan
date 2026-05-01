-- Schema-vs-migration audit alignment (task #255).
--
-- The Drizzle schema in `lib/db/src/schema/{index,agent}.ts` had drifted
-- away from the SQL migrations in `lib/db/migrations/` for several
-- features besides folders. The four substantive gaps detected by diffing
-- a freshly migrated DB against `drizzle-kit push` of the schema are:
--
--   1. The `job_assignees` table (job ↔ user join table; required by
--      schedule visibility and notification tests).
--   2. The `file_annotations` table (PDF/photo annotations).
--   3. `files.note` (per-file uploader note).
--   4. `schedule_items.is_personal_todo` (personal-todo flag, required
--      by the personal-todo isolation feature).
--   5. `daily_log_settings_singleton_check` CHECK constraint that pins
--      the singleton row to `true` (the unique index alone allows two
--      rows with `singleton = false`/`true`).
--
-- The script is fully idempotent so it is safe to re-apply against
-- databases that have been hand-patched or had `drizzle-kit push` run
-- against them at any point.

-- 1. job_assignees ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "job_assignees" (
  "id" uuid PRIMARY KEY NOT NULL,
  "job_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'job_assignees_job_id_jobs_id_fk'
  ) THEN
    ALTER TABLE "job_assignees"
      ADD CONSTRAINT "job_assignees_job_id_jobs_id_fk"
      FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'job_assignees_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "job_assignees"
      ADD CONSTRAINT "job_assignees_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'job_assignees_job_user_unique'
  ) THEN
    ALTER TABLE "job_assignees"
      ADD CONSTRAINT "job_assignees_job_user_unique"
      UNIQUE ("job_id", "user_id");
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "job_assignees_job_id_idx"
  ON "job_assignees" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_assignees_user_id_idx"
  ON "job_assignees" USING btree ("user_id");
--> statement-breakpoint

-- 2. file_annotations -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "file_annotations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "file_id" uuid NOT NULL,
  "page" integer NOT NULL,
  "tool_type" varchar(50) NOT NULL,
  "color" varchar(50) DEFAULT '#facc15' NOT NULL,
  "thickness" numeric(6, 3) DEFAULT '2',
  "opacity" numeric(4, 3) DEFAULT '1',
  "normalized_x" numeric(10, 8) NOT NULL,
  "normalized_y" numeric(10, 8) NOT NULL,
  "normalized_w" numeric(10, 8) DEFAULT '0' NOT NULL,
  "normalized_h" numeric(10, 8) DEFAULT '0' NOT NULL,
  "content" text,
  "path_data" json,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_annotations_file_id_files_id_fk'
  ) THEN
    ALTER TABLE "file_annotations"
      ADD CONSTRAINT "file_annotations_file_id_files_id_fk"
      FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_annotations_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "file_annotations"
      ADD CONSTRAINT "file_annotations_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_annotations_tool_type_check'
  ) THEN
    ALTER TABLE "file_annotations"
      ADD CONSTRAINT "file_annotations_tool_type_check"
      CHECK ("tool_type" in (
        'highlighter','pen','line','arrow','rectangle','ellipse',
        'sticky_note','text_label'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'file_annotations_page_positive'
  ) THEN
    ALTER TABLE "file_annotations"
      ADD CONSTRAINT "file_annotations_page_positive"
      CHECK ("page" >= 1);
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "file_annotations_file_id_page_idx"
  ON "file_annotations" USING btree ("file_id", "page");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_annotations_created_by_idx"
  ON "file_annotations" USING btree ("created_by");
--> statement-breakpoint

-- 3. files.note -------------------------------------------------------------
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "note" text;
--> statement-breakpoint

-- 4. schedule_items.is_personal_todo ---------------------------------------
ALTER TABLE "schedule_items"
  ADD COLUMN IF NOT EXISTS "is_personal_todo" boolean DEFAULT false;
--> statement-breakpoint

-- 5. daily_log_settings_singleton_check ------------------------------------
-- Normalise any pre-existing rows so that adding the CHECK cannot fail
-- against a hand-patched / legacy database where the column may be
-- false or null. The schema only ever expects `singleton = true`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'daily_log_settings'
       AND column_name = 'singleton'
  ) THEN
    UPDATE "daily_log_settings"
       SET "singleton" = true
     WHERE "singleton" IS DISTINCT FROM true;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'daily_log_settings_singleton_check'
    ) THEN
      ALTER TABLE "daily_log_settings"
        ADD CONSTRAINT "daily_log_settings_singleton_check"
        CHECK ("singleton" = true);
    END IF;
  END IF;
END$$;
