import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  json,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createId = () => crypto.randomUUID();
const timestampTz = (name: string) => timestamp(name, { withTimezone: true });

const baseTimestamps = {
  createdAt: timestampTz("created_at").defaultNow().notNull(),
  updatedAt: timestampTz("updated_at").defaultNow().$onUpdateFn(() => new Date()).notNull(),
};

const softDeleteTimestamp = {
  deletedAt: timestampTz("deleted_at"),
};

export const userRoles = ["admin", "project_manager", "crew_member"] as const;
export const jobStatuses = ["open", "closed", "archived"] as const;
export const fileMediaTypes = ["document", "photo", "video"] as const;
export const folderScopes = ["resource", "job", "lead", "daily_log", "schedule_item"] as const;
export const folderScopeEnum = pgEnum("folder_scope", folderScopes);
export const leadStatuses = [
  "open",
  "in_negotiation",
  "won",
  "lost",
  "archived",
] as const;
export const projectTypes = [
  "countertops",
  "backsplash",
  "flooring",
  "custom",
  "none",
] as const;
export const reminderOptions = [
  "none",
  "1_hour_before",
  "2_hours_before",
  "4_hours_before",
  "8_hours_before",
  "12_hours_before",
  "1_day_before",
  "2_days_before",
] as const;
export const dailyLogCustomFieldTypes = [
  "text",
  "number",
  "date",
  "dropdown",
  "checkbox",
] as const;

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    role: varchar("role", { length: 50 }).notNull().default("crew_member"),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    phone: varchar("phone", { length: 20 }),
    isActive: boolean("is_active").notNull().default(true),
    inviteTokenHash: varchar("invite_token_hash", { length: 64 }),
    inviteTokenExpiresAt: timestampTz("invite_token_expires_at"),
    passwordSetAt: timestampTz("password_set_at"),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email).where(sql`${table.deletedAt} is null`),
    check("users_role_check", sql`${table.role} in ('admin', 'project_manager', 'crew_member')`),
    index("users_invite_token_hash_idx").on(table.inviteTokenHash),
  ],
);

