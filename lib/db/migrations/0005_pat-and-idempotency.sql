-- Personal access tokens (PATs) for headless / agent authentication.
create table if not exists "personal_access_tokens" (
  "id" uuid primary key not null,
  "user_id" uuid not null references "users"("id") on delete cascade,
  "name" varchar(100) not null,
  "scope" varchar(32) not null default 'read_write',
  "token_hash" varchar(128) not null,
  "token_prefix" varchar(16) not null,
  "last_four" varchar(8) not null,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  constraint "personal_access_tokens_scope_check"
    check ("scope" in ('read', 'read_write'))
);

create unique index if not exists "personal_access_tokens_token_hash_unique"
  on "personal_access_tokens" ("token_hash");

create index if not exists "personal_access_tokens_user_id_idx"
  on "personal_access_tokens" ("user_id");

-- Idempotency keys for retry-safe writes (24h TTL enforced in app code).
create table if not exists "idempotency_keys" (
  "user_id" uuid not null references "users"("id") on delete cascade,
  "key" varchar(255) not null,
  "method" varchar(10) not null,
  "path" varchar(500) not null,
  "request_hash" varchar(128) not null,
  "status_code" integer not null,
  "response_body" text not null,
  "response_content_type" varchar(100) not null default 'application/json',
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone not null
);

create unique index if not exists "idempotency_keys_user_key_method_path_unique"
  on "idempotency_keys" ("user_id", "key", "method", "path");

create index if not exists "idempotency_keys_expires_at_idx"
  on "idempotency_keys" ("expires_at");
