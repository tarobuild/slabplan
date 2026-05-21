-- Scope tenant-bearing uniqueness to the active organization.

drop index if exists folders_resource_title_parent_media_unique;
drop index if exists folders_resource_title_root_media_unique;

create unique index if not exists folders_resource_title_parent_media_unique
  on folders (organization_id, title, parent_folder_id, media_type)
  where deleted_at is null
    and scope = 'resource'
    and job_id is null
    and parent_folder_id is not null
    and organization_id is not null;

create unique index if not exists folders_resource_title_parent_media_legacy_unique
  on folders (title, parent_folder_id, media_type)
  where deleted_at is null
    and scope = 'resource'
    and job_id is null
    and parent_folder_id is not null
    and organization_id is null;

create unique index if not exists folders_resource_title_root_media_unique
  on folders (organization_id, title, media_type)
  where deleted_at is null
    and scope = 'resource'
    and job_id is null
    and parent_folder_id is null
    and organization_id is not null;

create unique index if not exists folders_resource_title_root_media_legacy_unique
  on folders (title, media_type)
  where deleted_at is null
    and scope = 'resource'
    and job_id is null
    and parent_folder_id is null
    and organization_id is null;

drop index if exists idempotency_keys_user_key_method_path_unique;

create unique index if not exists idempotency_keys_user_key_method_path_unique
  on idempotency_keys (organization_id, user_id, key, method, path)
  where organization_id is not null;

create unique index if not exists idempotency_keys_user_key_method_path_legacy_unique
  on idempotency_keys (user_id, key, method, path)
  where organization_id is null;