export const safeUserColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: users.role,
  avatarUrl: users.avatarUrl,
  phone: users.phone,
  isActive: users.isActive,
  passwordSetAt: users.passwordSetAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  deletedAt: users.deletedAt,
} as const;

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    streetAddress: varchar("street_address", { length: 255 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    zipCode: varchar("zip_code", { length: 10 }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [index("clients_created_by_idx").on(table.createdBy)],
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    title: varchar("title", { length: 100 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 20 }),
    cellPhone: varchar("cell_phone", { length: 20 }),
    isPrimary: boolean("is_primary").default(false),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [index("client_contacts_client_id_idx").on(table.clientId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    title: varchar("title", { length: 255 }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("open"),
    streetAddress: varchar("street_address", { length: 255 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    zipCode: varchar("zip_code", { length: 10 }),
    contractPrice: numeric("contract_price", { precision: 12, scale: 2 }),
    jobType: varchar("job_type", { length: 100 }),
    workDays: json("work_days").$type<string[] | null>(),
    projectedStart: date("projected_start", { mode: "string" }),
    projectedCompletion: date("projected_completion", { mode: "string" }),
    actualStart: date("actual_start", { mode: "string" }),
    actualCompletion: date("actual_completion", { mode: "string" }),
    contractType: varchar("contract_type", { length: 50 }),
    internalNotes: text("internal_notes"),
    subVendorNotes: text("sub_vendor_notes"),
    squareFeet: numeric("square_feet", { precision: 10, scale: 2 }),
    permitNumber: varchar("permit_number", { length: 100 }),
    projectManagerId: uuid("project_manager_id").references(() => users.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    index("jobs_client_id_idx").on(table.clientId),
    index("jobs_created_by_idx").on(table.createdBy),
    index("jobs_project_manager_id_idx").on(table.projectManagerId),
    check("jobs_status_check", sql`${table.status} in ('open', 'closed', 'archived')`),
  ],
);

export const jobAssignees = pgTable(
  "job_assignees",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("job_assignees_job_user_unique").on(table.jobId, table.userId),
    index("job_assignees_job_id_idx").on(table.jobId),
    index("job_assignees_user_id_idx").on(table.userId),
  ],
);

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    title: varchar("title", { length: 255 }).notNull(),
    scope: folderScopeEnum("scope").notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    dailyLogId: uuid("daily_log_id").references(() => dailyLogs.id, { onDelete: "cascade" }),
    scheduleItemId: uuid("schedule_item_id").references(() => scheduleItems.id, { onDelete: "cascade" }),
    parentFolderId: uuid("parent_folder_id"),
    mediaType: varchar("media_type", { length: 50 }).notNull(),
    viewingPermissions: json("viewing_permissions").$type<Record<string, unknown> | null>(),
    uploadingPermissions: json("uploading_permissions").$type<Record<string, unknown> | null>(),
    isGlobal: boolean("is_global").default(false),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    foreignKey({
      columns: [table.parentFolderId],
      foreignColumns: [table.id],
      name: "folders_parent_folder_id_fkey",
    }).onDelete("cascade"),
    index("folders_scope_idx").on(table.scope),
    index("folders_lead_id_idx").on(table.leadId),
    index("folders_daily_log_id_idx").on(table.dailyLogId),
    index("folders_schedule_item_id_idx").on(table.scheduleItemId),
    index("folders_parent_folder_id_idx").on(table.parentFolderId),
    uniqueIndex("folders_job_title_parent_media_unique").on(
      table.jobId,
      table.title,
      table.parentFolderId,
      table.mediaType,
    ).where(
      sql`${table.deletedAt} is null and ${table.scope} = 'job' and ${table.jobId} is not null and ${table.parentFolderId} is not null`,
    ),
    uniqueIndex("folders_job_title_root_media_unique").on(
      table.jobId,
      table.title,
      table.mediaType,
    ).where(
      sql`${table.deletedAt} is null and ${table.scope} = 'job' and ${table.jobId} is not null and ${table.parentFolderId} is null`,
    ),
    uniqueIndex("folders_resource_title_parent_media_unique").on(
      table.title,
      table.parentFolderId,
      table.mediaType,
    ).where(
      sql`${table.deletedAt} is null and ${table.scope} = 'resource' and ${table.jobId} is null and ${table.parentFolderId} is not null`,
    ),
    uniqueIndex("folders_resource_title_root_media_unique").on(
      table.title,
      table.mediaType,
    ).where(
      sql`${table.deletedAt} is null and ${table.scope} = 'resource' and ${table.jobId} is null and ${table.parentFolderId} is null`,
    ),
  ],
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    fileUrl: varchar("file_url", { length: 500 }),
    fileSize: bigint("file_size", { mode: "number" }),
    mimeType: varchar("mime_type", { length: 100 }),
    note: text("note"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    index("files_folder_id_idx").on(table.folderId),
    index("files_uploaded_by_idx").on(table.uploadedBy),
    index("files_folder_created_id_idx").on(
      table.folderId,
      sql`${table.createdAt} DESC`,
      sql`${table.id} DESC`,
    ),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    title: varchar("title", { length: 255 }).notNull(),
    streetAddress: varchar("street_address", { length: 255 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    zipCode: varchar("zip_code", { length: 10 }),
    confidence: integer("confidence").default(0),
    projectedSalesDate: date("projected_sales_date", { mode: "string" }),
    estimatedRevenueMin: numeric("estimated_revenue_min", {
      precision: 12,
      scale: 2,
    }),
    estimatedRevenueMax: numeric("estimated_revenue_max", {
      precision: 12,
      scale: 2,
    }),
    status: varchar("status", { length: 50 }).notNull().default("open"),
    projectType: varchar("project_type", { length: 100 }),
    notes: text("notes"),
    leadSource: varchar("lead_source", { length: 255 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    index("leads_created_by_idx").on(table.createdBy),
    check("leads_status_check", sql`${table.status} in ('open', 'in_negotiation', 'won', 'lost', 'archived')`),
    check("leads_confidence_range", sql`${table.confidence} >= 0 and ${table.confidence} <= 100`),
  ],
);

export const leadContacts = pgTable(
  "lead_contacts",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    streetAddress: varchar("street_address", { length: 255 }),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    zipCode: varchar("zip_code", { length: 10 }),
    phone: varchar("phone", { length: 20 }),
    cellPhone: varchar("cell_phone", { length: 20 }),
    email: varchar("email", { length: 255 }).notNull(),
    label: varchar("label", { length: 100 }),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [index("lead_contacts_lead_id_idx").on(table.leadId)],
);

export const leadSalespeople = pgTable(
  "lead_salespeople",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("lead_salespeople_lead_user_unique").on(table.leadId, table.userId),
    index("lead_salespeople_user_id_idx").on(table.userId),
  ],
);

export const leadTags = pgTable(
  "lead_tags",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    tagName: varchar("tag_name", { length: 100 }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [unique("lead_tags_lead_tag_unique").on(table.leadId, table.tagName)],
);

export const leadSources = pgTable(
  "lead_sources",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    sourceName: varchar("source_name", { length: 100 }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [unique("lead_sources_lead_source_unique").on(table.leadId, table.sourceName)],
);

export const leadAttachments = pgTable(
  "lead_attachments",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("lead_attachments_lead_file_unique").on(table.leadId, table.fileId),
    index("lead_attachments_file_id_idx").on(table.fileId),
  ],
);

export const schedulePhases = pgTable(
  "schedule_phases",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    color: varchar("color", { length: 50 }).default("#e76f8a"),
    ...baseTimestamps,
  },
  (table) => [unique("schedule_phases_job_name_unique").on(table.jobId, table.name)],
);

export const scheduleTagSettings = pgTable(
  "schedule_tag_settings",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    ...baseTimestamps,
  },
  (table) => [unique("schedule_tag_settings_job_name_unique").on(table.jobId, table.name)],
);

export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
    schedulePhaseId: uuid("schedule_phase_id").references(() => schedulePhases.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    displayColor: varchar("display_color", { length: 50 }).notNull().default("#2563eb"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    workDays: integer("work_days").notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    isHourly: boolean("is_hourly").default(false),
    startTime: time("start_time"),
    endTime: time("end_time"),
    progress: integer("progress").default(0),
    reminder: varchar("reminder", { length: 100 }).default("none"),
    showOnGantt: boolean("show_on_gantt").default(true),
    visibleToEstimators: boolean("visible_to_estimators").default(true),
    visibleToInstallers: boolean("visible_to_installers").default(true),
    visibleToOfficeStaff: boolean("visible_to_office_staff").default(true),
    isComplete: boolean("is_complete").default(false),
    isPersonalTodo: boolean("is_personal_todo").default(false),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    index("schedule_items_created_by_idx").on(table.createdBy),
    index("schedule_items_job_id_idx").on(table.jobId),
    index("schedule_items_schedule_phase_id_idx").on(table.schedulePhaseId),
    check("schedule_items_progress_range", sql`${table.progress} >= 0 and ${table.progress} <= 100`),
  ],
);

export const scheduleItemAssignees = pgTable(
  "schedule_item_assignees",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    scheduleItemId: uuid("schedule_item_id").references(() => scheduleItems.id, {
      onDelete: "cascade",
    }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("schedule_item_assignees_item_user_unique").on(
      table.scheduleItemId,
      table.userId,
    ),
    index("schedule_item_assignees_user_id_idx").on(table.userId),
  ],
);

export const scheduleItemNotes = pgTable(
  "schedule_item_notes",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    scheduleItemId: uuid("schedule_item_id")
      .references(() => scheduleItems.id, { onDelete: "cascade" })
      .notNull(),
    note: text("note").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("schedule_item_notes_created_by_idx").on(table.createdBy),
    index("schedule_item_notes_schedule_item_id_idx").on(table.scheduleItemId),
  ],
);

export const scheduleItemAttachments = pgTable(
  "schedule_item_attachments",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    scheduleItemId: uuid("schedule_item_id")
      .references(() => scheduleItems.id, { onDelete: "cascade" })
      .notNull(),
    fileId: uuid("file_id")
      .references(() => files.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("schedule_item_attachments_item_file_unique").on(table.scheduleItemId, table.fileId),
    index("schedule_item_attachments_file_id_idx").on(table.fileId),
  ],
);

export const scheduleItemTodos = pgTable(
  "schedule_item_todos",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    scheduleItemId: uuid("schedule_item_id")
      .references(() => scheduleItems.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    isComplete: boolean("is_complete").default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
  },
  (table) => [
    index("schedule_item_todos_created_by_idx").on(table.createdBy),
    index("schedule_item_todos_schedule_item_id_idx").on(table.scheduleItemId),
  ],
);

export const scheduleSettings = pgTable("schedule_settings", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  jobId: uuid("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  defaultView: varchar("default_view", { length: 100 }).default("calendar_month"),
  showTimesOnMonthView: boolean("show_times_on_month_view").default(false),
  showJobNameOnAllListedJobs: boolean("show_job_name_on_all_listed_jobs").default(true),
  automaticallyMarkItemsComplete: boolean("automatically_mark_items_complete").default(false),
  includeHeaderOnPdfExports: boolean("include_header_on_pdf_exports").default(true),
  ...baseTimestamps,
});

export const scheduleBaselines = pgTable(
  "schedule_baselines",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    capturedAt: timestampTz("captured_at").defaultNow().notNull(),
    capturedBy: uuid("captured_by").references(() => users.id, { onDelete: "set null" }),
    itemsSnapshot: json("items_snapshot").$type<
      Array<{
        scheduleItemId: string;
        title: string;
        baselineStartDate: string;
        baselineEndDate: string;
      }>
    >(),
    ...baseTimestamps,
  },
  (table) => [index("schedule_baselines_captured_by_idx").on(table.capturedBy)],
);

export const scheduleWorkdayExceptionCategories = pgTable(
  "schedule_workday_exception_categories",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    ...baseTimestamps,
  },
  (table) => [unique("schedule_workday_exception_categories_job_name_unique").on(table.jobId, table.name)],
);

export const scheduleWorkdayExceptions = pgTable(
  "schedule_workday_exceptions",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    title: varchar("title", { length: 255 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    sameEveryYear: boolean("same_every_year").default(false),
    categoryId: uuid("category_id").references(() => scheduleWorkdayExceptionCategories.id, {
      onDelete: "set null",
    }),
    appliesToAllJobs: boolean("applies_to_all_jobs").default(false),
    jobIds: json("job_ids").$type<string[] | null>(),
    notes: varchar("notes", { length: 500 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
  },
  (table) => [
    index("schedule_workday_exceptions_category_id_idx").on(table.categoryId),
    index("schedule_workday_exceptions_created_by_idx").on(table.createdBy),
  ],
);

export const scheduleItemPredecessors = pgTable(
  "schedule_item_predecessors",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    scheduleItemId: uuid("schedule_item_id")
      .references(() => scheduleItems.id, { onDelete: "cascade" })
      .notNull(),
    predecessorId: uuid("predecessor_id")
      .references(() => scheduleItems.id, { onDelete: "cascade" })
      .notNull(),
    dependencyType: varchar("dependency_type", { length: 50 }).notNull(),
    lagDays: integer("lag_days").default(0).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [unique("schedule_item_predecessors_item_predecessor_unique").on(table.scheduleItemId, table.predecessorId)],
);

export const dailyLogs = pgTable(
  "daily_logs",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }).notNull(),
    logDate: date("log_date", { mode: "string" }).notNull(),
    title: varchar("title", { length: 255 }),
    notes: text("notes").notNull(),
    weatherData: json("weather_data").$type<Record<string, unknown> | null>(),
    includeWeather: boolean("include_weather").default(true),
    includeWeatherNotes: boolean("include_weather_notes").default(false),
    weatherNotes: text("weather_notes"),
    shareInternalUsers: boolean("share_internal_users").default(true),
    shareSubsVendors: boolean("share_subs_vendors").default(false),
    shareClient: boolean("share_client").default(false),
    isPrivate: boolean("is_private").default(false),
    customFieldValues: json("custom_field_values").$type<Record<string, string | number | boolean | null> | null>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestampTz("published_at"),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    index("daily_logs_created_by_idx").on(table.createdBy),
    index("daily_logs_job_id_idx").on(table.jobId),
  ],
);

export const dailyLogSettings = pgTable(
  "daily_log_settings",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    singleton: boolean("singleton").notNull().default(true),
    stampLocation: boolean("stamp_location").default(false),
    defaultNotes: text("default_notes").default(""),
    includeWeatherByDefault: boolean("include_weather_by_default").default(true),
    includeWeatherNotesByDefault: boolean("include_weather_notes_by_default").default(false),
    shareInternalUsersByDefault: boolean("share_internal_users_by_default").default(true),
    notifyInternalUsersByDefault: boolean("notify_internal_users_by_default").default(false),
    shareEstimatorsByDefault: boolean("share_estimators_by_default").default(false),
    notifyEstimatorsByDefault: boolean("notify_estimators_by_default").default(false),
    shareInstallersByDefault: boolean("share_installers_by_default").default(false),
    notifyInstallersByDefault: boolean("notify_installers_by_default").default(false),
    ...baseTimestamps,
  },
  (table) => [
    uniqueIndex("daily_log_settings_singleton_unique").on(table.singleton),
    check("daily_log_settings_singleton_check", sql`${table.singleton} = true`),
  ],
);

export const dailyLogCustomFields = pgTable(
  "daily_log_custom_fields",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    name: varchar("name", { length: 100 }).notNull(),
    fieldType: varchar("field_type", { length: 50 }).notNull(),
    options: json("options").$type<string[] | null>(),
    displayOrder: integer("display_order").notNull().default(0),
    ...baseTimestamps,
  },
  (table) => [unique("daily_log_custom_fields_name_unique").on(table.name)],
);

export const dailyLogAttachments = pgTable(
  "daily_log_attachments",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    dailyLogId: uuid("daily_log_id").references(() => dailyLogs.id, {
      onDelete: "cascade",
    }).notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("daily_log_attachments_log_file_unique").on(table.dailyLogId, table.fileId),
    index("daily_log_attachments_file_id_idx").on(table.fileId),
  ],
);

