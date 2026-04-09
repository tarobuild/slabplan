CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"user_id" uuid,
	"metadata" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"title" varchar(100),
	"email" varchar(255),
	"phone" varchar(20),
	"cell_phone" varchar(20),
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"street_address" varchar(255),
	"city" varchar(100),
	"state" varchar(2),
	"zip_code" varchar(10),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_log_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"daily_log_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_log_attachments_log_file_unique" UNIQUE("daily_log_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "daily_log_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"daily_log_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"created_by" uuid,
	"body" text NOT NULL,
	"mentions" json,
	"attachments" json,
	"links" json,
	"reactions" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_log_custom_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"field_type" varchar(50) NOT NULL,
	"options" json,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_log_custom_fields_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "daily_log_likes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"daily_log_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_log_likes_log_user_unique" UNIQUE("daily_log_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "daily_log_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"stamp_location" boolean DEFAULT false,
	"default_notes" text DEFAULT '',
	"include_weather_by_default" boolean DEFAULT true,
	"include_weather_notes_by_default" boolean DEFAULT false,
	"share_internal_users_by_default" boolean DEFAULT true,
	"notify_internal_users_by_default" boolean DEFAULT false,
	"share_estimators_by_default" boolean DEFAULT false,
	"notify_estimators_by_default" boolean DEFAULT false,
	"share_installers_by_default" boolean DEFAULT false,
	"notify_installers_by_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_log_settings_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
CREATE TABLE "daily_log_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"daily_log_id" uuid NOT NULL,
	"tag_name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_log_tags_log_tag_unique" UNIQUE("daily_log_id","tag_name")
);
--> statement-breakpoint
CREATE TABLE "daily_log_todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"daily_log_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"is_complete" boolean DEFAULT false,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"log_date" date NOT NULL,
	"title" varchar(255),
	"notes" text NOT NULL,
	"weather_data" json,
	"include_weather" boolean DEFAULT true,
	"include_weather_notes" boolean DEFAULT false,
	"weather_notes" text,
	"share_internal_users" boolean DEFAULT true,
	"share_subs_vendors" boolean DEFAULT false,
	"share_client" boolean DEFAULT false,
	"is_private" boolean DEFAULT false,
	"custom_field_values" json,
	"created_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"folder_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"file_url" varchar(500),
	"file_size" bigint,
	"mime_type" varchar(100),
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"job_id" uuid NOT NULL,
	"parent_folder_id" uuid,
	"media_type" varchar(50) NOT NULL,
	"viewing_permissions" json,
	"uploading_permissions" json,
	"is_global" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"street_address" varchar(255),
	"city" varchar(100),
	"state" varchar(2),
	"zip_code" varchar(10),
	"contract_price" numeric(12, 2),
	"job_type" varchar(100),
	"work_days" json,
	"projected_start" date,
	"projected_completion" date,
	"actual_start" date,
	"actual_completion" date,
	"contract_type" varchar(50),
	"internal_notes" text,
	"sub_vendor_notes" text,
	"square_feet" numeric(10, 2),
	"permit_number" varchar(100),
	"project_manager_id" uuid,
	"client_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('open', 'closed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "lead_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_attachments_lead_file_unique" UNIQUE("lead_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "lead_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"display_name" varchar(255) NOT NULL,
	"street_address" varchar(255),
	"city" varchar(100),
	"state" varchar(2),
	"zip_code" varchar(10),
	"phone" varchar(20),
	"cell_phone" varchar(20),
	"email" varchar(255) NOT NULL,
	"label" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_salespeople" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_salespeople_lead_user_unique" UNIQUE("lead_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"source_name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_lead_source_unique" UNIQUE("lead_id","source_name")
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"tag_name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_tags_lead_tag_unique" UNIQUE("lead_id","tag_name")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"street_address" varchar(255),
	"city" varchar(100),
	"state" varchar(2),
	"zip_code" varchar(10),
	"confidence" integer DEFAULT 0,
	"projected_sales_date" date,
	"estimated_revenue_min" numeric(12, 2),
	"estimated_revenue_max" numeric(12, 2),
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"project_type" varchar(100),
	"notes" text,
	"lead_source" varchar(255),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('open', 'in_negotiation', 'won', 'lost', 'archived')),
	CONSTRAINT "leads_confidence_range" CHECK ("leads"."confidence" >= 0 and "leads"."confidence" <= 100)
);
--> statement-breakpoint
CREATE TABLE "schedule_baselines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" uuid,
	"items_snapshot" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_baselines_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_item_assignees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_item_assignees_item_user_unique" UNIQUE("schedule_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_item_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_item_attachments_item_file_unique" UNIQUE("schedule_item_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_item_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_item_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_item_predecessors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_item_id" uuid NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"dependency_type" varchar(50) NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_item_predecessors_item_predecessor_unique" UNIQUE("schedule_item_id","predecessor_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_item_todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_item_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"is_complete" boolean DEFAULT false,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"schedule_phase_id" uuid,
	"title" varchar(255) NOT NULL,
	"display_color" varchar(50) DEFAULT '#2563eb' NOT NULL,
	"start_date" date NOT NULL,
	"work_days" integer NOT NULL,
	"end_date" date NOT NULL,
	"is_hourly" boolean DEFAULT false,
	"start_time" time,
	"end_time" time,
	"progress" integer DEFAULT 0,
	"reminder" varchar(100) DEFAULT 'none',
	"show_on_gantt" boolean DEFAULT true,
	"visible_to_estimators" boolean DEFAULT true,
	"visible_to_installers" boolean DEFAULT true,
	"visible_to_office_staff" boolean DEFAULT true,
	"is_complete" boolean DEFAULT false,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "schedule_items_progress_range" CHECK ("schedule_items"."progress" >= 0 and "schedule_items"."progress" <= 100)
);
--> statement-breakpoint
CREATE TABLE "schedule_phases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(50) DEFAULT '#e76f8a',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_phases_job_name_unique" UNIQUE("job_id","name")
);
--> statement-breakpoint
CREATE TABLE "schedule_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"default_view" varchar(100) DEFAULT 'calendar_month',
	"show_times_on_month_view" boolean DEFAULT false,
	"show_job_name_on_all_listed_jobs" boolean DEFAULT true,
	"automatically_mark_items_complete" boolean DEFAULT false,
	"include_header_on_pdf_exports" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_settings_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_tag_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_tag_settings_job_name_unique" UNIQUE("job_id","name")
);
--> statement-breakpoint
CREATE TABLE "schedule_workday_exception_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_workday_exception_categories_job_name_unique" UNIQUE("job_id","name")
);
--> statement-breakpoint
CREATE TABLE "schedule_workday_exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"same_every_year" boolean DEFAULT false,
	"category_id" uuid,
	"applies_to_all_jobs" boolean DEFAULT false,
	"job_ids" json,
	"notes" varchar(500),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'crew_member' NOT NULL,
	"avatar_url" varchar(500),
	"phone" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'project_manager', 'crew_member'))
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_attachments" ADD CONSTRAINT "daily_log_attachments_daily_log_id_daily_logs_id_fk" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_attachments" ADD CONSTRAINT "daily_log_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_comments" ADD CONSTRAINT "daily_log_comments_daily_log_id_daily_logs_id_fk" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_comments" ADD CONSTRAINT "daily_log_comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_comments" ADD CONSTRAINT "daily_log_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."daily_log_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_likes" ADD CONSTRAINT "daily_log_likes_daily_log_id_daily_logs_id_fk" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_likes" ADD CONSTRAINT "daily_log_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_tags" ADD CONSTRAINT "daily_log_tags_daily_log_id_daily_logs_id_fk" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_todos" ADD CONSTRAINT "daily_log_todos_daily_log_id_daily_logs_id_fk" FOREIGN KEY ("daily_log_id") REFERENCES "public"."daily_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_log_todos" ADD CONSTRAINT "daily_log_todos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_manager_id_users_id_fk" FOREIGN KEY ("project_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_contacts" ADD CONSTRAINT "lead_contacts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_salespeople" ADD CONSTRAINT "lead_salespeople_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_salespeople" ADD CONSTRAINT "lead_salespeople_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_baselines" ADD CONSTRAINT "schedule_baselines_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_assignees" ADD CONSTRAINT "schedule_item_assignees_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_assignees" ADD CONSTRAINT "schedule_item_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_attachments" ADD CONSTRAINT "schedule_item_attachments_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_attachments" ADD CONSTRAINT "schedule_item_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_notes" ADD CONSTRAINT "schedule_item_notes_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_notes" ADD CONSTRAINT "schedule_item_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_predecessors" ADD CONSTRAINT "schedule_item_predecessors_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_predecessors" ADD CONSTRAINT "schedule_item_predecessors_predecessor_id_schedule_items_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."schedule_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_todos" ADD CONSTRAINT "schedule_item_todos_schedule_item_id_schedule_items_id_fk" FOREIGN KEY ("schedule_item_id") REFERENCES "public"."schedule_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_todos" ADD CONSTRAINT "schedule_item_todos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_schedule_phase_id_schedule_phases_id_fk" FOREIGN KEY ("schedule_phase_id") REFERENCES "public"."schedule_phases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_phases" ADD CONSTRAINT "schedule_phases_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_settings" ADD CONSTRAINT "schedule_settings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_tag_settings" ADD CONSTRAINT "schedule_tag_settings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_workday_exception_categories" ADD CONSTRAINT "schedule_workday_exception_categories_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_workday_exceptions" ADD CONSTRAINT "schedule_workday_exceptions_category_id_schedule_workday_exception_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."schedule_workday_exception_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_workday_exceptions" ADD CONSTRAINT "schedule_workday_exceptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_user_id_idx" ON "activity_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_log_entity_id_idx" ON "activity_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "clients_created_by_idx" ON "clients" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "daily_log_attachments_file_id_idx" ON "daily_log_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "daily_log_comments_created_by_idx" ON "daily_log_comments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "daily_log_comments_log_id_idx" ON "daily_log_comments" USING btree ("daily_log_id");--> statement-breakpoint
CREATE INDEX "daily_log_comments_parent_comment_id_idx" ON "daily_log_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "daily_log_likes_user_id_idx" ON "daily_log_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "daily_log_todos_created_by_idx" ON "daily_log_todos" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "daily_log_todos_log_id_idx" ON "daily_log_todos" USING btree ("daily_log_id");--> statement-breakpoint
CREATE INDEX "daily_logs_created_by_idx" ON "daily_logs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "daily_logs_job_id_idx" ON "daily_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "files_folder_id_idx" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "files_uploaded_by_idx" ON "files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "folders_parent_folder_id_idx" ON "folders" USING btree ("parent_folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_job_title_parent_media_unique" ON "folders" USING btree ("job_id","title","parent_folder_id","media_type") WHERE "folders"."deleted_at" is null and "folders"."parent_folder_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_job_title_root_media_unique" ON "folders" USING btree ("job_id","title","media_type") WHERE "folders"."deleted_at" is null and "folders"."parent_folder_id" is null;--> statement-breakpoint
CREATE INDEX "jobs_client_id_idx" ON "jobs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "jobs_created_by_idx" ON "jobs" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "jobs_project_manager_id_idx" ON "jobs" USING btree ("project_manager_id");--> statement-breakpoint
CREATE INDEX "lead_attachments_file_id_idx" ON "lead_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "lead_contacts_lead_id_idx" ON "lead_contacts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_salespeople_user_id_idx" ON "lead_salespeople" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leads_created_by_idx" ON "leads" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "schedule_baselines_captured_by_idx" ON "schedule_baselines" USING btree ("captured_by");--> statement-breakpoint
CREATE INDEX "schedule_item_assignees_user_id_idx" ON "schedule_item_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "schedule_item_attachments_file_id_idx" ON "schedule_item_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "schedule_item_notes_created_by_idx" ON "schedule_item_notes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "schedule_item_notes_schedule_item_id_idx" ON "schedule_item_notes" USING btree ("schedule_item_id");--> statement-breakpoint
CREATE INDEX "schedule_item_todos_created_by_idx" ON "schedule_item_todos" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "schedule_item_todos_schedule_item_id_idx" ON "schedule_item_todos" USING btree ("schedule_item_id");--> statement-breakpoint
CREATE INDEX "schedule_items_created_by_idx" ON "schedule_items" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "schedule_items_job_id_idx" ON "schedule_items" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "schedule_items_schedule_phase_id_idx" ON "schedule_items" USING btree ("schedule_phase_id");--> statement-breakpoint
CREATE INDEX "schedule_workday_exceptions_category_id_idx" ON "schedule_workday_exceptions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "schedule_workday_exceptions_created_by_idx" ON "schedule_workday_exceptions" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;