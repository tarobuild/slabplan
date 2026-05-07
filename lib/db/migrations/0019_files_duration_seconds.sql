-- Task #368: Show video length in the Files > Videos browser.
--
-- Persist the video duration (in whole seconds) on the files row when
-- the client probes it during upload. Storing it once means the Files
-- > Videos grid/list can label every clip without re-decoding metadata
-- on every render. Nullable because (a) non-video files never have a
-- duration, (b) older rows uploaded before this column existed have
-- nothing to backfill from, and (c) the client probe legitimately
-- fails on some exotic codecs and we don't want to block the upload.
--
-- Idempotent: safe to re-apply.

alter table "files"
  add column if not exists "duration_seconds" integer;