export const dailyLogTags = pgTable(
  "daily_log_tags",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    dailyLogId: uuid("daily_log_id").references(() => dailyLogs.id, {
      onDelete: "cascade",
    }).notNull(),
    tagName: varchar("tag_name", { length: 100 }).notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [unique("daily_log_tags_log_tag_unique").on(table.dailyLogId, table.tagName)],
);

export const dailyLogLikes = pgTable(
  "daily_log_likes",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    dailyLogId: uuid("daily_log_id")
      .references(() => dailyLogs.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("daily_log_likes_log_user_unique").on(table.dailyLogId, table.userId),
    index("daily_log_likes_user_id_idx").on(table.userId),
  ],
);

export const dailyLogComments = pgTable(
  "daily_log_comments",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    dailyLogId: uuid("daily_log_id")
      .references(() => dailyLogs.id, { onDelete: "cascade" })
      .notNull(),
    parentCommentId: uuid("parent_comment_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    mentions: json("mentions").$type<string[] | null>(),
    attachments: json("attachments").$type<
      Array<{
        name: string;
        // Legacy base64 / inline data URL form. Newer comments persist a
        // `fileId` and `fileUrl` instead and rely on the authenticated
        // /uploads/... stream. Both shapes coexist on read.
        url?: string | null;
        mimeType: string | null;
        fileId?: string | null;
        fileUrl?: string | null;
      }> | null
    >(),
    links: json("links").$type<string[] | null>(),
    reactions: json("reactions").$type<Record<string, string[]> | null>(),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    foreignKey({
      columns: [table.parentCommentId],
      foreignColumns: [table.id],
      name: "daily_log_comments_parent_comment_id_fkey",
    }).onDelete("cascade"),
    index("daily_log_comments_created_by_idx").on(table.createdBy),
    index("daily_log_comments_log_id_idx").on(table.dailyLogId),
    index("daily_log_comments_parent_comment_id_idx").on(table.parentCommentId),
  ],
);

