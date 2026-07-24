CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "recipient_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "entity_type" varchar(100) NOT NULL,
  "entity_id" uuid,
  "action" varchar(100) NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text,
  "url" varchar(1000),
  "metadata" json,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notifications_org_recipient_created_at_idx"
  ON "notifications" ("organization_id", "recipient_user_id", "created_at");

CREATE INDEX IF NOT EXISTS "notifications_org_recipient_read_at_idx"
  ON "notifications" ("organization_id", "recipient_user_id", "read_at");
