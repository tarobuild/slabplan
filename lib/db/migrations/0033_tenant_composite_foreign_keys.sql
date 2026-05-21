-- Enforce tenant consistency for child rows that duplicate organization_id.
-- Composite FKs are added NOT VALID so existing legacy rows do not block the
-- migration; PostgreSQL still enforces them for all new and updated rows.

create unique index if not exists agent_conversations_id_organization_id_unique
  on agent_conversations (id, organization_id);

create unique index if not exists clients_id_organization_id_unique
  on clients (id, organization_id);

create unique index if not exists files_id_organization_id_unique
  on files (id, organization_id);

create unique index if not exists folders_id_organization_id_unique
  on folders (id, organization_id);

create unique index if not exists jobs_id_organization_id_unique
  on jobs (id, organization_id);

create unique index if not exists leads_id_organization_id_unique
  on leads (id, organization_id);

create unique index if not exists schedule_items_id_organization_id_unique
  on schedule_items (id, organization_id);

create unique index if not exists schedule_phases_id_organization_id_unique
  on schedule_phases (id, organization_id);

create unique index if not exists schedule_workday_categories_id_org_unique
  on schedule_workday_exception_categories (id, organization_id);

create unique index if not exists daily_logs_id_organization_id_unique
  on daily_logs (id, organization_id);

create unique index if not exists daily_log_comments_id_organization_id_unique
  on daily_log_comments (id, organization_id);

create unique index if not exists financial_trackers_id_organization_id_unique
  on financial_trackers (id, organization_id);

create unique index if not exists sov_areas_id_organization_id_unique
  on sov_areas (id, organization_id);

create unique index if not exists sov_line_items_id_organization_id_unique
  on sov_line_items (id, organization_id);

create unique index if not exists tracker_invoices_id_organization_id_unique
  on tracker_invoices (id, organization_id);

alter table agent_messages
  drop constraint if exists agent_messages_conversation_id_agent_conversations_id_fk,
  drop constraint if exists agent_messages_conversation_org_fkey,
  add constraint agent_messages_conversation_org_fkey
    foreign key (conversation_id, organization_id)
    references agent_conversations (id, organization_id)
    on delete cascade
    not valid;

