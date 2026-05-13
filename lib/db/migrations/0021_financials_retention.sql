-- Task: Financial tracker retention support.
--
-- Adds project-level retention settings and invoice-level gross/held/net
-- amounts. Existing invoices are backfilled so retention-off projects keep
-- the previous behavior: total_cents remains gross billed and net paid.

ALTER TABLE "financial_trackers"
  ADD COLUMN IF NOT EXISTS "retention_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "retention_rate_bps" integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS "retention_released_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "retention_released_by" uuid;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_trackers_retention_released_by_fkey') THEN
    ALTER TABLE "financial_trackers" ADD CONSTRAINT "financial_trackers_retention_released_by_fkey"
      FOREIGN KEY ("retention_released_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_trackers_retention_rate_range') THEN
    ALTER TABLE "financial_trackers" ADD CONSTRAINT "financial_trackers_retention_rate_range"
      CHECK ("retention_rate_bps" >= 0 AND "retention_rate_bps" <= 10000);
  END IF;
END$$;
--> statement-breakpoint

ALTER TABLE "tracker_invoices"
  ADD COLUMN IF NOT EXISTS "retention_held_cents" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "net_paid_cents" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint

UPDATE "tracker_invoices"
   SET "net_paid_cents" = "total_cents"
 WHERE "net_paid_cents" = 0
   AND "retention_held_cents" = 0
   AND "total_cents" <> 0;
