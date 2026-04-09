alter table public.files
  add column if not exists note text;

alter table public.folders
  alter column job_id drop not null;

create table if not exists public.job_assignees (
  id uuid primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (job_id, user_id)
);

create index if not exists job_assignees_job_id_idx
on public.job_assignees (job_id);

create index if not exists job_assignees_user_id_idx
on public.job_assignees (user_id);

alter table public.folders
  drop constraint if exists folders_job_title_parent_media_unique;

drop index if exists public.folders_job_title_parent_media_unique;
drop index if exists public.folders_job_title_root_media_unique;
drop index if exists public.folders_resource_title_parent_media_unique;
drop index if exists public.folders_resource_title_root_media_unique;

create unique index if not exists folders_job_title_parent_media_unique
on public.folders (job_id, title, parent_folder_id, media_type)
where deleted_at is null
  and job_id is not null
  and parent_folder_id is not null;

create unique index if not exists folders_job_title_root_media_unique
on public.folders (job_id, title, media_type)
where deleted_at is null
  and job_id is not null
  and parent_folder_id is null;

create unique index if not exists folders_resource_title_parent_media_unique
on public.folders (title, parent_folder_id, media_type)
where deleted_at is null
  and job_id is null
  and parent_folder_id is not null;

create unique index if not exists folders_resource_title_root_media_unique
on public.folders (title, media_type)
where deleted_at is null
  and job_id is null
  and parent_folder_id is null;
