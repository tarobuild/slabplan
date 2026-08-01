-- Grandfather existing workspaces while requiring paid access for new SlabPlan signups.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "requires_subscription" boolean NOT NULL DEFAULT false;