export const dailyLogTodos = pgTable(
  "daily_log_todos",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    dailyLogId: uuid("daily_log_id")
      .references(() => dailyLogs.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    isComplete: boolean("is_complete").default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...baseTimestamps,
  },
  (table) => [
    index("daily_log_todos_created_by_idx").on(table.createdBy),
    index("daily_log_todos_log_id_idx").on(table.dailyLogId),
  ],
);

export const fileAnnotationToolTypes = [
  "highlighter",
  "pen",
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "sticky_note",
  "text_label",
] as const;

export const fileAnnotations = pgTable(
  "file_annotations",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    fileId: uuid("file_id")
      .references(() => files.id, { onDelete: "cascade" })
      .notNull(),
    page: integer("page").notNull(),
    toolType: varchar("tool_type", { length: 50 }).notNull(),
    color: varchar("color", { length: 50 }).notNull().default("#facc15"),
    thickness: numeric("thickness", { precision: 6, scale: 3 }).default("2"),
    opacity: numeric("opacity", { precision: 4, scale: 3 }).default("1"),
    normalizedX: numeric("normalized_x", { precision: 10, scale: 8 }).notNull(),
    normalizedY: numeric("normalized_y", { precision: 10, scale: 8 }).notNull(),
    normalizedW: numeric("normalized_w", { precision: 10, scale: 8 })
      .notNull()
      .default("0"),
    normalizedH: numeric("normalized_h", { precision: 10, scale: 8 })
      .notNull()
      .default("0"),
    content: text("content"),
    pathData: json("path_data").$type<Array<[number, number]> | null>(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...baseTimestamps,
    ...softDeleteTimestamp,
  },
  (table) => [
    index("file_annotations_file_id_page_idx").on(table.fileId, table.page),
    index("file_annotations_created_by_idx").on(table.createdBy),
    check(
      "file_annotations_tool_type_check",
      sql`${table.toolType} in ('highlighter','pen','line','arrow','rectangle','ellipse','sticky_note','text_label')`,
    ),
    check(
      "file_annotations_page_positive",
      sql`${table.page} >= 1`,
    ),
  ],
);

