-- Task #309: Allow admins to re-send the existing invite email without
-- minting a new token.
--
-- Until now we only persisted the sha256 hash of the invite token, which
-- meant we could never re-derive the raw token to put back in an email
-- body. To support a true "resend" affordance (one that does NOT
-- invalidate links that may already be in flight), we now also retain the
-- raw token server-side for the lifetime of the invite. The token is
-- cleared as soon as it's accepted (see auth.ts), so the plaintext value
-- only lives on the row while a setup link is genuinely outstanding.
--
-- Idempotent: safe to re-apply.

alter table "users"
  add column if not exists "invite_token" varchar(128);
