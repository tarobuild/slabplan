import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./index";

const createId = () => crypto.randomUUID();
const timestampTz = (name: string) => timestamp(name, { withTimezone: true });

const baseTimestamps = {
  createdAt: timestampTz("created_at").defaultNow().notNull(),
  updatedAt: timestampTz("updated_at").defaultNow().$onUpdateFn(() => new Date()).notNull(),
};

export const agentMessageRoles = ["user", "assistant", "system", "tool"] as const;

// Allowed values for `agent_messages.stopped_reason`. Includes both the
// Anthropic SDK stop_reason values that the orchestrator forwards verbatim
// and our own sentinels (`aborted`, `api_error`, `max_iterations`). The
// OpenAI-style values (`length`, `content_filter`, `tool_calls`, `error`)
// are tolerated for forward compatibility with future model adapters.
export const agentMessageStoppedReasons = [
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
  "pause_turn",
  "refusal",
  "aborted",
  "api_error",
  "max_iterations",
  "length",
  "content_filter",
  "tool_calls",
  "error",
] as const;

export type AgentMessageRole = (typeof agentMessageRoles)[number];
export type AgentMessageStoppedReason = (typeof agentMessageStoppedReasons)[number];

export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull().default("New conversation"),
    pinned: boolean("pinned").default(false).notNull(),
    lastMessageAt: timestampTz("last_message_at").defaultNow().notNull(),
    ...baseTimestamps,
  },
  (table) => [
    index("agent_conversations_organization_id_idx").on(table.organizationId),
    index("agent_conversations_user_id_idx").on(table.userId),
    index("agent_conversations_user_last_message_idx").on(
      table.userId,
      sql`${table.lastMessageAt} DESC`,
    ),
  ],
);

export type AgentCitation = {
  kind:
    | "job"
    | "lead"
    | "client"
    | "file"
    | "folder"
    | "daily_log"
    | "schedule_item"
    | "user"
    | "activity";
  id: string;
  label?: string;
  jobId?: string;
};

export type AgentToolCall = {
  id: string;
  name: string;
  input: unknown;
  status: "ok" | "error";
  resultSummary?: string;
  errorMessage?: string;
  durationMs?: number;
  citations?: AgentCitation[];
};

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    conversationId: uuid("conversation_id")
      .references(() => agentConversations.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    // The displayed text for the message (assistant text or user prompt).
    content: text("content").notNull().default(""),
    // Tool calls invoked while producing this message (assistant only).
    toolCalls: json("tool_calls").$type<AgentToolCall[] | null>(),
    // Citations rendered as deep-link chips (assistant only).
    citations: json("citations").$type<AgentCitation[] | null>(),
    // Token accounting for usage caps.
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Set when the assistant message was cut off by a usage limit.
    stoppedReason: varchar("stopped_reason", { length: 50 }),
    createdAt: timestampTz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_messages_organization_id_idx").on(table.organizationId),
    index("agent_messages_conversation_id_idx").on(
      table.conversationId,
      sql`${table.createdAt} ASC`,
    ),
    check(
      "agent_messages_role_check",
      sql`${table.role} in ('user', 'assistant', 'system', 'tool')`,
    ),
    check(
      "agent_messages_stopped_reason_check",
      sql`${table.stoppedReason} is null or ${table.stoppedReason} in ('end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'aborted', 'api_error', 'max_iterations', 'length', 'content_filter', 'tool_calls', 'error')`,
    ),
  ],
);

export const agentUsageMonthly = pgTable(
  "agent_usage_monthly",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // YYYY-MM bucket (UTC).
    yearMonth: varchar("year_month", { length: 7 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    requests: integer("requests").notNull().default(0),
    ...baseTimestamps,
  },
  (table) => [
    uniqueIndex("agent_usage_monthly_org_user_month_unique")
      .on(table.organizationId, table.userId, table.yearMonth)
      .where(sql`${table.organizationId} is not null`),
    uniqueIndex("agent_usage_monthly_legacy_user_month_unique")
      .on(table.userId, table.yearMonth)
      .where(sql`${table.organizationId} is null`),
    index("agent_usage_monthly_organization_id_idx").on(table.organizationId),
  ],
);

export type AgentConversation = typeof agentConversations.$inferSelect;
export type NewAgentConversation = typeof agentConversations.$inferInsert;
export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
export type AgentUsageMonthly = typeof agentUsageMonthly.$inferSelect;
