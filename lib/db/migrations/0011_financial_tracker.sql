-- Task #269: Financial Tracker (Schedule of Values) per job + AR rollup.
--
-- Adds the per-job financial tracker tables. Fully idempotent.

-- 1. financial_trackers (1:1 with jobs) ------------------------------------
CREATE TABLE IF NOT EXISTS "financial_trackers" (
  "id" uuid PRIMARY KEY,
  "job_id" uuid NOT NULL,
  "project_name" varchar(255),
  "contract_date" date,
  "currency" varchar(8) NOT NULL DEFAULT 'USD',
  "raw_estimate_response" json,
  "estimate_file_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_trackers_job_id_fkey') THEN
    ALTER TABLE "financial_trackers" ADD CONSTRAINT "financial_trackers_job_id_fkey"
      FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_trackers_estimate_file_id_fkey') THEN
    ALTER TABLE "financial_trackers" ADD CONSTRAINT "financial_trackers_estimate_file_id_fkey"
      FOREIGN KEY ("estimate_file_id") REFERENCES "files"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_trackers_created_by_fkey') THEN
    ALTER TABLE "financial_trackers" ADD CONSTRAINT "financial_trackers_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END$$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "financial_trackers_job_id_unique" ON "financial_trackers" ("job_id");
--> statement-breakpoint

-- 2. sov_areas -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sov_areas" (
  "id" uuid PRIMARY KEY,
  "tracker_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "floor" varchar(100),
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_change_order_group" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sov_areas_tracker_id_fkey') THEN
    ALTER TABLE "sov_areas" ADD CONSTRAINT "sov_areas_tracker_id_fkey"
      FOREIGN KEY ("tracker_id") REFERENCES "financial_trackers"("id") ON DELETE CASCADE;
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sov_areas_tracker_id_idx" ON "sov_areas" ("tracker_id");
--> statement-breakpoint

-- 3. sov_line_items --------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sov_line_items" (
  "id" uuid PRIMARY KEY,
  "area_id" uuid NOT NULL,
  "description" text NOT NULL,
  "qty" numeric(12,3) NOT NULL DEFAULT 1,
  "rate_cents" bigint NOT NULL DEFAULT 0,
  "scheduled_value_cents" bigint NOT NULL DEFAULT 0,
  "billed_cents" bigint NOT NULL DEFAULT 0,
  "percent_complete" numeric(5,2) NOT NULL DEFAULT 0,
  "is_removed" boolean NOT NULL DEFAULT false,
  "is_change_order" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sov_line_items_area_id_fkey') THEN
    ALTER TABLE "sov_line_items" ADD CONSTRAINT "sov_line_items_area_id_fkey"
      FOREIGN KEY ("area_id") REFERENCES "sov_areas"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sov_line_items_percent_range') THEN
    ALTER TABLE "sov_line_items" ADD CONSTRAINT "sov_line_items_percent_range"
      CHECK ("percent_complete" >= 0 AND "percent_complete" <= 100);
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sov_line_items_area_id_idx" ON "sov_line_items" ("area_id");
--> statement-breakpoint

-- 4. change_orders ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "change_orders" (
  "id" uuid PRIMARY KEY,
  "tracker_id" uuid NOT NULL,
  "number" varchar(64) NOT NULL,
  "description" text,
  "amount_cents" bigint NOT NULL DEFAULT 0,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "area_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'change_orders_tracker_id_fkey') THEN
    ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_tracker_id_fkey"
      FOREIGN KEY ("tracker_id") REFERENCES "financial_trackers"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'change_orders_area_id_fkey') THEN
    ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_area_id_fkey"
      FOREIGN KEY ("area_id") REFERENCES "sov_areas"("id") ON DELETE SET NULL;
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "change_orders_tracker_id_idx" ON "change_orders" ("tracker_id");
--> statement-breakpoint

-- 5. tracker_invoices ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tracker_invoices" (
  "id" uuid PRIMARY KEY,
  "tracker_id" uuid NOT NULL,
  "invoice_number" varchar(128),
  "invoice_date" date,
  "total_cents" bigint NOT NULL DEFAULT 0,
  "file_id" uuid,
  "raw_ai_response" json,
  "applied_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_invoices_tracker_id_fkey') THEN
    ALTER TABLE "tracker_invoices" ADD CONSTRAINT "tracker_invoices_tracker_id_fkey"
      FOREIGN KEY ("tracker_id") REFERENCES "financial_trackers"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_invoices_file_id_fkey') THEN
    ALTER TABLE "tracker_invoices" ADD CONSTRAINT "tracker_invoices_file_id_fkey"
      FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracker_invoices_created_by_fkey') THEN
    ALTER TABLE "tracker_invoices" ADD CONSTRAINT "tracker_invoices_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tracker_invoices_tracker_id_idx" ON "tracker_invoices" ("tracker_id");
--> statement-breakpoint

-- 6. invoice_line_payments -------------------------------------------------
CREATE TABLE IF NOT EXISTS "invoice_line_payments" (
  "id" uuid PRIMARY KEY,
  "invoice_id" uuid NOT NULL,
  "line_item_id" uuid NOT NULL,
  "amount_cents" bigint NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_line_payments_invoice_id_fkey') THEN
    ALTER TABLE "invoice_line_payments" ADD CONSTRAINT "invoice_line_payments_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "tracker_invoices"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_line_payments_line_item_id_fkey') THEN
    ALTER TABLE "invoice_line_payments" ADD CONSTRAINT "invoice_line_payments_line_item_id_fkey"
      FOREIGN KEY ("line_item_id") REFERENCES "sov_line_items"("id") ON DELETE CASCADE;
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoice_line_payments_invoice_id_idx" ON "invoice_line_payments" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_payments_line_item_id_idx" ON "invoice_line_payments" ("line_item_id");
