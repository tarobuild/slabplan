ALTER TABLE "job_assignees"
  ADD COLUMN IF NOT EXISTS "can_create_daily_logs" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_upload_documents" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_upload_photos" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_upload_videos" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_create_folders" boolean NOT NULL DEFAULT false;