export const personalAccessTokenScopes = ["read", "read_write"] as const;

export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    scope: varchar("scope", { length: 32 }).notNull().default("read_write"),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
    lastFour: varchar("last_four", { length: 8 }).notNull(),
    expiresAt: timestampTz("expires_at"),
    lastUsedAt: timestampTz("last_used_at"),
    revokedAt: timestampTz("revoked_at"),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("personal_access_tokens_token_hash_unique").on(table.tokenHash),
    index("personal_access_tokens_user_id_idx").on(table.userId),
    check(
      "personal_access_tokens_scope_check",
      sql`${table.scope} in ('read', 'read_write')`,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    statusCode: integer("status_code").notNull(),
    responseBody: text("response_body").notNull(),
    responseContentType: varchar("response_content_type", { length: 100 }).notNull().default("application/json"),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
    expiresAt: timestampTz("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_user_key_method_path_unique").on(
      table.userId,
      table.key,
      table.method,
      table.path,
    ),
    index("idempotency_keys_expires_at_idx").on(table.expiresAt),
  ],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    action: varchar("action", { length: 100 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: json("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("activity_log_user_id_idx").on(table.userId),
    index("activity_log_entity_id_idx").on(table.entityId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobAssignee = typeof jobAssignees.$inferSelect;
export type NewJobAssignee = typeof jobAssignees.$inferInsert;
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadContact = typeof leadContacts.$inferSelect;
export type LeadSalesperson = typeof leadSalespeople.$inferSelect;
export type LeadTag = typeof leadTags.$inferSelect;
export type LeadSource = typeof leadSources.$inferSelect;
export type LeadAttachment = typeof leadAttachments.$inferSelect;
export type SchedulePhase = typeof schedulePhases.$inferSelect;
export type ScheduleTagSetting = typeof scheduleTagSettings.$inferSelect;
export type ScheduleItem = typeof scheduleItems.$inferSelect;
export type ScheduleItemAssignee = typeof scheduleItemAssignees.$inferSelect;
export type ScheduleItemNote = typeof scheduleItemNotes.$inferSelect;
export type ScheduleItemAttachment = typeof scheduleItemAttachments.$inferSelect;
export type ScheduleItemTodo = typeof scheduleItemTodos.$inferSelect;
export type ScheduleSetting = typeof scheduleSettings.$inferSelect;
export type ScheduleBaseline = typeof scheduleBaselines.$inferSelect;
export type ScheduleWorkdayExceptionCategory = typeof scheduleWorkdayExceptionCategories.$inferSelect;
export type ScheduleWorkdayException = typeof scheduleWorkdayExceptions.$inferSelect;
export type ScheduleItemPredecessor = typeof scheduleItemPredecessors.$inferSelect;
export type DailyLog = typeof dailyLogs.$inferSelect;
export type DailyLogSettings = typeof dailyLogSettings.$inferSelect;
export type DailyLogCustomField = typeof dailyLogCustomFields.$inferSelect;
export type DailyLogAttachment = typeof dailyLogAttachments.$inferSelect;
export type DailyLogTag = typeof dailyLogTags.$inferSelect;
export type DailyLogLike = typeof dailyLogLikes.$inferSelect;
export type DailyLogComment = typeof dailyLogComments.$inferSelect;
export type DailyLogTodo = typeof dailyLogTodos.$inferSelect;
export type FileAnnotation = typeof fileAnnotations.$inferSelect;
export type NewFileAnnotation = typeof fileAnnotations.$inferInsert;
export type PersonalAccessToken = typeof personalAccessTokens.$inferSelect;
export type NewPersonalAccessToken = typeof personalAccessTokens.$inferInsert;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type ActivityLogEntry = typeof activityLog.$inferSelect;

// Re-export agent-related schema (in-app AI agent — Task #109)
export * from "./agent";
