-- Task: Simplify job access controls.
--
-- Keep a single per-assignee financials grant. Field access to files is
-- controlled by folder viewing/uploading permissions, including per-user
-- overrides, so the feature-level job permission matrix is no longer needed.

ALTER TABLE "job_assignees"
  ADD COLUMN IF NOT EXISTS "can_view_financials" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "job_assignees"
  DROP COLUMN IF EXISTS "can_view_documents",
  DROP COLUMN IF EXISTS "can_view_photos",
  DROP COLUMN IF EXISTS "can_view_videos",
  DROP COLUMN IF EXISTS "can_view_daily_logs",
  DROP COLUMN IF EXISTS "can_view_schedule",
  DROP COLUMN IF EXISTS "can_use_assistant",
  DROP COLUMN IF EXISTS "can_create_daily_logs",
  DROP COLUMN IF EXISTS "can_upload_documents",
  DROP COLUMN IF EXISTS "can_upload_photos",
  DROP COLUMN IF EXISTS "can_upload_videos",
  DROP COLUMN IF EXISTS "can_create_folders";
