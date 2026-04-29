delete from public.daily_log_attachments
where daily_log_id is null
   or file_id is null;

delete from public.daily_log_tags
where daily_log_id is null;

delete from public.daily_logs
where job_id is null;

delete from public.schedule_item_assignees
where schedule_item_id is null
   or user_id is null;

delete from public.schedule_items
where job_id is null;

delete from public.schedule_workday_exception_categories
where job_id is null;

delete from public.lead_attachments
where lead_id is null
   or file_id is null;

delete from public.lead_tags
where lead_id is null;

delete from public.lead_sources
where lead_id is null;

delete from public.lead_salespeople
where lead_id is null
   or user_id is null;

delete from public.lead_contacts
where lead_id is null;

delete from public.files
where folder_id is null;

delete from public.client_contacts
where client_id is null;

delete from public.folders
where job_id is null;

do $$
declare
  column_record record;
begin
  for column_record in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and data_type = 'timestamp without time zone'
  loop
    execute format(
      'alter table %I.%I alter column %I type timestamptz using %I at time zone ''UTC''',
      column_record.table_schema,
      column_record.table_name,
      column_record.column_name,
      column_record.column_name
    );
  end loop;
end
$$;

alter table public.client_contacts
  alter column client_id set not null;

alter table public.folders
  alter column job_id set not null;

alter table public.files
  alter column folder_id set not null;

alter table public.lead_contacts
  alter column lead_id set not null;

alter table public.lead_salespeople
  alter column lead_id set not null,
  alter column user_id set not null;

alter table public.lead_tags
  alter column lead_id set not null;

alter table public.lead_sources
  alter column lead_id set not null;

alter table public.lead_attachments
  alter column lead_id set not null,
  alter column file_id set not null;

alter table public.schedule_items
  alter column job_id set not null;

alter table public.schedule_item_assignees
  alter column schedule_item_id set not null,
  alter column user_id set not null;

alter table public.schedule_workday_exception_categories
  alter column job_id set not null;

alter table public.daily_logs
  alter column job_id set not null;

alter table public.daily_log_attachments
  alter column daily_log_id set not null,
  alter column file_id set not null;

alter table public.daily_log_tags
  alter column daily_log_id set not null;

alter table public.users
  drop constraint if exists users_email_unique;

drop index if exists public.users_email_unique;

create unique index if not exists users_email_unique
on public.users (email)
where deleted_at is null;

alter table public.folders
  drop constraint if exists folders_job_title_parent_media_unique;

drop index if exists public.folders_job_title_parent_media_unique;

create unique index if not exists folders_job_title_parent_media_unique
on public.folders (job_id, title, parent_folder_id, media_type)
where deleted_at is null
  and parent_folder_id is not null;

create unique index if not exists folders_job_title_root_media_unique
on public.folders (job_id, title, media_type)
where deleted_at is null
  and parent_folder_id is null;

alter table public.clients
  drop constraint if exists clients_created_by_users_id_fk,
  drop constraint if exists clients_created_by_fkey;

alter table public.clients
  add constraint clients_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.jobs
  drop constraint if exists jobs_project_manager_id_users_id_fk,
  drop constraint if exists jobs_project_manager_id_fkey,
  drop constraint if exists jobs_created_by_users_id_fk,
  drop constraint if exists jobs_created_by_fkey;

alter table public.jobs
  add constraint jobs_project_manager_id_users_id_fk
  foreign key (project_manager_id)
  references public.users(id)
  on delete set null,
  add constraint jobs_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.files
  drop constraint if exists files_uploaded_by_users_id_fk,
  drop constraint if exists files_uploaded_by_fkey;

alter table public.files
  add constraint files_uploaded_by_users_id_fk
  foreign key (uploaded_by)
  references public.users(id)
  on delete set null;

alter table public.leads
  drop constraint if exists leads_created_by_users_id_fk,
  drop constraint if exists leads_created_by_fkey;

alter table public.leads
  add constraint leads_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.schedule_items
  drop constraint if exists schedule_items_created_by_users_id_fk,
  drop constraint if exists schedule_items_created_by_fkey;

alter table public.schedule_items
  add constraint schedule_items_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.schedule_item_notes
  drop constraint if exists schedule_item_notes_created_by_users_id_fk,
  drop constraint if exists schedule_item_notes_created_by_fkey;

alter table public.schedule_item_notes
  add constraint schedule_item_notes_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.schedule_item_todos
  drop constraint if exists schedule_item_todos_created_by_users_id_fk,
  drop constraint if exists schedule_item_todos_created_by_fkey;

alter table public.schedule_item_todos
  add constraint schedule_item_todos_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.schedule_baselines
  drop constraint if exists schedule_baselines_captured_by_users_id_fk,
  drop constraint if exists schedule_baselines_captured_by_fkey;

alter table public.schedule_baselines
  add constraint schedule_baselines_captured_by_users_id_fk
  foreign key (captured_by)
  references public.users(id)
  on delete set null;

alter table public.schedule_workday_exceptions
  drop constraint if exists schedule_workday_exceptions_created_by_users_id_fk,
  drop constraint if exists schedule_workday_exceptions_created_by_fkey;

alter table public.schedule_workday_exceptions
  add constraint schedule_workday_exceptions_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.daily_logs
  drop constraint if exists daily_logs_created_by_users_id_fk,
  drop constraint if exists daily_logs_created_by_fkey;

alter table public.daily_logs
  add constraint daily_logs_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.daily_log_comments
  drop constraint if exists daily_log_comments_created_by_users_id_fk,
  drop constraint if exists daily_log_comments_created_by_fkey;

