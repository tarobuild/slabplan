-- Stop retaining raw invite/setup tokens in the database. Invite acceptance
-- already uses invite_token_hash, and new resend/reissue flows mint a fresh
-- one-time raw token for delivery instead of recovering a stored plaintext
-- value.
UPDATE users
SET invite_token = NULL
WHERE invite_token IS NOT NULL;