alter table folders
  drop constraint if exists folders_job_id_jobs_id_fk,
  drop constraint if exists folders_lead_id_leads_id_fk,
  drop constraint if exists folders_daily_log_id_daily_logs_id_fk,
  drop constraint if exists folders_schedule_item_id_schedule_items_id_fk,
  drop constraint if exists folders_parent_folder_id_fkey,
  drop constraint if exists folders_job_org_fkey,
  add constraint folders_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists folders_lead_org_fkey,
  add constraint folders_lead_org_fkey
    foreign key (lead_id, organization_id)
    references leads (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists folders_daily_log_org_fkey,
  add constraint folders_daily_log_org_fkey
    foreign key (daily_log_id, organization_id)
    references daily_logs (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists folders_schedule_item_org_fkey,
  add constraint folders_schedule_item_org_fkey
    foreign key (schedule_item_id, organization_id)
    references schedule_items (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists folders_parent_org_fkey,
  add constraint folders_parent_org_fkey
    foreign key (parent_folder_id, organization_id)
    references folders (id, organization_id)
    on delete cascade
    not valid;

alter table files
  drop constraint if exists files_folder_id_folders_id_fk,
  drop constraint if exists files_folder_org_fkey,
  add constraint files_folder_org_fkey
    foreign key (folder_id, organization_id)
    references folders (id, organization_id)
    on delete cascade
    not valid;

alter table jobs
  drop constraint if exists jobs_client_id_clients_id_fk,
  drop constraint if exists jobs_client_org_fkey,
  add constraint jobs_client_org_fkey
    foreign key (client_id, organization_id)
    references clients (id, organization_id)
    not valid;

alter table client_contacts
  drop constraint if exists client_contacts_client_id_clients_id_fk,
  drop constraint if exists client_contacts_client_org_fkey,
  add constraint client_contacts_client_org_fkey
    foreign key (client_id, organization_id)
    references clients (id, organization_id)
    on delete cascade
    not valid;

alter table job_assignees
  drop constraint if exists job_assignees_job_id_jobs_id_fk,
  drop constraint if exists job_assignees_job_org_fkey,
  add constraint job_assignees_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid;

alter table lead_attachments
  drop constraint if exists lead_attachments_lead_id_leads_id_fk,
  drop constraint if exists lead_attachments_file_id_files_id_fk,
  drop constraint if exists lead_attachments_lead_org_fkey,
  add constraint lead_attachments_lead_org_fkey
    foreign key (lead_id, organization_id)
    references leads (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists lead_attachments_file_org_fkey,
  add constraint lead_attachments_file_org_fkey
    foreign key (file_id, organization_id)
    references files (id, organization_id)
    on delete cascade
    not valid;

alter table lead_contacts
  drop constraint if exists lead_contacts_lead_id_leads_id_fk,
  drop constraint if exists lead_contacts_lead_org_fkey,
  add constraint lead_contacts_lead_org_fkey
    foreign key (lead_id, organization_id)
    references leads (id, organization_id)
    on delete cascade
    not valid;

alter table lead_salespeople
  drop constraint if exists lead_salespeople_lead_id_leads_id_fk,
  drop constraint if exists lead_salespeople_lead_org_fkey,
  add constraint lead_salespeople_lead_org_fkey
    foreign key (lead_id, organization_id)
    references leads (id, organization_id)
    on delete cascade
    not valid;

alter table lead_tags
  drop constraint if exists lead_tags_lead_id_leads_id_fk,
  drop constraint if exists lead_tags_lead_org_fkey,
  add constraint lead_tags_lead_org_fkey
    foreign key (lead_id, organization_id)
    references leads (id, organization_id)
    on delete cascade
    not valid;

alter table lead_sources
  drop constraint if exists lead_sources_lead_id_leads_id_fk,
  drop constraint if exists lead_sources_lead_org_fkey,
  add constraint lead_sources_lead_org_fkey
    foreign key (lead_id, organization_id)
    references leads (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_item_attachments
  drop constraint if exists schedule_item_attachments_schedule_item_id_schedule_items_id_fk,
  drop constraint if exists schedule_item_attachments_file_id_files_id_fk,
  drop constraint if exists schedule_item_attachments_item_org_fkey,
  add constraint schedule_item_attachments_item_org_fkey
    foreign key (schedule_item_id, organization_id)
    references schedule_items (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists schedule_item_attachments_file_org_fkey,
  add constraint schedule_item_attachments_file_org_fkey
    foreign key (file_id, organization_id)
    references files (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_phases
  drop constraint if exists schedule_phases_job_id_jobs_id_fk,
  drop constraint if exists schedule_phases_job_org_fkey,
  add constraint schedule_phases_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_tag_settings
  drop constraint if exists schedule_tag_settings_job_id_jobs_id_fk,
  drop constraint if exists schedule_tag_settings_job_org_fkey,
  add constraint schedule_tag_settings_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_items
  drop constraint if exists schedule_items_job_id_jobs_id_fk,
  drop constraint if exists schedule_items_schedule_phase_id_schedule_phases_id_fk,
  drop constraint if exists schedule_items_job_org_fkey,
  add constraint schedule_items_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists schedule_items_phase_org_fkey,
  add constraint schedule_items_phase_org_fkey
    foreign key (schedule_phase_id, organization_id)
    references schedule_phases (id, organization_id)
    not valid;

alter table schedule_settings
  drop constraint if exists schedule_settings_job_id_jobs_id_fk,
  drop constraint if exists schedule_settings_job_org_fkey,
  add constraint schedule_settings_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_baselines
  drop constraint if exists schedule_baselines_job_id_jobs_id_fk,
  drop constraint if exists schedule_baselines_job_org_fkey,
  add constraint schedule_baselines_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_workday_exception_categories
  drop constraint if exists schedule_workday_exception_categories_job_id_jobs_id_fk,
  drop constraint if exists schedule_workday_categories_job_org_fkey,
  add constraint schedule_workday_categories_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_workday_exceptions
  drop constraint if exists schedule_workday_exceptions_category_id_schedule_workday_exception_categories_id_fk,
  drop constraint if exists schedule_workday_exceptions_category_org_fkey,
  add constraint schedule_workday_exceptions_category_org_fkey
    foreign key (category_id, organization_id)
    references schedule_workday_exception_categories (id, organization_id)
    not valid;

alter table schedule_item_assignees
  drop constraint if exists schedule_item_assignees_schedule_item_id_schedule_items_id_fk,
  drop constraint if exists schedule_item_assignees_item_org_fkey,
  add constraint schedule_item_assignees_item_org_fkey
    foreign key (schedule_item_id, organization_id)
    references schedule_items (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_item_notes
  drop constraint if exists schedule_item_notes_schedule_item_id_schedule_items_id_fk,
  drop constraint if exists schedule_item_notes_item_org_fkey,
  add constraint schedule_item_notes_item_org_fkey
    foreign key (schedule_item_id, organization_id)
    references schedule_items (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_item_todos
  drop constraint if exists schedule_item_todos_schedule_item_id_schedule_items_id_fk,
  drop constraint if exists schedule_item_todos_item_org_fkey,
  add constraint schedule_item_todos_item_org_fkey
    foreign key (schedule_item_id, organization_id)
    references schedule_items (id, organization_id)
    on delete cascade
    not valid;

alter table schedule_item_predecessors
  drop constraint if exists schedule_item_predecessors_schedule_item_id_schedule_items_id_fk,
  drop constraint if exists schedule_item_predecessors_predecessor_id_schedule_items_id_fk,
  drop constraint if exists schedule_item_predecessors_item_org_fkey,
  add constraint schedule_item_predecessors_item_org_fkey
    foreign key (schedule_item_id, organization_id)
    references schedule_items (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists schedule_item_predecessors_predecessor_org_fkey,
  add constraint schedule_item_predecessors_predecessor_org_fkey
    foreign key (predecessor_id, organization_id)
    references schedule_items (id, organization_id)
    on delete cascade
    not valid;

alter table daily_logs
  drop constraint if exists daily_logs_job_id_jobs_id_fk,
  drop constraint if exists daily_logs_job_org_fkey,
  add constraint daily_logs_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid;

alter table daily_log_attachments
  drop constraint if exists daily_log_attachments_log_org_fkey,
  add constraint daily_log_attachments_log_org_fkey
    foreign key (daily_log_id, organization_id)
    references daily_logs (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists daily_log_attachments_file_org_fkey,
  add constraint daily_log_attachments_file_org_fkey
    foreign key (file_id, organization_id)
    references files (id, organization_id)
    on delete cascade
    not valid;

alter table daily_log_comments
  drop constraint if exists daily_log_comments_parent_comment_id_fkey,
  drop constraint if exists daily_log_comments_parent_org_fkey,
  add constraint daily_log_comments_parent_org_fkey
    foreign key (parent_comment_id, organization_id)
    references daily_log_comments (id, organization_id)
    on delete cascade
    not valid;

alter table financial_trackers
  drop constraint if exists financial_trackers_job_id_jobs_id_fk,
  drop constraint if exists financial_trackers_job_id_fkey,
  drop constraint if exists financial_trackers_estimate_file_id_files_id_fk,
  drop constraint if exists financial_trackers_estimate_file_id_fkey,
  drop constraint if exists financial_trackers_job_org_fkey,
  add constraint financial_trackers_job_org_fkey
    foreign key (job_id, organization_id)
    references jobs (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists financial_trackers_estimate_file_org_fkey,
  add constraint financial_trackers_estimate_file_org_fkey
    foreign key (estimate_file_id, organization_id)
    references files (id, organization_id)
    not valid;

alter table sov_areas
  drop constraint if exists sov_areas_tracker_id_fkey,
  drop constraint if exists sov_areas_tracker_id_financial_trackers_id_fk,
  drop constraint if exists sov_areas_tracker_org_fkey,
  add constraint sov_areas_tracker_org_fkey
    foreign key (tracker_id, organization_id)
    references financial_trackers (id, organization_id)
    on delete cascade
    not valid;

alter table sov_line_items
  drop constraint if exists sov_line_items_area_id_fkey,
  drop constraint if exists sov_line_items_area_id_sov_areas_id_fk,
  drop constraint if exists sov_line_items_area_org_fkey,
  add constraint sov_line_items_area_org_fkey
    foreign key (area_id, organization_id)
    references sov_areas (id, organization_id)
    on delete cascade
    not valid;

alter table change_orders
  drop constraint if exists change_orders_tracker_id_fkey,
  drop constraint if exists change_orders_tracker_id_financial_trackers_id_fk,
  drop constraint if exists change_orders_area_id_fkey,
  drop constraint if exists change_orders_area_id_sov_areas_id_fk,
  drop constraint if exists change_orders_tracker_org_fkey,
  add constraint change_orders_tracker_org_fkey
    foreign key (tracker_id, organization_id)
    references financial_trackers (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists change_orders_area_org_fkey,
  add constraint change_orders_area_org_fkey
    foreign key (area_id, organization_id)
    references sov_areas (id, organization_id)
    not valid;

alter table tracker_invoices
  drop constraint if exists tracker_invoices_tracker_id_fkey,
  drop constraint if exists tracker_invoices_tracker_id_financial_trackers_id_fk,
  drop constraint if exists tracker_invoices_file_id_fkey,
  drop constraint if exists tracker_invoices_file_id_files_id_fk,
  drop constraint if exists tracker_invoices_tracker_org_fkey,
  add constraint tracker_invoices_tracker_org_fkey
    foreign key (tracker_id, organization_id)
    references financial_trackers (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists tracker_invoices_file_org_fkey,
  add constraint tracker_invoices_file_org_fkey
    foreign key (file_id, organization_id)
    references files (id, organization_id)
    not valid;

alter table invoice_line_payments
  drop constraint if exists invoice_line_payments_invoice_id_fkey,
  drop constraint if exists invoice_line_payments_invoice_id_tracker_invoices_id_fk,
  drop constraint if exists invoice_line_payments_line_item_id_fkey,
  drop constraint if exists invoice_line_payments_line_item_id_sov_line_items_id_fk,
  drop constraint if exists invoice_line_payments_invoice_org_fkey,
  add constraint invoice_line_payments_invoice_org_fkey
    foreign key (invoice_id, organization_id)
    references tracker_invoices (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists invoice_line_payments_line_item_org_fkey,
  add constraint invoice_line_payments_line_item_org_fkey
    foreign key (line_item_id, organization_id)
    references sov_line_items (id, organization_id)
    on delete cascade
    not valid;

alter table daily_log_tags
  drop constraint if exists daily_log_tags_daily_log_id_daily_logs_id_fk,
  drop constraint if exists daily_log_tags_log_org_fkey,
  add constraint daily_log_tags_log_org_fkey
    foreign key (daily_log_id, organization_id)
    references daily_logs (id, organization_id)
    on delete cascade
    not valid;

alter table daily_log_likes
  drop constraint if exists daily_log_likes_daily_log_id_daily_logs_id_fk,
  drop constraint if exists daily_log_likes_log_org_fkey,
  add constraint daily_log_likes_log_org_fkey
    foreign key (daily_log_id, organization_id)
    references daily_logs (id, organization_id)
    on delete cascade
    not valid;

alter table daily_log_comments
  drop constraint if exists daily_log_comments_daily_log_id_daily_logs_id_fk,
  drop constraint if exists daily_log_comments_log_org_fkey,
  add constraint daily_log_comments_log_org_fkey
    foreign key (daily_log_id, organization_id)
    references daily_logs (id, organization_id)
    on delete cascade
    not valid,
  drop constraint if exists daily_log_comments_parent_comment_id_fkey,
  drop constraint if exists daily_log_comments_parent_org_fkey,
  add constraint daily_log_comments_parent_org_fkey
    foreign key (parent_comment_id, organization_id)
    references daily_log_comments (id, organization_id)
    on delete cascade
    not valid;

alter table daily_log_todos
  drop constraint if exists daily_log_todos_daily_log_id_daily_logs_id_fk,
  drop constraint if exists daily_log_todos_log_org_fkey,
  add constraint daily_log_todos_log_org_fkey
    foreign key (daily_log_id, organization_id)
    references daily_logs (id, organization_id)
    on delete cascade
    not valid;

alter table file_annotations
  drop constraint if exists file_annotations_file_id_files_id_fk,
  drop constraint if exists file_annotations_file_org_fkey,
  add constraint file_annotations_file_org_fkey
    foreign key (file_id, organization_id)
    references files (id, organization_id)
    on delete cascade
    not valid;

alter table agent_messages
  alter column organization_id set not null;

alter table lead_contacts
  alter column organization_id set not null;

alter table lead_salespeople
  alter column organization_id set not null;

alter table lead_tags
  alter column organization_id set not null;

alter table lead_sources
  alter column organization_id set not null;

alter table lead_attachments
  alter column organization_id set not null;

alter table schedule_item_assignees
  alter column organization_id set not null;

alter table schedule_item_notes
  alter column organization_id set not null;

alter table schedule_item_attachments
  alter column organization_id set not null;

alter table schedule_item_todos
  alter column organization_id set not null;

alter table schedule_item_predecessors
  alter column organization_id set not null;

alter table daily_log_attachments
  alter column organization_id set not null;

alter table daily_log_tags
  alter column organization_id set not null;

alter table daily_log_likes
  alter column organization_id set not null;

alter table daily_log_comments
  alter column organization_id set not null;

alter table daily_log_todos
  alter column organization_id set not null;

alter table file_annotations
  alter column organization_id set not null;
