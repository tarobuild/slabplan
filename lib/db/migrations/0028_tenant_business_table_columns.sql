-- Stone Track SaaS tenant scoping: business-table organization_id columns.
--
-- This migration is behavior-neutral. It adds nullable organization_id
-- columns and indexes to tenant-owned tables, then backfills existing local
-- single-tenant rows to the deterministic legacy organization created by
-- 0027_tenant_foundation.sql.
--
-- Route-level writes and filters are intentionally handled in later slices.
-- The columns stay nullable until every create path stamps organization_id
-- server-side and cross-tenant tests prove the API is isolated.

DO $$
DECLARE
  table_name text;
  constraint_name text;
  index_name text;
  tenant_tables text[] := ARRAY[
    'clients',
    'client_contacts',
    'jobs',
    'job_assignees',
    'folders',
    'files',
    'leads',
    'lead_contacts',
    'lead_salespeople',
    'lead_tags',
    'lead_sources',
    'lead_attachments',
    'schedule_phases',
    'schedule_tag_settings',
    'schedule_items',
    'schedule_item_assignees',
    'schedule_item_notes',
    'schedule_item_attachments',
    'schedule_item_todos',
    'schedule_settings',
    'schedule_baselines',
    'schedule_workday_exception_categories',
    'schedule_workday_exceptions',
    'schedule_item_predecessors',
    'daily_logs',
    'daily_log_settings',
    'daily_log_custom_fields',
    'daily_log_attachments',
    'daily_log_tags',
    'daily_log_likes',
    'daily_log_comments',
    'daily_log_todos',
    'file_annotations',
    'personal_access_tokens',
    'idempotency_keys',
    'activity_log',
    'financial_trackers',
    'sov_areas',
    'sov_line_items',
    'change_orders',
    'tracker_invoices',
    'invoice_line_payments',
    'agent_conversations',
    'agent_messages',
    'agent_usage_monthly'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id uuid',
      table_name
    );

    constraint_name := left(table_name || '_organization_id_organizations_id_fk', 63);
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
        table_name,
        constraint_name
      );
    END IF;

    index_name := left(table_name || '_organization_id_idx', 63);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)',
      index_name,
      table_name
    );
  END LOOP;
END$$;
--> statement-breakpoint

INSERT INTO "organizations" (
  "id",
  "name",
  "slug",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'Legacy Workspace',
  'legacy-workspace',
  'active',
  now(),
  now()
WHERE EXISTS (SELECT 1 FROM "users")
   OR EXISTS (SELECT 1 FROM "clients")
   OR EXISTS (SELECT 1 FROM "jobs")
   OR EXISTS (SELECT 1 FROM "leads")
   OR EXISTS (SELECT 1 FROM "files")
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'clients',
    'client_contacts',
    'jobs',
    'job_assignees',
    'folders',
    'files',
    'leads',
    'lead_contacts',
    'lead_salespeople',
    'lead_tags',
    'lead_sources',
    'lead_attachments',
    'schedule_phases',
    'schedule_tag_settings',
    'schedule_items',
    'schedule_item_assignees',
    'schedule_item_notes',
    'schedule_item_attachments',
    'schedule_item_todos',
    'schedule_settings',
    'schedule_baselines',
    'schedule_workday_exception_categories',
    'schedule_workday_exceptions',
    'schedule_item_predecessors',
    'daily_logs',
    'daily_log_settings',
    'daily_log_custom_fields',
    'daily_log_attachments',
    'daily_log_tags',
    'daily_log_likes',
    'daily_log_comments',
    'daily_log_todos',
    'file_annotations',
    'personal_access_tokens',
    'idempotency_keys',
    'activity_log',
    'financial_trackers',
    'sov_areas',
    'sov_line_items',
    'change_orders',
    'tracker_invoices',
    'invoice_line_payments',
    'agent_conversations',
    'agent_messages',
    'agent_usage_monthly'
  ];
BEGIN
  IF EXISTS (
    SELECT 1 FROM "organizations"
     WHERE "id" = '00000000-0000-4000-8000-000000000001'::uuid
  ) THEN
    FOREACH table_name IN ARRAY tenant_tables LOOP
      EXECUTE format(
        'UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL',
        table_name
      )
      USING '00000000-0000-4000-8000-000000000001'::uuid;
    END LOOP;
  END IF;
END$$;
