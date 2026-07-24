ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_role_check";

ALTER TABLE "users"
  ADD CONSTRAINT "users_role_check"
  CHECK ("role" IN ('admin', 'project_manager', 'crew_member', 'drafter'));

ALTER TABLE "organization_memberships"
  DROP CONSTRAINT IF EXISTS "organization_memberships_role_check";

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_role_check"
  CHECK ("role" IN ('owner', 'admin', 'project_manager', 'crew_member', 'drafter'));
