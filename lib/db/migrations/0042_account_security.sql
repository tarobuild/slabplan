-- Additive rollout: historical accounts are not marked verified without evidence.
-- New self-service workspaces require email verification and owner MFA in code.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verification_hash varchar(64),
  ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS mfa_pending_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_last_step integer,
  ADD COLUMN IF NOT EXISTS mfa_recovery_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS security_challenge_hash varchar(64),
  ADD COLUMN IF NOT EXISTS security_challenge_kind varchar(20),
  ADD COLUMN IF NOT EXISTS security_challenge_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS security_challenge_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS security_challenge_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_verification_hash_idx
  ON users(email_verification_hash) WHERE email_verification_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_security_challenge_hash_idx
  ON users(security_challenge_hash) WHERE security_challenge_hash IS NOT NULL;
