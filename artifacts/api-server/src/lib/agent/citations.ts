import type { AgentCitation } from "@workspace/db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function pushUnique(out: AgentCitation[], cite: AgentCitation): void {
  if (!cite.id || !isUuid(cite.id)) return;
  for (const existing of out) {
    if (existing.kind === cite.kind && existing.id === cite.id) return;
  }
  out.push(cite);
}

function labelFromRow(row: Record<string, unknown>, fallback: string): string {
  for (const key of ["title", "name", "fullName", "displayName", "filename", "originalName", "companyName"]) {
    const v = row[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return fallback;
}

function harvestJob(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (isUuid(row.id)) {
    pushUnique(out, { kind: "job", id: row.id, label: labelFromRow(row, "Job") });
  }
}

function harvestLead(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (isUuid(row.id)) {
    pushUnique(out, { kind: "lead", id: row.id, label: labelFromRow(row, "Lead") });
  }
}

function harvestClient(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (isUuid(row.id)) {
    pushUnique(out, { kind: "client", id: row.id, label: labelFromRow(row, "Client") });
  }
}

function harvestFile(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (!isUuid(row.id)) return;
  const jobId =
    isUuid(row.jobId) ? (row.jobId as string)
    : isUuid((row as Record<string, unknown>)["job_id"]) ? ((row as Record<string, unknown>)["job_id"] as string)
    : undefined;
  pushUnique(out, {
    kind: "file",
    id: row.id,
    label: labelFromRow(row, "File"),
    jobId,
  });
}

function harvestFolder(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (!isUuid(row.id)) return;
  const jobId =
    isUuid(row.jobId) ? (row.jobId as string)
    : isUuid((row as Record<string, unknown>)["job_id"]) ? ((row as Record<string, unknown>)["job_id"] as string)
    : undefined;
  pushUnique(out, {
    kind: "folder",
    id: row.id,
    label: labelFromRow(row, "Folder"),
    jobId,
  });
}

function harvestDailyLog(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (!isUuid(row.id)) return;
  const jobId =
    isUuid(row.jobId) ? (row.jobId as string)
    : isUuid((row as Record<string, unknown>)["job_id"]) ? ((row as Record<string, unknown>)["job_id"] as string)
    : undefined;
  pushUnique(out, {
    kind: "daily_log",
    id: row.id,
    label: labelFromRow(row, "Daily log"),
    jobId,
  });
}

function harvestScheduleItem(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (!isUuid(row.id)) return;
  const jobId =
    isUuid(row.jobId) ? (row.jobId as string)
    : isUuid((row as Record<string, unknown>)["job_id"]) ? ((row as Record<string, unknown>)["job_id"] as string)
    : undefined;
  pushUnique(out, {
    kind: "schedule_item",
    id: row.id,
    label: labelFromRow(row, "Schedule item"),
    jobId,
  });
}

function harvestUser(row: Record<string, unknown>, out: AgentCitation[]): void {
  if (isUuid(row.id)) {
    pushUnique(out, { kind: "user", id: row.id, label: labelFromRow(row, "User") });
  }
}

type Harvester = (row: Record<string, unknown>, out: AgentCitation[]) => void;

const ENTITY_HARVESTERS: Record<string, Harvester> = {
  jobs: harvestJob,
  job: harvestJob,
  leads: harvestLead,
  lead: harvestLead,
  clients: harvestClient,
  client: harvestClient,
  files: harvestFile,
  file: harvestFile,
  folders: harvestFolder,
  folder: harvestFolder,
  dailyLogs: harvestDailyLog,
  daily_logs: harvestDailyLog,
  log: harvestDailyLog,
  scheduleItems: harvestScheduleItem,
  schedule_items: harvestScheduleItem,
  items: harvestScheduleItem,
  users: harvestUser,
  user: harvestUser,
};

const TOOL_FALLBACK_HARVESTER: Record<string, Harvester> = {
  list_jobs: harvestJob,
  get_job: harvestJob,
  list_leads: harvestLead,
  get_lead: harvestLead,
  list_clients: harvestClient,
  get_client: harvestClient,
  list_contacts: harvestClient, // contacts roll up to their client
  get_contact: harvestClient,
  list_daily_logs: harvestDailyLog,
  get_daily_log: harvestDailyLog,
  list_schedule_items: harvestScheduleItem,
  get_schedule_item: harvestScheduleItem,
  list_folders: harvestFolder,
  get_folder: harvestFolder,
  list_files: harvestFile,
  get_file: harvestFile,
  list_users: harvestUser,
};

/**
 * Pull deep-linkable record references out of a tool result.
 *
 * Each list endpoint returns a payload like `{ jobs: [...], pagination: ... }`
 * — we look at every known entity-shaped collection key and coerce its rows
 * into citation chips. A single get endpoint either returns the entity
 * directly or wrapped under its singular key.
 */
export function extractCitations(toolName: string, result: unknown): AgentCitation[] {
  const out: AgentCitation[] = [];
  if (!result || typeof result !== "object") return out;

  const root = result as Record<string, unknown>;

  for (const [key, value] of Object.entries(root)) {
    const harvester = ENTITY_HARVESTERS[key];
    if (!harvester) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          harvester(item as Record<string, unknown>, out);
        }
      }
    } else if (value && typeof value === "object") {
      harvester(value as Record<string, unknown>, out);
    }
  }

  // Search returns { results: [{ type, id, title, href }, ...] }
  if (Array.isArray(root.results)) {
    for (const item of root.results) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const type = typeof r.type === "string" ? r.type : typeof r.kind === "string" ? r.kind : undefined;
      const id = typeof r.id === "string" ? r.id : undefined;
      const label =
        typeof r.title === "string" ? r.title : labelFromRow(r, type ?? "Result");
      // Map search "type" → citation kind. "schedule" → "schedule_item".
      const kindMap: Record<string, AgentCitation["kind"]> = {
        job: "job",
        lead: "lead",
        client: "client",
        file: "file",
        folder: "folder",
        daily_log: "daily_log",
        schedule: "schedule_item",
        schedule_item: "schedule_item",
        user: "user",
        activity: "activity",
      };
      const kind = type ? kindMap[type] : undefined;
      const jobId = isUuid(r.jobId) ? (r.jobId as string) : undefined;
      if (!isUuid(id) || !kind) continue;
      pushUnique(out, { kind, id, label, jobId });
    }
  }

  if (out.length > 0) return out;

  // Fallback: treat the whole payload as the entity for "get_*" tools.
  const fallback = TOOL_FALLBACK_HARVESTER[toolName];
  if (fallback) fallback(root, out);

  return out;
}

/** Trim a tool result to a manageable summary string for display in tool-call cards. */
export function summarizeToolResult(result: unknown, maxLen = 280): string {
  if (result === null || result === undefined) return "(no data)";
  let str: string;
  try {
    str = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    str = String(result);
  }
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}… (${str.length - maxLen} more chars)`;
}
