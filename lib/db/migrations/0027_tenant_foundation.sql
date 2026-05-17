-- Stone Track SaaS tenant foundation.
--
-- Adds first-class organizations and memberships without changing route
-- behavior yet. Existing single-tenant data is assigned to one deterministic
-- legacy organization only when the database already has users. Empty new
-- SaaS databases stay empty until onboarding creates the first tenant.
--
-- This is intentionally a foundation migration:
--   1. Create organizations.
--   2. Link users to their default organization.
--   3. Backfill memberships for existing users.
--
-- Business tables will receive organization_id columns in the next migration
-- before API routes start filtering by tenant.

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "slug" varchar(120) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'trialing',
  "billing_email" varchar(255),
  "plan_key" varchar(100),
  "subscription_status" varchar(100),
  "stripe_customer_id" varchar(255),
  "stripe_subscription_id" varchar(255),
  "trial_ends_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_unique"
  ON "organizations" ("slug")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organizations_status_idx"
  ON "organizations" ("status");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organizations_status_check'
  ) THEN
    ALTER TABLE "organizations"
      ADD CONSTRAINT "organizations_status_check"
      CHECK ("status" in ('active', 'trialing', 'suspended', 'archived'));
  END IF;
END$$;
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "default_organization_id" uuid;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_default_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_default_organization_id_organizations_id_fk"
      FOREIGN KEY ("default_organization_id")
      REFERENCES "organizations"("id")
      ON DELETE SET NULL;
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_default_organization_id_idx"
  ON "users" ("default_organization_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" varchar(50) NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "invited_by" uuid,
  "joined_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organization_memberships_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "organization_memberships"
      ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk"
      FOREIGN KEY ("organization_id")
      REFERENCES "organizations"("id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organization_memberships_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "organization_memberships"
      ADD CONSTRAINT "organization_memberships_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organization_memberships_invited_by_users_id_fk'
  ) THEN
    ALTER TABLE "organization_memberships"
      ADD CONSTRAINT "organization_memberships_invited_by_users_id_fk"
      FOREIGN KEY ("invited_by")
      REFERENCES "users"("id")
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organization_memberships_role_check'
  ) THEN
    ALTER TABLE "organization_memberships"
      ADD CONSTRAINT "organization_memberships_role_check"
      CHECK ("role" in ('owner', 'admin', 'project_manager', 'crew_member'));
  END IF;
END$$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_org_user_unique"
  ON "organization_memberships" ("organization_id", "user_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_memberships_user_id_idx"
  ON "organization_memberships" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_memberships_organization_id_idx"
  ON "organization_memberships" ("organization_id");
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
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

UPDATE "users"
   SET "default_organization_id" = '00000000-0000-4000-8000-000000000001'::uuid,
       "updated_at" = now()
 WHERE "default_organization_id" IS NULL
   AND EXISTS (
     SELECT 1 FROM "organizations"
      WHERE "id" = '00000000-0000-4000-8000-000000000001'::uuid
   );
--> statement-breakpoint

INSERT INTO "organization_memberships" (
  "id",
  "organization_id",
  "user_id",
  "role",
  "is_default",
  "joined_at",
  "created_at",
  "updated_at"
)
SELECT
  "users"."id",
  '00000000-0000-4000-8000-000000000001'::uuid,
  "users"."id",
  CASE
    WHEN "users"."role" = 'admin' THEN 'owner'
    WHEN "users"."role" = 'project_manager' THEN 'project_manager'
    ELSE 'crew_member'
  END,
  true,
  now(),
  now(),
  now()
FROM "users"
WHERE "users"."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "organizations"
     WHERE "id" = '00000000-0000-4000-8000-000000000001'::uuid
  )
ON CONFLICT DO NOTHING;
