-- Task #297: Allow 'qualified' as a valid leads.status value.
--
-- The Drizzle schema for `leads.status` was extended to include
-- 'qualified' (in addition to 'open', 'in_negotiation', 'won', 'lost',
-- 'archived'), but the `leads_status_check` CHECK constraint in the
-- baseline migration only accepts the original five values. Production
-- databases migrated via the migration runner therefore reject inserts
-- and updates with status='qualified'. This migration drops and
-- recreates the constraint to match the schema.
--
-- Idempotent: safe to re-apply.

alter table "leads" drop constraint if exists "leads_status_check";

alter table "leads"
  add constraint "leads_status_check"
  check ("status" in ('open', 'in_negotiation', 'won', 'lost', 'archived', 'qualified'));