alter table public.daily_log_comments
  add constraint daily_log_comments_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.daily_log_todos
  drop constraint if exists daily_log_todos_created_by_users_id_fk,
  drop constraint if exists daily_log_todos_created_by_fkey;

alter table public.daily_log_todos
  add constraint daily_log_todos_created_by_users_id_fk
  foreign key (created_by)
  references public.users(id)
  on delete set null;

alter table public.activity_log
  drop constraint if exists activity_log_user_id_users_id_fk,
  drop constraint if exists activity_log_user_id_fkey;

alter table public.activity_log
  add constraint activity_log_user_id_users_id_fk
  foreign key (user_id)
  references public.users(id)
  on delete set null;

create index if not exists activity_log_user_id_idx
on public.activity_log (user_id);

create index if not exists client_contacts_client_id_idx
on public.client_contacts (client_id);

create index if not exists clients_created_by_idx
on public.clients (created_by);

create index if not exists daily_log_attachments_file_id_idx
on public.daily_log_attachments (file_id);

create index if not exists daily_log_comments_created_by_idx
on public.daily_log_comments (created_by);

create index if not exists daily_log_likes_user_id_idx
on public.daily_log_likes (user_id);

create index if not exists daily_log_todos_created_by_idx
on public.daily_log_todos (created_by);

create index if not exists daily_logs_created_by_idx
on public.daily_logs (created_by);

create index if not exists daily_logs_job_id_idx
on public.daily_logs (job_id);

create index if not exists files_folder_id_idx
on public.files (folder_id);

create index if not exists files_uploaded_by_idx
on public.files (uploaded_by);

create index if not exists folders_parent_folder_id_idx
on public.folders (parent_folder_id);

create index if not exists jobs_client_id_idx
on public.jobs (client_id);

create index if not exists jobs_created_by_idx
on public.jobs (created_by);

create index if not exists jobs_project_manager_id_idx
on public.jobs (project_manager_id);

create index if not exists lead_attachments_file_id_idx
on public.lead_attachments (file_id);

create index if not exists lead_contacts_lead_id_idx
on public.lead_contacts (lead_id);

create index if not exists lead_salespeople_user_id_idx
on public.lead_salespeople (user_id);

create index if not exists leads_created_by_idx
on public.leads (created_by);

create index if not exists schedule_baselines_captured_by_idx
on public.schedule_baselines (captured_by);

create index if not exists schedule_item_assignees_user_id_idx
on public.schedule_item_assignees (user_id);

create index if not exists schedule_item_attachments_file_id_idx
on public.schedule_item_attachments (file_id);

create index if not exists schedule_item_notes_created_by_idx
on public.schedule_item_notes (created_by);

create index if not exists schedule_item_notes_schedule_item_id_idx
on public.schedule_item_notes (schedule_item_id);

create index if not exists schedule_item_todos_created_by_idx
on public.schedule_item_todos (created_by);

create index if not exists schedule_item_todos_schedule_item_id_idx
on public.schedule_item_todos (schedule_item_id);

create index if not exists schedule_items_created_by_idx
on public.schedule_items (created_by);

create index if not exists schedule_items_job_id_idx
on public.schedule_items (job_id);

create index if not exists schedule_items_schedule_phase_id_idx
on public.schedule_items (schedule_phase_id);

create index if not exists schedule_workday_exceptions_category_id_idx
on public.schedule_workday_exceptions (category_id);

create index if not exists schedule_workday_exceptions_created_by_idx
on public.schedule_workday_exceptions (created_by);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_record record;
begin
  for table_record in
    select table_schema, table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'updated_at'
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I.%I',
      table_record.table_schema,
      table_record.table_name
    );
    execute format(
      'create trigger set_updated_at before update on %I.%I for each row execute function public.set_updated_at()',
      table_record.table_schema,
      table_record.table_name
    );
  end loop;
end
$$;

alter table public.daily_log_settings
  add column if not exists singleton boolean not null default true;

delete from public.daily_log_settings dls
where dls.id not in (
  select id from public.daily_log_settings
  order by created_at asc
  limit 1
);

update public.daily_log_settings set singleton = true where singleton is distinct from true;

create unique index if not exists daily_log_settings_singleton_unique
on public.daily_log_settings (singleton);

alter table public.daily_log_settings
  drop constraint if exists daily_log_settings_singleton_check;

alter table public.daily_log_settings
  add constraint daily_log_settings_singleton_check check (singleton = true);

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role in ('admin', 'project_manager', 'crew_member'));

alter table public.jobs
  drop constraint if exists jobs_status_check;

alter table public.jobs
  add constraint jobs_status_check
  check (status in ('open', 'closed', 'archived'));

alter table public.leads
  drop constraint if exists leads_status_check;

alter table public.leads
  add constraint leads_status_check
  check (status in ('open', 'in_negotiation', 'won', 'lost', 'archived'));

update public.leads set confidence = 0 where confidence is null or confidence < 0;
update public.leads set confidence = 100 where confidence > 100;

alter table public.leads
  drop constraint if exists leads_confidence_range;

alter table public.leads
  add constraint leads_confidence_range
  check (confidence is null or (confidence >= 0 and confidence <= 100));

update public.schedule_items set progress = 0 where progress is not null and progress < 0;
update public.schedule_items set progress = 100 where progress is not null and progress > 100;

alter table public.schedule_items
  drop constraint if exists schedule_items_progress_range;

alter table public.schedule_items
  add constraint schedule_items_progress_range
  check (progress is null or (progress >= 0 and progress <= 100));
