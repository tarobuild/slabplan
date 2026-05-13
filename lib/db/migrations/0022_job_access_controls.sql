-- Task: Per-job access controls.
--
-- Adds feature-level permissions to job assignees so admins can decide which
-- project managers and crew members can see financials, documents, photos,
-- videos, daily logs, schedule, and the in-app assistant for each job.

ALTER TABLE "job_assignees"
  ADD COLUMN IF NOT EXISTS "can_view_financials" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_view_documents" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_view_photos" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_view_videos" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_view_daily_logs" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_view_schedule" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_use_assistant" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

UPDATE "job_assignees" ja
   SET "can_view_financials" = true,
       "can_view_documents" = true,
       "can_view_photos" = true,
       "can_view_videos" = true,
       "can_view_daily_logs" = true,
       "can_view_schedule" = true,
       "can_use_assistant" = true
  FROM "users" u
 WHERE u."id" = ja."user_id"
   AND u."role" = 'project_manager';
