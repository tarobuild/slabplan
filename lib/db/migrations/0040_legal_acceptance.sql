-- Record the legal documents each user accepted when creating or activating
-- an account. Existing internal accounts remain nullable and can be migrated
-- through a future in-app re-consent flow if document versions materially change.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "terms_version" varchar(50),
  ADD COLUMN IF NOT EXISTS "privacy_accepted_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "privacy_version" varchar(50);
