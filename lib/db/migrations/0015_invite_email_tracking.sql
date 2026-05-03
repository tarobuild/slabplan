-- Task #301: Track transactional invite email delivery on the user row.
--
-- The invite/reissue flows previously returned a one-time setup link to
-- the admin and required them to copy/paste it out of band. We now wire
-- a transactional email provider (Resend) so the link is mailed
-- automatically. To give admins visibility into what actually went out,
-- record the timestamp and any provider error string per user.
--
-- Both columns are nullable: NULL means "no email was ever attempted
-- for the current invite token". When an email succeeds, last_invite_email_sent_at
-- is set and last_invite_email_error is cleared. On failure we set the
-- error string so the admin UI can surface it next to the affordance to
-- copy the link manually as a fallback.
--
-- Idempotent: safe to re-apply.

alter table "users"
  add column if not exists "last_invite_email_sent_at" timestamp with time zone,
  add column if not exists "last_invite_email_error" varchar(500);
