import { z } from "zod";
import { ApiClient, ApiError } from "./api-client";

export type McpToolHandlerArgs = Record<string, unknown>;

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (client: ApiClient, args: McpToolHandlerArgs) => Promise<unknown>;
};

const idString = z.string().min(1, "id is required");
const optionalIdempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    "Optional Idempotency-Key forwarded to the API; safe to retry with the same key.",
  );

function paginationShape() {
  return {
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  };
}

function pickId(args: Record<string, unknown>, key = "id"): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(400, `${key} is required`, null);
  }
  return value;
}

function takeIdempotencyKey(args: Record<string, unknown>): string | undefined {
  const value = args["idempotencyKey"];
  delete args["idempotencyKey"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function omit<T extends Record<string, unknown>>(args: T, ...keys: string[]): T {
  const out: Record<string, unknown> = { ...args };
  for (const key of keys) delete out[key];
  return out as T;
}

async function loadScheduleItemPayload(
  client: ApiClient,
  scheduleItemId: string,
  toolName: string,
): Promise<Record<string, unknown>> {
  const response = await client
    .request<{ item?: Record<string, unknown> } | Record<string, unknown> | null>({
      method: "GET",
      path: `/schedule-items/${scheduleItemId}`,
      toolName,
    })
    .then((r) => r.data);

  const item: Record<string, unknown> | null =
    response && typeof response === "object" && "item" in response
      ? ((response as { item?: Record<string, unknown> }).item ?? null)
      : (response as Record<string, unknown> | null);

  if (!item) {
    throw new ApiError(404, `Schedule item ${scheduleItemId} not found`, null);
  }

  const predecessors = Array.isArray(item["predecessors"])
    ? (item["predecessors"] as Array<Record<string, unknown>>).map((p) => ({
        scheduleItemId: String(p["scheduleItemId"] ?? ""),
        dependencyType: p["dependencyType"],
        lagDays: typeof p["lagDays"] === "number" ? p["lagDays"] : 0,
      }))
    : [];

  const assigneeIds = Array.isArray(item["assigneeIds"])
    ? (item["assigneeIds"] as unknown[]).filter((v): v is string => typeof v === "string")
    : Array.isArray(item["assignees"])
      ? (item["assignees"] as Array<Record<string, unknown>>)
          .map((a) => a["id"])
          .filter((v): v is string => typeof v === "string")
      : [];

  const tags = Array.isArray(item["tags"])
    ? (item["tags"] as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  return {
    title: item["title"],
    displayColor: item["displayColor"] ?? undefined,
    assigneeIds,
    notifyUserIds: [],
    startDate: item["startDate"],
    workDays: item["workDays"] ?? 1,
    endDate: item["endDate"] ?? null,
    isHourly: Boolean(item["isHourly"]),
    startTime: item["startTime"] ?? null,
    endTime: item["endTime"] ?? null,
    progress: typeof item["progress"] === "number" ? item["progress"] : 0,
    reminder: item["reminder"] ?? "none",
    notes: typeof item["notes"] === "string" ? item["notes"] : null,
    tags,
    predecessors,
    phaseId: item["phaseId"] ?? null,
    showOnGantt: item["showOnGantt"] !== false,
    visibleToEstimators: item["visibleToEstimators"] !== false,
    visibleToInstallers: item["visibleToInstallers"] !== false,
    visibleToOfficeStaff: item["visibleToOfficeStaff"] !== false,
    isComplete: Boolean(item["isComplete"]),
    isPersonalTodo: Boolean(item["isPersonalTodo"]),
  };
}

async function loadAndMergeScheduleItem(
  client: ApiClient,
  scheduleItemId: string,
  patch: Record<string, unknown>,
  toolName: string,
): Promise<Record<string, unknown>> {
  const current = await loadScheduleItemPayload(client, scheduleItemId, toolName);
  return { ...current, ...patch };
}

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
  // -------- Jobs --------
  {
    name: "list_jobs",
    title: "List jobs",
    description:
      "List jobs the calling user can see. Supports search, status filter, and both page/pageSize and cursor/limit pagination. Maps to GET /api/jobs.",
    inputSchema: z.object({
      ...paginationShape(),
      search: z.string().optional(),
      status: z.enum(["open", "closed", "archived"]).optional(),
    }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: "/jobs", query: args, toolName: "list_jobs" })
        .then((r) => r.data),
  },
  {
    name: "get_job",
    title: "Get a job",
    description:
      "Fetch a single job by id, including its assignees. Maps to GET /api/jobs/:id.",
    inputSchema: z.object({ id: idString }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: `/jobs/${pickId(args)}`, toolName: "get_job" })
        .then((r) => r.data),
  },
  {
    name: "create_job",
    title: "Create a job",
    description:
      "Create a new job. Same body as POST /api/jobs (title, status, address fields, projectedStart/Completion, contractType, projectManagerId, clientId, assigneeIds, etc.).",
    inputSchema: z
      .object({
        idempotencyKey: optionalIdempotencyKey,
      })
      .passthrough(),
    handler: (client, args) =>
      client
        .request({
          method: "POST",
          path: "/jobs",
          body: omit(args, "idempotencyKey"),
          toolName: "create_job",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data),
  },
  {
    name: "update_job",
    title: "Update a job",
    description: "Partially or fully update a job. Maps to PUT /api/jobs/:id.",
    inputSchema: z
      .object({ id: idString, idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: (client, args) => {
      const id = pickId(args);
      const idempotencyKey = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/jobs/${id}`,
          body: omit(args, "id", "idempotencyKey"),
          toolName: "update_job",
          idempotencyKey,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_job",
    title: "Delete (archive) a job",
    description:
      "Soft-delete (archive) a job. The same role checks as DELETE /api/jobs/:id apply.",
    inputSchema: z.object({ id: idString, idempotencyKey: optionalIdempotencyKey }),
    handler: (client, args) =>
      client
        .request({
          method: "DELETE",
          path: `/jobs/${pickId(args)}`,
          toolName: "delete_job",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data ?? { status: "deleted" }),
  },

  // -------- Leads --------
  {
    name: "list_leads",
    title: "List leads",
    description: "List leads. Maps to GET /api/leads.",
    inputSchema: z.object({
      ...paginationShape(),
      search: z.string().optional(),
      status: z.string().optional(),
    }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: "/leads", query: args, toolName: "list_leads" })
        .then((r) => r.data),
  },
  {
    name: "get_lead",
    title: "Get a lead",
    description: "Maps to GET /api/leads/:id.",
    inputSchema: z.object({ id: idString }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: `/leads/${pickId(args)}`, toolName: "get_lead" })
        .then((r) => r.data),
  },
  {
    name: "create_lead",
    title: "Create a lead",
    description: "Maps to POST /api/leads.",
    inputSchema: z
      .object({ idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: (client, args) =>
      client
        .request({
          method: "POST",
          path: "/leads",
          body: omit(args, "idempotencyKey"),
          toolName: "create_lead",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data),
  },
  {
    name: "update_lead",
    title: "Update a lead",
    description: "Maps to PUT /api/leads/:id.",
    inputSchema: z
      .object({ id: idString, idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/leads/${id}`,
          body: omit(args, "id", "idempotencyKey"),
          toolName: "update_lead",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_lead",
    title: "Delete a lead",
    description: "Maps to DELETE /api/leads/:id.",
    inputSchema: z.object({ id: idString, idempotencyKey: optionalIdempotencyKey }),
    handler: (client, args) =>
      client
        .request({
          method: "DELETE",
          path: `/leads/${pickId(args)}`,
          toolName: "delete_lead",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data ?? { status: "deleted" }),
  },

  // -------- Clients (companies) and contacts --------
  {
    name: "list_clients",
    title: "List clients",
    description: "Maps to GET /api/clients.",
    inputSchema: z.object({
      ...paginationShape(),
      search: z.string().optional(),
    }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: "/clients", query: args, toolName: "list_clients" })
        .then((r) => r.data),
  },
  {
    name: "get_client",
    title: "Get a client",
    description: "Maps to GET /api/clients/:id (contacts + jobs included).",
    inputSchema: z.object({ id: idString }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: `/clients/${pickId(args)}`, toolName: "get_client" })
        .then((r) => r.data),
  },
  {
    name: "create_client",
    title: "Create a client",
    description: "Maps to POST /api/clients.",
    inputSchema: z
      .object({ idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: (client, args) =>
      client
        .request({
          method: "POST",
          path: "/clients",
          body: omit(args, "idempotencyKey"),
          toolName: "create_client",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data),
  },
  {
    name: "update_client",
    title: "Update a client",
    description: "Maps to PUT /api/clients/:id.",
    inputSchema: z
      .object({ id: idString, idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/clients/${id}`,
          body: omit(args, "id", "idempotencyKey"),
          toolName: "update_client",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_client",
    title: "Delete a client",
    description: "Maps to DELETE /api/clients/:id.",
    inputSchema: z.object({ id: idString, idempotencyKey: optionalIdempotencyKey }),
    handler: (client, args) =>
      client
        .request({
          method: "DELETE",
          path: `/clients/${pickId(args)}`,
          toolName: "delete_client",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data ?? { status: "deleted" }),
  },
  {
    name: "list_contacts",
    title: "List contacts for a client",
    description: "List the contacts attached to a client. Maps to GET /api/clients/:id/contacts.",
    inputSchema: z.object({ clientId: idString }),
    handler: (client, args) => {
      const clientId = String(args["clientId"]);
      return client
        .request({
          method: "GET",
          path: `/clients/${clientId}/contacts`,
          toolName: "list_contacts",
        })
        .then((r) => r.data);
    },
  },
  {
    name: "get_contact",
    title: "Get a client contact",
    description: "Maps to GET /api/clients/:clientId/contacts/:contactId.",
    inputSchema: z.object({ clientId: idString, contactId: idString }),
    handler: (client, args) => {
      const clientId = String(args["clientId"]);
      const contactId = String(args["contactId"]);
      return client
        .request({
          method: "GET",
          path: `/clients/${clientId}/contacts/${contactId}`,
          toolName: "get_contact",
        })
        .then((r) => r.data);
    },
  },
  {
    name: "create_client_contact",
    title: "Create a client contact",
    description:
      "Add a contact (person) to a client (company). Maps to POST /api/clients/:id/contacts.",
    inputSchema: z
      .object({
        clientId: idString,
        firstName: z.string().min(1),
        lastName: z.string().min(1).optional(),
        title: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        cellPhone: z.string().optional(),
        isPrimary: z.boolean().optional(),
        idempotencyKey: optionalIdempotencyKey,
      })
      .passthrough(),
    handler: (client, args) => {
      const clientId = String(args["clientId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "POST",
          path: `/clients/${clientId}/contacts`,
          body: omit(args, "clientId", "idempotencyKey"),
          toolName: "create_client_contact",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "update_contact",
    title: "Update a client contact",
    description:
      "Update a client contact. Maps to PUT /api/clients/:clientId/contacts/:contactId. The PUT route expects the full contact payload, so all top-level fields you want to keep should be provided (firstName, lastName, title, email, phone, cellPhone, isPrimary).",
    inputSchema: z
      .object({
        clientId: idString,
        contactId: idString,
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        title: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        cellPhone: z.string().optional(),
        isPrimary: z.boolean().optional(),
        idempotencyKey: optionalIdempotencyKey,
      })
      .passthrough(),
    handler: (client, args) => {
      const clientId = String(args["clientId"]);
      const contactId = String(args["contactId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/clients/${clientId}/contacts/${contactId}`,
          body: omit(args, "clientId", "contactId", "idempotencyKey"),
          toolName: "update_contact",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_contact",
    title: "Delete a client contact",
    description:
      "Soft-delete a client contact. Maps to DELETE /api/clients/:clientId/contacts/:contactId.",
    inputSchema: z.object({
      clientId: idString,
      contactId: idString,
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const clientId = String(args["clientId"]);
      const contactId = String(args["contactId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "DELETE",
          path: `/clients/${clientId}/contacts/${contactId}`,
          toolName: "delete_contact",
          idempotencyKey: key,
        })
        .then((r) => r.data ?? { status: "deleted" });
    },
  },

  // -------- Daily logs --------
  {
    name: "list_daily_logs",
    title: "List daily logs for a job",
    description: "Maps to GET /api/jobs/:jobId/daily-logs.",
    inputSchema: z.object({
      jobId: idString,
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
      keywords: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      tag: z.string().optional(),
    }),
    handler: (client, args) => {
      const jobId = String(args["jobId"]);
      return client
        .request({
          method: "GET",
          path: `/jobs/${jobId}/daily-logs`,
          query: omit(args, "jobId"),
          toolName: "list_daily_logs",
        })
        .then((r) => r.data);
    },
  },
  {
    name: "get_daily_log",
    title: "Get a daily log",
    description: "Maps to GET /api/daily-logs/:id.",
    inputSchema: z.object({ id: idString }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: `/daily-logs/${pickId(args)}`, toolName: "get_daily_log" })
        .then((r) => r.data),
  },
  {
    name: "create_daily_log",
    title: "Create a daily log",
    description: "Maps to POST /api/jobs/:jobId/daily-logs.",
    inputSchema: z
      .object({ jobId: idString, idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: (client, args) => {
      const jobId = String(args["jobId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "POST",
          path: `/jobs/${jobId}/daily-logs`,
          body: omit(args, "jobId", "idempotencyKey"),
          toolName: "create_daily_log",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "update_daily_log",
    title: "Update a daily log",
    description: "Maps to PUT /api/daily-logs/:id.",
    inputSchema: z
      .object({ id: idString, idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/daily-logs/${id}`,
          body: omit(args, "id", "idempotencyKey"),
          toolName: "update_daily_log",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_daily_log",
    title: "Delete a daily log",
    description: "Maps to DELETE /api/daily-logs/:id.",
    inputSchema: z.object({ id: idString, idempotencyKey: optionalIdempotencyKey }),
    handler: (client, args) =>
      client
        .request({
          method: "DELETE",
          path: `/daily-logs/${pickId(args)}`,
          toolName: "delete_daily_log",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data ?? { status: "deleted" }),
  },
  {
    name: "add_todo",
    title: "Add a todo to a daily log",
    description:
      "Append a todo to a daily log. Maps to POST /api/daily-logs/:id/todos { title }.",
    inputSchema: z.object({
      dailyLogId: idString,
      title: z.string().min(1),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const dailyLogId = String(args["dailyLogId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "POST",
          path: `/daily-logs/${dailyLogId}/todos`,
          body: { title: args["title"] },
          toolName: "add_todo",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "complete_todo",
    title: "Toggle a daily-log todo",
    description:
      "Mark a daily-log todo complete or incomplete. Maps to POST /api/daily-logs/:id/todos/:todoId/toggle { isComplete }.",
    inputSchema: z.object({
      dailyLogId: idString,
      todoId: idString,
      isComplete: z.boolean(),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const dailyLogId = String(args["dailyLogId"]);
      const todoId = String(args["todoId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "POST",
          path: `/daily-logs/${dailyLogId}/todos/${todoId}/toggle`,
          body: { isComplete: Boolean(args["isComplete"]) },
          toolName: "complete_todo",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },

  // -------- Schedule items --------
  {
    name: "list_schedule_items",
    title: "List schedule items for a job",
    description: "Maps to GET /api/jobs/:jobId/schedule.",
    inputSchema: z
      .object({ jobId: idString })
      .passthrough(),
    handler: (client, args) => {
      const jobId = String(args["jobId"]);
      return client
        .request({
          method: "GET",
          path: `/jobs/${jobId}/schedule`,
          query: omit(args, "jobId"),
          toolName: "list_schedule_items",
        })
        .then((r) => r.data);
    },
  },
  {
    name: "get_schedule_item",
    title: "Get a schedule item",
    description: "Maps to GET /api/schedule-items/:id.",
    inputSchema: z.object({ id: idString }),
    handler: (client, args) =>
      client
        .request({
          method: "GET",
          path: `/schedule-items/${pickId(args)}`,
          toolName: "get_schedule_item",
        })
        .then((r) => r.data),
  },
  {
    name: "create_schedule_item",
    title: "Create a schedule item",
    description:
      "Create a schedule item under a job. Maps to POST /api/jobs/:jobId/schedule.",
    inputSchema: z
      .object({
        jobId: idString,
        title: z.string().min(1),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        isHourly: z.boolean().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        progress: z.number().int().min(0).max(100).optional(),
        notes: z.string().optional(),
        assigneeIds: z.array(z.string()).optional(),
        isPersonalTodo: z.boolean().optional(),
        idempotencyKey: optionalIdempotencyKey,
      })
      .passthrough(),
    handler: (client, args) => {
      const jobId = String(args["jobId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "POST",
          path: `/jobs/${jobId}/schedule`,
          body: omit(args, "jobId", "idempotencyKey"),
          toolName: "create_schedule_item",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "update_schedule_item",
    title: "Patch fields on a schedule item",
    description:
      "Patch one or more fields on a schedule item. Reads the current item, merges your patch into it, and PUTs the result back to /api/schedule-items/:id. Supports any field accepted by the create payload.",
    inputSchema: z
      .object({ id: idString, idempotencyKey: optionalIdempotencyKey })
      .passthrough(),
    handler: async (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      const patch = omit(args, "id", "idempotencyKey");
      const merged = await loadAndMergeScheduleItem(client, id, patch, "update_schedule_item");
      return client
        .request({
          method: "PUT",
          path: `/schedule-items/${id}`,
          body: merged,
          toolName: "update_schedule_item",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_schedule_item",
    title: "Delete a schedule item",
    description: "Maps to DELETE /api/schedule-items/:id.",
    inputSchema: z.object({ id: idString, idempotencyKey: optionalIdempotencyKey }),
    handler: (client, args) =>
      client
        .request({
          method: "DELETE",
          path: `/schedule-items/${pickId(args)}`,
          toolName: "delete_schedule_item",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data ?? { status: "deleted" }),
  },
  {
    name: "add_schedule_assignee",
    title: "Assign a user to a schedule item",
    description:
      "Convenience wrapper that adds a userId to a schedule item's assignees. Reads the current item, merges the new assignee in, and PUTs the result back to /api/schedule-items/:id.",
    inputSchema: z.object({
      scheduleItemId: idString,
      userId: idString,
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: async (client, args) => {
      const scheduleItemId = String(args["scheduleItemId"]);
      const userId = String(args["userId"]);
      const key = takeIdempotencyKey(args);
      const current = await loadScheduleItemPayload(client, scheduleItemId, "add_schedule_assignee");
      const existing = Array.isArray(current["assigneeIds"])
        ? (current["assigneeIds"] as unknown[]).filter(
            (v): v is string => typeof v === "string",
          )
        : [];
      const merged = Array.from(new Set([...existing, userId]));
      return client
        .request({
          method: "PUT",
          path: `/schedule-items/${scheduleItemId}`,
          body: { ...current, assigneeIds: merged },
          toolName: "add_schedule_assignee",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "mark_schedule_done",
    title: "Mark a schedule item complete",
    description:
      "Convenience wrapper that flips a schedule item's progress to 100 and isComplete to true. Reads the current item, merges the completion flags in, and PUTs the result back to /api/schedule-items/:id.",
    inputSchema: z.object({
      id: idString,
      isComplete: z.boolean().optional().default(true),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: async (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      const isComplete = args["isComplete"] === false ? false : true;
      const patch = isComplete
        ? { isComplete: true, progress: 100 }
        : { isComplete: false, progress: 0 };
      const merged = await loadAndMergeScheduleItem(client, id, patch, "mark_schedule_done");
      return client
        .request({
          method: "PUT",
          path: `/schedule-items/${id}`,
          body: merged,
          toolName: "mark_schedule_done",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },

  // -------- Folders + files --------
  {
    name: "list_folders",
    title: "List folders for a job",
    description: "Maps to GET /api/jobs/:jobId/folders.",
    inputSchema: z.object({
      jobId: idString,
      mediaType: z.enum(["document", "photo", "video"]).optional(),
      parentFolderId: z.string().optional(),
    }),
    handler: (client, args) => {
      const jobId = String(args["jobId"]);
      return client
        .request({
          method: "GET",
          path: `/jobs/${jobId}/folders`,
          query: omit(args, "jobId"),
          toolName: "list_folders",
        })
        .then((r) => r.data);
    },
  },
  {
    name: "create_folder",
    title: "Create a folder",
    description: "Maps to POST /api/jobs/:jobId/folders.",
    inputSchema: z.object({
      jobId: idString,
      title: z.string().min(1),
      mediaType: z.enum(["document", "photo", "video"]).default("document"),
      parentFolderId: z.string().optional(),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const jobId = String(args["jobId"]);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "POST",
          path: `/jobs/${jobId}/folders`,
          body: omit(args, "jobId", "idempotencyKey"),
          toolName: "create_folder",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "get_folder",
    title: "Get folder metadata",
    description: "Fetch a single folder's metadata. Maps to GET /api/folders/:id.",
    inputSchema: z.object({ id: idString }),
    handler: (client, args) =>
      client
        .request({
          method: "GET",
          path: `/folders/${pickId(args)}`,
          toolName: "get_folder",
        })
        .then((r) => r.data),
  },
  {
    name: "rename_folder",
    title: "Rename a folder",
    description: "Maps to PUT /api/folders/:id with { title }.",
    inputSchema: z.object({
      id: idString,
      title: z.string().min(1),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/folders/${id}`,
          body: { title: args["title"] },
          toolName: "rename_folder",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "move_folder",
    title: "Move a folder",
    description:
      "Move a folder under a different parent in the same job + media type. Pass `destinationFolderId: null` to move to the job root. Maps to PUT /api/folders/:id/move.",
    inputSchema: z.object({
      id: idString,
      destinationFolderId: z.string().nullable().optional(),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      const destination =
        args["destinationFolderId"] === undefined ? null : args["destinationFolderId"];
      return client
        .request({
          method: "PUT",
          path: `/folders/${id}/move`,
          body: { destinationFolderId: destination },
          toolName: "move_folder",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_folder",
    title: "Delete a folder",
    description: "Maps to DELETE /api/folders/:id (soft delete).",
    inputSchema: z.object({ id: idString, idempotencyKey: optionalIdempotencyKey }),
    handler: (client, args) =>
      client
        .request({
          method: "DELETE",
          path: `/folders/${pickId(args)}`,
          toolName: "delete_folder",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data ?? { status: "deleted" }),
  },
  {
    name: "list_files",
    title: "List files in a folder",
    description: "Maps to GET /api/folders/:id/files.",
    inputSchema: z.object({
      folderId: idString,
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    }),
    handler: (client, args) => {
      const folderId = String(args["folderId"]);
      return client
        .request({
          method: "GET",
          path: `/folders/${folderId}/files`,
          query: omit(args, "folderId"),
          toolName: "list_files",
        })
        .then((r) => r.data);
    },
  },
  {
    name: "attach_file",
    title: "Attach a file to a folder from a base64 buffer",
    description:
      "Upload a file to a folder. Provide the bytes inline as base64 in `contentBase64` along with `filename` and `mimeType`. Maps to POST /api/folders/:id/files (multipart/form-data). To avoid SSRF, this tool only accepts inline content — fetch the file on the agent side first if it lives at a remote URL.",
    inputSchema: z.object({
      folderId: idString,
      filename: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(255),
      contentBase64: z.string().min(1),
      note: z.string().max(2_000).optional(),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: async (client, args) => {
      const folderId = String(args["folderId"]);
      const filename = String(args["filename"]);
      const mimeType = String(args["mimeType"]);
      const note = typeof args["note"] === "string" ? (args["note"] as string) : undefined;
      const idempotencyKey = takeIdempotencyKey(args);

      const base64 = String(args["contentBase64"]);
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, "base64");
      } catch {
        throw new ApiError(400, "contentBase64 is not valid base64", null);
      }
      if (buffer.length === 0) {
        throw new ApiError(400, "contentBase64 decoded to zero bytes", null);
      }

      const formData = new FormData();
      formData.append(
        "files",
        new Blob([new Uint8Array(buffer)], { type: mimeType }),
        filename,
      );
      if (note) formData.append("note", note);

      const res = await client.requestMultipart({
        path: `/folders/${folderId}/files`,
        body: formData,
        toolName: "attach_file",
        idempotencyKey,
      });
      return res.data;
    },
  },
  {
    name: "get_file",
    title: "Get file metadata",
    description: "Fetch a single file's metadata. Maps to GET /api/files/:id.",
    inputSchema: z.object({ id: idString }),
    handler: (client, args) =>
      client
        .request({
          method: "GET",
          path: `/files/${pickId(args)}`,
          toolName: "get_file",
        })
        .then((r) => r.data),
  },
  {
    name: "rename_file",
    title: "Rename a file",
    description: "Rename a file. Maps to PUT /api/files/:id with { originalName }.",
    inputSchema: z.object({
      id: idString,
      originalName: z.string().min(1).max(255),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/files/${id}`,
          body: { originalName: args["originalName"] },
          toolName: "rename_file",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "move_file",
    title: "Move a file",
    description:
      "Move a file into a different folder under the same job + media type. Maps to PUT /api/files/:id/move.",
    inputSchema: z.object({
      id: idString,
      destinationFolderId: idString,
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const id = pickId(args);
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: "PUT",
          path: `/files/${id}/move`,
          body: { destinationFolderId: args["destinationFolderId"] },
          toolName: "move_file",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
  {
    name: "delete_file",
    title: "Delete a file",
    description: "Maps to DELETE /api/files/:id (soft delete).",
    inputSchema: z.object({ id: idString, idempotencyKey: optionalIdempotencyKey }),
    handler: (client, args) =>
      client
        .request({
          method: "DELETE",
          path: `/files/${pickId(args)}`,
          toolName: "delete_file",
          idempotencyKey: takeIdempotencyKey(args),
        })
        .then((r) => r.data ?? { status: "deleted" }),
  },

  // -------- Search + activity --------
  {
    name: "search",
    title: "Global search",
    description: "Search across jobs, leads, clients, files, and daily logs. Maps to GET /api/search.",
    inputSchema: z.object({
      q: z.string().min(1),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(50).optional(),
    }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: "/search", query: args, toolName: "search" })
        .then((r) => r.data),
  },
  {
    name: "read_activity",
    title: "Read the activity feed",
    description:
      "Read the activity log. Filter by jobId, entityType, or entityId. Maps to GET /api/activity.",
    inputSchema: z.object({
      jobId: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: "/activity", query: args, toolName: "read_activity" })
        .then((r) => r.data),
  },

  // -------- Users --------
  {
    name: "list_users",
    title: "List workspace users",
    description:
      "Maps to GET /api/users. Pass `roles` to filter by one or more roles; the API does not currently expose a free-text search.",
    inputSchema: z.object({
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
      roles: z
        .array(z.enum(["admin", "project_manager", "crew_member"]))
        .optional()
        .describe("One or more roles to filter by."),
    }),
    handler: (client, args) =>
      client
        .request({ method: "GET", path: "/users", query: args, toolName: "list_users" })
        .then((r) => r.data),
  },
  {
    name: "whoami",
    title: "Inspect the calling user",
    description: "Returns the authenticated user (the PAT owner). Maps to GET /api/users/me.",
    inputSchema: z.object({}),
    handler: (client) =>
      client
        .request({ method: "GET", path: "/users/me", toolName: "whoami" })
        .then((r) => r.data),
  },

  // -------- Escape hatch --------
  {
    name: "request",
    title: "Raw API request (escape hatch)",
    description:
      "Send an arbitrary request to the CAD Stone REST API documented in /openapi.json. Use this when no tool covers the field you need. The server applies the same auth, validation, and activity logging as any other route.",
    inputSchema: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().min(1).describe("Path under /api, e.g. /jobs or /jobs/:id"),
      query: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      body: z.unknown().optional(),
      idempotencyKey: optionalIdempotencyKey,
    }),
    handler: (client, args) => {
      const key = takeIdempotencyKey(args);
      return client
        .request({
          method: args["method"] as "GET",
          path: String(args["path"]),
          query: args["query"] as Record<string, string | number | boolean | null> | undefined,
          body: args["body"],
          toolName: "request",
          idempotencyKey: key,
        })
        .then((r) => r.data);
    },
  },
];

const paginationOut = z
  .object({
    page: z.number().optional(),
    pageSize: z.number().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    total: z.number().optional(),
    totalItems: z.number().optional(),
    totalPages: z.number().optional(),
    hasMore: z.boolean().optional(),
    nextCursor: z.string().nullable().optional(),
  })
  .passthrough();

const listOut = (key: string) =>
  z
    .object({
      [key]: z.array(z.unknown()),
      pagination: paginationOut.optional(),
    })
    .passthrough();

const itemOut = (key: string) =>
  z
    .object({
      [key]: z.unknown(),
    })
    .passthrough();

const deleteOut = z
  .object({
    success: z.boolean().optional(),
    status: z.string().optional(),
  })
  .passthrough();

const objectOut = z.object({}).passthrough();

const searchOut = z
  .object({
    results: z.array(z.unknown()),
    pagination: paginationOut.optional(),
  })
  .passthrough();

const activityOut = z
  .object({
    data: z.array(z.unknown()),
    pagination: paginationOut.optional(),
  })
  .passthrough();

const usersListOut = z
  .object({
    users: z.array(z.unknown()),
    data: z.array(z.unknown()).optional(),
    pagination: paginationOut.optional(),
  })
  .passthrough();

export const TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  list_jobs: listOut("jobs"),
  get_job: itemOut("job"),
  create_job: itemOut("job"),
  update_job: itemOut("job"),
  delete_job: deleteOut,

  list_leads: listOut("leads"),
  get_lead: objectOut,
  create_lead: objectOut,
  update_lead: objectOut,
  delete_lead: deleteOut,

  list_clients: listOut("clients"),
  get_client: itemOut("client"),
  create_client: itemOut("client"),
  update_client: itemOut("client"),
  delete_client: deleteOut,

  list_contacts: listOut("contacts"),
  get_contact: itemOut("contact"),
  create_client_contact: itemOut("contact"),
  update_contact: itemOut("contact"),
  delete_contact: deleteOut,

  list_daily_logs: listOut("logs"),
  get_daily_log: objectOut,
  create_daily_log: objectOut,
  update_daily_log: objectOut,
  delete_daily_log: deleteOut,
  add_todo: objectOut,
  complete_todo: objectOut,

  list_schedule_items: activityOut,
  get_schedule_item: objectOut,
  create_schedule_item: objectOut,
  update_schedule_item: objectOut,
  delete_schedule_item: deleteOut,
  add_schedule_assignee: objectOut,
  mark_schedule_done: objectOut,

  list_folders: objectOut,
  create_folder: itemOut("folder"),
  get_folder: itemOut("folder"),
  rename_folder: itemOut("folder"),
  move_folder: itemOut("folder"),
  delete_folder: deleteOut,

  list_files: objectOut,
  attach_file: objectOut,
  get_file: itemOut("file"),
  rename_file: itemOut("file"),
  move_file: itemOut("file"),
  delete_file: deleteOut,

  search: searchOut,
  read_activity: activityOut,
  list_users: usersListOut,
  whoami: itemOut("user"),
};
