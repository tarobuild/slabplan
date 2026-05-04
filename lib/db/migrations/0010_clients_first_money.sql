-- Task #268: Clients-first restructure + AR money fields.
--
-- 1. Adds `contract_value_cents` and `amount_paid_cents` (bigint, nullable)
--    columns to `jobs` for AR rollups by client.
-- 2. Adds a CHECK constraint enforcing `amount_paid_cents <= contract_value_cents`
--    when both are non-null (matches Drizzle schema).
-- 3. Inserts a deterministic "Unknown client" placeholder so jobs that
--    previously had `client_id = NULL` can be backfilled to a real client
--    (the API enforces a non-null client_id for new jobs going forward).
-- 4. Backfills any existing `jobs.client_id IS NULL` rows to point at the
--    placeholder. The DB column itself stays nullable to preserve the
--    drift-free schema match.
--
-- Fully idempotent: safe to re-apply.

-- 1. Money columns ----------------------------------------------------------
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "contract_value_cents" bigint;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "amount_paid_cents" bigint;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_amount_paid_lte_contract_check'
  ) THEN
    ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_amount_paid_lte_contract_check"
      CHECK (
        "amount_paid_cents" IS NULL
        OR "contract_value_cents" IS NULL
        OR "amount_paid_cents" <= "contract_value_cents"
      );
  END IF;
END$$;
--> statement-breakpoint

-- 2. "Unknown client" placeholder ------------------------------------------
-- Deterministic UUIDv5 derived from `cadstone:unknown-client` in the standard
-- DNS namespace, so every environment ends up with the exact same id and
-- subsequent migrations can reference it without lookup juggling. SAST
-- scanners flag it as a "Generic API Key" because of the entropy of the
-- hex string; it is a row id, not a credential. Suppressed below.
-- hounddog-ignore: hardcoded-secret
-- nosemgrep: vendored-rules.generic.secrets.gitleaks.generic-api-key
INSERT INTO "clients" ("id", "company_name", "notes", "created_at", "updated_at")
VALUES (
  -- nosemgrep: vendored-rules.generic.secrets.gitleaks.generic-api-key
  '8bdd2d52-7563-5843-95f8-aea786f0b386',
  'Unknown client',
  'System placeholder created during the Clients-first migration (Task #268). Re-assign legacy jobs to their real client when known.',
  now(),
  now()
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- 3. Backfill orphan jobs --------------------------------------------------
-- Same UNKNOWN_CLIENT_ID sentinel as the INSERT above; not a secret.
-- hounddog-ignore: hardcoded-secret
-- nosemgrep: vendored-rules.generic.secrets.gitleaks.generic-api-key
UPDATE "jobs"
   -- nosemgrep: vendored-rules.generic.secrets.gitleaks.generic-api-key
   SET "client_id" = '8bdd2d52-7563-5843-95f8-aea786f0b386',
       "updated_at" = now()
 WHERE "client_id" IS NULL
;
