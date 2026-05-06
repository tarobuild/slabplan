-- Task #322: Admin Reports — supporting indexes for date-anchored aggregates.
--
-- The reports surface (artifacts/api-server/src/routes/reports.ts) runs
-- single-SQL aggregates over `tracker_invoices` and `invoice_line_payments`
-- joined to `financial_trackers → jobs → clients`. The two columns we
-- date-filter on most are `tracker_invoices.invoice_date` (Revenue by
-- Month, Days to Payment) and `tracker_invoices.applied_at` (Days to
-- Payment), plus `invoice_line_payments.created_at` (Revenue collected).
-- Add btree indexes so range scans don't degrade to seq scans as invoice
-- volume grows.
--
-- Idempotent: safe to re-apply.

CREATE INDEX IF NOT EXISTS "tracker_invoices_invoice_date_idx"
  ON "tracker_invoices" ("invoice_date");

CREATE INDEX IF NOT EXISTS "tracker_invoices_applied_at_idx"
  ON "tracker_invoices" ("applied_at");

CREATE INDEX IF NOT EXISTS "invoice_line_payments_created_at_idx"
  ON "invoice_line_payments" ("created_at");
