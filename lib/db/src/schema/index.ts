import crypto from "node:crypto";
import {
  bigint,
  boolean,
  date,
  foreignKey,
  integer,
  json,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createId = () => crypto.randomUUID();

const baseTimestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
};

const softDeleteTimestamp = {
  deletedAt: timestamp("deleted_at"),
};

export const userRoles = ["admin", "project_manager", "crew_member"] as const;
export const jobStatuses = ["open", "closed", "archived"] as const;
export const fileMediaTypes = ["document", "photo", "video"] as const;
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("crew_member"),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  phone: varchar("phone", { length: 20 }),
  ...baseTimestamps,
  ...softDeleteTimestamp,
});

export const jobs = pgTable("jobs", {
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
  createdBy: uuid("created_by").references(() => users.id),
  ...baseTimestamps,
  ...softDeleteTimestamp,
});

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    title: varchar("title", { length: 255 }).notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
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
    unique("folders_job_title_parent_media_unique").on(
      table.jobId,
      table.title,
      table.parentFolderId,
      table.mediaType,
    ),
  ],
);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  fileUrl: varchar("file_url", { length: 500 }),
  fileSize: bigint("file_size", { mode: "number" }),
  mimeType: varchar("mime_type", { length: 100 }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  ...baseTimestamps,
  ...softDeleteTimestamp,
});

export const leads = pgTable("leads", {
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
  createdBy: uuid("created_by").references(() => users.id),
  ...baseTimestamps,
  ...softDeleteTimestamp,
});

export const leadContacts = pgTable("lead_contacts", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
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
});

export const leadSalespeople = pgTable(
  "lead_salespeople",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("lead_salespeople_lead_user_unique").on(table.leadId, table.userId)],
);

export const leadTags = pgTable(
  "lead_tags",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    tagName: varchar("tag_name", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("lead_tags_lead_tag_unique").on(table.leadId, table.tagName)],
);

export const leadSources = pgTable(
  "lead_sources",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    sourceName: varchar("source_name", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("lead_sources_lead_source_unique").on(table.leadId, table.sourceName)],
);

export const leadAttachments = pgTable(
  "lead_attachments",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("lead_attachments_lead_file_unique").on(table.leadId, table.fileId)],
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

export const scheduleItems = pgTable("schedule_items", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
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
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  ...baseTimestamps,
  ...softDeleteTimestamp,
});

export const scheduleItemAssignees = pgTable(
  "schedule_item_assignees",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    scheduleItemId: uuid("schedule_item_id").references(() => scheduleItems.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("schedule_item_assignees_item_user_unique").on(
      table.scheduleItemId,
      table.userId,
    ),
  ],
);

export const scheduleItemNotes = pgTable("schedule_item_notes", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  scheduleItemId: uuid("schedule_item_id")
    .references(() => scheduleItems.id, { onDelete: "cascade" })
    .notNull(),
  note: text("note").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("schedule_item_attachments_item_file_unique").on(table.scheduleItemId, table.fileId),
  ],
);

export const scheduleItemTodos = pgTable("schedule_item_todos", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  scheduleItemId: uuid("schedule_item_id")
    .references(() => scheduleItems.id, { onDelete: "cascade" })
    .notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  isComplete: boolean("is_complete").default(false),
  createdBy: uuid("created_by").references(() => users.id),
  ...baseTimestamps,
});

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

export const scheduleBaselines = pgTable("schedule_baselines", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  jobId: uuid("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  capturedBy: uuid("captured_by").references(() => users.id),
  itemsSnapshot: json("items_snapshot").$type<
    Array<{
      scheduleItemId: string;
      title: string;
      baselineStartDate: string;
      baselineEndDate: string;
    }>
  >(),
  ...baseTimestamps,
});

export const scheduleWorkdayExceptionCategories = pgTable(
  "schedule_workday_exception_categories",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    ...baseTimestamps,
  },
  (table) => [unique("schedule_workday_exception_categories_job_name_unique").on(table.jobId, table.name)],
);

export const scheduleWorkdayExceptions = pgTable("schedule_workday_exceptions", {
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
  createdBy: uuid("created_by").references(() => users.id),
  ...baseTimestamps,
});

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("schedule_item_predecessors_item_predecessor_unique").on(table.scheduleItemId, table.predecessorId)],
);

export const dailyLogs = pgTable("daily_logs", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
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
  createdBy: uuid("created_by").references(() => users.id),
  publishedAt: timestamp("published_at"),
  ...baseTimestamps,
  ...softDeleteTimestamp,
});

export const dailyLogSettings = pgTable("daily_log_settings", {
  id: uuid("id").primaryKey().$defaultFn(createId),
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
});

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
    }),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("daily_log_attachments_log_file_unique").on(table.dailyLogId, table.fileId)],
);

export const dailyLogTags = pgTable(
  "daily_log_tags",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    dailyLogId: uuid("daily_log_id").references(() => dailyLogs.id, {
      onDelete: "cascade",
    }),
    tagName: varchar("tag_name", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("daily_log_likes_log_user_unique").on(table.dailyLogId, table.userId)],
);

export const dailyLogComments = pgTable(
  "daily_log_comments",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    dailyLogId: uuid("daily_log_id")
      .references(() => dailyLogs.id, { onDelete: "cascade" })
      .notNull(),
    parentCommentId: uuid("parent_comment_id"),
    createdBy: uuid("created_by").references(() => users.id),
    body: text("body").notNull(),
    mentions: json("mentions").$type<string[] | null>(),
    attachments: json("attachments").$type<
      Array<{
        name: string;
        url: string;
        mimeType: string | null;
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
  ],
);

export const dailyLogTodos = pgTable("daily_log_todos", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  dailyLogId: uuid("daily_log_id")
    .references(() => dailyLogs.id, { onDelete: "cascade" })
    .notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  isComplete: boolean("is_complete").default(false),
  createdBy: uuid("created_by").references(() => users.id),
  ...baseTimestamps,
});

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  userId: uuid("user_id").references(() => users.id),
  metadata: json("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
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
export type ActivityLogEntry = typeof activityLog.$inferSelect;
