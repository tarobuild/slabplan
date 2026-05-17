-- Stone Track SaaS tenant scoping: AI assistant usage uniqueness.
--
-- A user can belong to multiple organizations, so monthly assistant usage
-- must be bucketed by organization + user + month. Keep a legacy null-org
-- uniqueness path for local/dev rows that predate organization context.

ALTER TABLE "agent_usage_monthly"
  DROP CONSTRAINT IF EXISTS "agent_usage_monthly_user_month_unique";
--> statement-breakpoint

DROP INDEX IF EXISTS "agent_usage_monthly_user_month_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_usage_monthly_org_user_month_unique"
  ON "agent_usage_monthly" ("organization_id", "user_id", "year_month")
  WHERE "organization_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_usage_monthly_legacy_user_month_unique"
  ON "agent_usage_monthly" ("user_id", "year_month")
  WHERE "organization_id" IS NULL;
