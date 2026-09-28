-- Append-only account-security evidence. Identifiers intentionally have no
-- cascading foreign keys: account deletion must not erase incident evidence.
CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY,
  event varchar(100) NOT NULL,
  user_id uuid,
  organization_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_events_created_idx ON security_events(created_at);
CREATE INDEX IF NOT EXISTS security_events_user_created_idx ON security_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS security_events_org_created_idx ON security_events(organization_id, created_at);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON security_events FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON security_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON security_events FROM authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_security_event_history() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'UPDATE' OR OLD.created_at >= now() - interval '400 days' THEN
    RAISE EXCEPTION 'Security event history is append-only during retention';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER security_events_append_only
BEFORE UPDATE OR DELETE ON security_events
FOR EACH ROW EXECUTE FUNCTION protect_security_event_history();
