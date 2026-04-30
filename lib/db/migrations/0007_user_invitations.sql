-- Admin-driven invitation flow for new users.
--
-- Adds:
--   * is_active                    — soft on/off switch (separate from
--                                    deleted_at, which is irreversible
--                                    soft-delete and hides users from listings).
--   * invite_token_hash            — sha256(hex) of the one-time setup token
--                                    handed off in person; raw token is never
--                                    persisted server-side.
--   * invite_token_expires_at      — absolute expiry of that token.
--   * password_set_at              — null while a user has only the random
--                                    placeholder password generated at invite
--                                    time, set when they accept the invite.
--
-- The cadstone/anwar seed users (and any user created via the legacy
-- /auth/register endpoint) already have a real password, so we backfill
-- password_set_at to created_at for every existing row.

alter table "users"
  add column if not exists "is_active" boolean not null default true,
  add column if not exists "invite_token_hash" varchar(64),
  add column if not exists "invite_token_expires_at" timestamp with time zone,
  add column if not exists "password_set_at" timestamp with time zone;

update "users"
  set "password_set_at" = coalesce("password_set_at", "created_at");

create index if not exists "users_invite_token_hash_idx"
  on "users" ("invite_token_hash");
