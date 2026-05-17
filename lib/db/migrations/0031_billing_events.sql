-- Stores signed billing provider events for idempotent webhook processing.

CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" varchar(255) PRIMARY KEY,
  "provider" varchar(50) NOT NULL DEFAULT 'stripe',
  "type" varchar(255) NOT NULL,
  "livemode" boolean NOT NULL DEFAULT false,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "billing_events_provider_type_idx"
  ON "billing_events" ("provider", "type");

CREATE INDEX IF NOT EXISTS "billing_events_processed_at_idx"
  ON "billing_events" ("processed_at");
