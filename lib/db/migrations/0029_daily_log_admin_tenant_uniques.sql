-- Stone Track SaaS tenant scoping: daily-log admin settings uniqueness.
--
-- Daily-log settings and custom field names were global single-company
-- records. Multi-tenant SaaS needs one settings singleton per organization
-- and custom field names that are unique only inside that organization.

ALTER TABLE "daily_log_settings"
  DROP CONSTRAINT IF EXISTS "daily_log_settings_singleton_unique";
--> statement-breakpoint

DROP INDEX IF EXISTS "daily_log_settings_singleton_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "daily_log_settings_organization_singleton_unique"
  ON "daily_log_settings" ("organization_id", "singleton");
--> statement-breakpoint

ALTER TABLE "daily_log_custom_fields"
  DROP CONSTRAINT IF EXISTS "daily_log_custom_fields_name_unique";
--> statement-breakpoint

DROP INDEX IF EXISTS "daily_log_custom_fields_name_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "daily_log_custom_fields_organization_name_unique"
  ON "daily_log_custom_fields" ("organization_id", "name");
