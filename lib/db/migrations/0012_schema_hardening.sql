-- Task #290: Database schema hardening — cascades, CHECK constraints,
-- and tighter NOT NULL guards.
--
-- Closes the gap between TypeScript-enforced invariants and what the
-- database actually allows. Every step is fully idempotent so it is
-- safe to re-apply.
--
-- The migration always backfills/scrubs offending rows BEFORE adding
-- the constraint, so the constraint can never be added against a
-- violating row.

-- 1. financial_trackers.job_id — guarantee ON DELETE CASCADE ----------------
-- Earlier revisions of this column shipped with ON DELETE SET NULL, which
-- could leave orphaned trackers (and their child SOV areas / line items /
-- invoices / payments) behind when a job was hard-deleted. Force-drop
-- whichever variant is currently registered and re-add it as CASCADE.
DO $$
DECLARE
  conname_existing text;
BEGIN
  IF to_regclass('financial_trackers') IS NULL THEN
    RETURN;
  END IF;

  -- Delete any pre-existing orphans before tightening the column to
  -- NOT NULL / cascade so the constraint add cannot fail.
  DELETE FROM "financial_trackers" WHERE "job_id" IS NULL;

  SELECT conname INTO conname_existing
    FROM pg_constraint
   WHERE conrelid = 'financial_trackers'::regclass
     AND contype = 'f'
     AND conname IN (
       'financial_trackers_job_id_fkey',
       'financial_trackers_job_id_jobs_id_fk'
     )
   LIMIT 1;

  IF conname_existing IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE "financial_trackers" DROP CONSTRAINT %I',
      conname_existing
    );
  END IF;

  ALTER TABLE "financial_trackers"
    ADD CONSTRAINT "financial_trackers_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE;

  ALTER TABLE "financial_trackers"
    ALTER COLUMN "job_id" SET NOT NULL;
END$$;
--> statement-breakpoint

-- 2. jobs.contract_type CHECK ----------------------------------------------
-- contract_type stays nullable (lots of legacy rows). The CHECK gates
-- future inserts/updates to the two known enum values.
DO $$
BEGIN
  IF to_regclass('jobs') IS NULL THEN
    RETURN;
  END IF;

  -- Scrub anything that doesn't fit the enum to NULL, since the column
  -- is nullable and "unknown" is the safest default.
  UPDATE "jobs"
     SET "contract_type" = NULL
   WHERE "contract_type" IS NOT NULL
     AND "contract_type" NOT IN ('fixed_price', 'open_book');

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_contract_type_check'
       AND conrelid = 'jobs'::regclass
  ) THEN
    ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_contract_type_check"
      CHECK (
        "contract_type" IS NULL
        OR "contract_type" IN ('fixed_price', 'open_book')
      );
  END IF;
END$$;
--> statement-breakpoint

-- 3. folders.media_type CHECK ----------------------------------------------
DO $$
BEGIN
  IF to_regclass('folders') IS NULL THEN
    RETURN;
  END IF;

  -- Force any unknown media_type values to 'document' (the safest
  -- catch-all for the file browser) so the CHECK can be added.
  UPDATE "folders"
     SET "media_type" = 'document'
   WHERE "media_type" IS NULL
      OR "media_type" NOT IN ('document', 'photo', 'video');

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'folders_media_type_check'
       AND conrelid = 'folders'::regclass
  ) THEN
    ALTER TABLE "folders"
      ADD CONSTRAINT "folders_media_type_check"
      CHECK ("media_type" IN ('document', 'photo', 'video'));
  END IF;
END$$;
--> statement-breakpoint

-- 4. agent_messages.stopped_reason CHECK -----------------------------------
-- The orchestrator persists either an Anthropic SDK stop_reason
-- ('end_turn', 'max_tokens', 'stop_sequence', 'tool_use',
--  'pause_turn', 'refusal') or one of our own sentinels ('aborted',
-- 'api_error', 'max_iterations'). The OpenAI-style values
-- ('length', 'content_filter', 'tool_calls', 'error') from the task
-- description are also tolerated for forward compatibility.
DO $$
BEGIN
  IF to_regclass('agent_messages') IS NULL THEN
    RETURN;
  END IF;

  -- Null out anything that doesn't match the allowed set so the CHECK
  -- can be added without rejecting historical rows.
  UPDATE "agent_messages"
     SET "stopped_reason" = NULL
   WHERE "stopped_reason" IS NOT NULL
     AND "stopped_reason" NOT IN (
       'end_turn', 'max_tokens', 'stop_sequence', 'tool_use',
       'pause_turn', 'refusal',
       'aborted', 'api_error', 'max_iterations',
       'length', 'content_filter', 'tool_calls', 'error'
     );

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agent_messages_stopped_reason_check'
       AND conrelid = 'agent_messages'::regclass
  ) THEN
    ALTER TABLE "agent_messages"
      ADD CONSTRAINT "agent_messages_stopped_reason_check"
      CHECK (
        "stopped_reason" IS NULL
        OR "stopped_reason" IN (
          'end_turn', 'max_tokens', 'stop_sequence', 'tool_use',
          'pause_turn', 'refusal',
          'aborted', 'api_error', 'max_iterations',
          'length', 'content_filter', 'tool_calls', 'error'
        )
      );
  END IF;
END$$;
--> statement-breakpoint

-- 5. client_contacts — at least one of first_name / last_name --------------
DO $$
BEGIN
  IF to_regclass('client_contacts') IS NULL THEN
    RETURN;
  END IF;

  -- Backfill nameless rows with a deterministic placeholder rather
  -- than deleting them, so any FK pointers (none today, but cheap
  -- insurance) keep working.
  UPDATE "client_contacts"
     SET "first_name" = 'Unknown'
   WHERE ("first_name" IS NULL OR "first_name" = '')
     AND ("last_name"  IS NULL OR "last_name"  = '');

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'client_contacts_name_present_check'
       AND conrelid = 'client_contacts'::regclass
  ) THEN
    ALTER TABLE "client_contacts"
      ADD CONSTRAINT "client_contacts_name_present_check"
      CHECK ("first_name" IS NOT NULL OR "last_name" IS NOT NULL);
  END IF;
END$$;
