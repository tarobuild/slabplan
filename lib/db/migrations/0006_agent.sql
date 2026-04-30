-- In-app AI agent: persistent conversations, messages and per-user monthly usage.
create table if not exists "agent_conversations" (
  "id" uuid primary key not null,
  "user_id" uuid not null references "users"("id") on delete cascade,
  "title" varchar(255) not null default 'New conversation',
  "pinned" boolean not null default false,
  "last_message_at" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create index if not exists "agent_conversations_user_id_idx"
  on "agent_conversations" ("user_id");

create index if not exists "agent_conversations_user_last_message_idx"
  on "agent_conversations" ("user_id", "last_message_at" DESC);

create table if not exists "agent_messages" (
  "id" uuid primary key not null,
  "conversation_id" uuid not null
    references "agent_conversations"("id") on delete cascade,
  "role" varchar(20) not null,
  "content" text not null default '',
  "tool_calls" json,
  "citations" json,
  "input_tokens" integer,
  "output_tokens" integer,
  "stopped_reason" varchar(50),
  "created_at" timestamp with time zone default now() not null,
  constraint "agent_messages_role_check"
    check ("role" in ('user', 'assistant', 'system', 'tool'))
);

create index if not exists "agent_messages_conversation_id_idx"
  on "agent_messages" ("conversation_id", "created_at" ASC);

create table if not exists "agent_usage_monthly" (
  "id" uuid primary key not null,
  "user_id" uuid not null references "users"("id") on delete cascade,
  "year_month" varchar(7) not null,
  "input_tokens" integer not null default 0,
  "output_tokens" integer not null default 0,
  "requests" integer not null default 0,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "agent_usage_monthly_user_month_unique"
    unique ("user_id", "year_month")
);
