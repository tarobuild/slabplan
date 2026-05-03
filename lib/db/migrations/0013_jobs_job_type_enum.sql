-- Task #295: Replace freeform jobs.job_type with a fixed enum.
--
-- jobs.job_type was still a free-form varchar(100). The seed and the
-- create-job UI used a small fixed list ("Kitchen Countertops",
-- "Flooring", "Bathrooms", "Backsplash", "Full House Projects",
-- "Custom"), but anyone could insert anything (including casing
-- variants and typos), which broke filtering, dashboards, and the AR
-- rollups that group jobs by type.
--
-- This migration:
--   1. Normalises every existing jobs.job_type value to one of the
--      canonical lowercase enum values (or NULL when nothing maps).
--   2. Adds a CHECK constraint gating future inserts/updates, in the
--      same shape as jobs_contract_type_check from 0012.
--
-- Idempotent: safe to re-apply.

DO $$
BEGIN
  IF to_regclass('jobs') IS NULL THEN
    RETURN;
  END IF;

  -- 1. Normalise existing values to the canonical enum. Done with a
  --    single CASE on lower(trim(...)) so casing/whitespace variants
  --    of the same intent collapse to one row. Anything we don't
  --    recognise is reset to NULL — the column is nullable and "no
  --    type recorded" is safer than carrying a typo into the new
  --    constraint.
  UPDATE "jobs"
     SET "job_type" = CASE lower(trim("job_type"))
       WHEN 'kitchen_countertops' THEN 'kitchen_countertops'
       WHEN 'kitchen countertops' THEN 'kitchen_countertops'
       WHEN 'countertops'         THEN 'kitchen_countertops'
       WHEN 'countertop'          THEN 'kitchen_countertops'
       WHEN 'kitchen'             THEN 'kitchen_countertops'
       WHEN 'flooring'            THEN 'flooring'
       WHEN 'floor'               THEN 'flooring'
       WHEN 'floors'              THEN 'flooring'
       WHEN 'bathrooms'           THEN 'bathrooms'
       WHEN 'bathroom'            THEN 'bathrooms'
       WHEN 'bath'                THEN 'bathrooms'
       WHEN 'master bath'         THEN 'bathrooms'
       WHEN 'backsplash'          THEN 'backsplash'
       WHEN 'backsplashes'        THEN 'backsplash'
       WHEN 'full_house_project'  THEN 'full_house_project'
       WHEN 'full house project'  THEN 'full_house_project'
       WHEN 'full house projects' THEN 'full_house_project'
       WHEN 'full house'          THEN 'full_house_project'
       WHEN 'custom'              THEN 'custom'
       ELSE NULL
     END
   WHERE "job_type" IS NOT NULL;

  -- 2. Gate future writes with a CHECK constraint. Mirrors the shape
  --    of jobs_contract_type_check added in 0012.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_job_type_check'
       AND conrelid = 'jobs'::regclass
  ) THEN
    ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_job_type_check"
      CHECK (
        "job_type" IS NULL
        OR "job_type" IN (
          'kitchen_countertops',
          'bathrooms',
          'flooring',
          'backsplash',
          'full_house_project',
          'custom'
        )
      );
  END IF;
END$$;
