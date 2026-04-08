alter table if exists daily_logs
add column if not exists custom_field_values json;

alter table if exists schedule_phases
add column if not exists color varchar(50) default '#e76f8a';

create table if not exists daily_log_settings (
  id uuid primary key,
  stamp_location boolean default false,
  default_notes text default '',
  include_weather_by_default boolean default true,
  include_weather_notes_by_default boolean default false,
  share_internal_users_by_default boolean default true,
  notify_internal_users_by_default boolean default false,
  share_estimators_by_default boolean default false,
  notify_estimators_by_default boolean default false,
  share_installers_by_default boolean default false,
  notify_installers_by_default boolean default false,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists daily_log_custom_fields (
  id uuid primary key,
  name varchar(100) not null,
  field_type varchar(50) not null,
  options json,
  display_order integer not null default 0,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create unique index if not exists daily_log_custom_fields_name_unique
on daily_log_custom_fields (name);

create table if not exists daily_log_likes (
  id uuid primary key,
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamp not null default now(),
  unique (daily_log_id, user_id)
);

create index if not exists daily_log_likes_log_id_idx
on daily_log_likes (daily_log_id);

create table if not exists daily_log_comments (
  id uuid primary key,
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  parent_comment_id uuid references daily_log_comments(id) on delete cascade,
  created_by uuid references users(id),
  body text not null,
  mentions json,
  attachments json,
  links json,
  reactions json,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  deleted_at timestamp
);

create index if not exists daily_log_comments_log_id_idx
on daily_log_comments (daily_log_id);

create index if not exists daily_log_comments_parent_comment_id_idx
on daily_log_comments (parent_comment_id);

create table if not exists daily_log_todos (
  id uuid primary key,
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  title varchar(255) not null,
  is_complete boolean default false,
  created_by uuid references users(id),
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create index if not exists daily_log_todos_log_id_idx
on daily_log_todos (daily_log_id);

create table if not exists schedule_settings (
  id uuid primary key,
  job_id uuid not null unique references jobs(id) on delete cascade,
  default_view varchar(100) default 'calendar_month',
  show_times_on_month_view boolean default false,
  show_job_name_on_all_listed_jobs boolean default true,
  automatically_mark_items_complete boolean default false,
  include_header_on_pdf_exports boolean default true,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists schedule_baselines (
  id uuid primary key,
  job_id uuid not null unique references jobs(id) on delete cascade,
  captured_at timestamp not null default now(),
  captured_by uuid references users(id),
  items_snapshot json,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists schedule_workday_exception_categories (
  id uuid primary key,
  job_id uuid references jobs(id) on delete cascade,
  name varchar(100) not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  unique(job_id, name)
);

create table if not exists schedule_workday_exceptions (
  id uuid primary key,
  title varchar(255) not null,
  type varchar(50) not null,
  start_date date not null,
  end_date date not null,
  same_every_year boolean default false,
  category_id uuid references schedule_workday_exception_categories(id) on delete set null,
  applies_to_all_jobs boolean default false,
  job_ids json,
  notes varchar(500),
  created_by uuid references users(id),
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists schedule_item_predecessors (
  id uuid primary key,
  schedule_item_id uuid not null references schedule_items(id) on delete cascade,
  predecessor_id uuid not null references schedule_items(id) on delete cascade,
  dependency_type varchar(50) not null,
  lag_days integer not null default 0,
  created_at timestamp not null default now(),
  unique(schedule_item_id, predecessor_id)
);

create index if not exists schedule_item_predecessors_item_idx
on schedule_item_predecessors (schedule_item_id);

create index if not exists schedule_item_predecessors_predecessor_idx
on schedule_item_predecessors (predecessor_id);
