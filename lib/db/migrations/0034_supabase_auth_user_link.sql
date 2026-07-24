alter table users
  add column if not exists supabase_auth_user_id uuid;

create unique index if not exists users_supabase_auth_user_id_unique
  on users (supabase_auth_user_id)
  where supabase_auth_user_id is not null;
