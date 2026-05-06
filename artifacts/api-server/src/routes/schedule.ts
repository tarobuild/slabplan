import crypto from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  clients,
  files,
  folders,
  jobs,
  reminderOptions,
  scheduleBaselines,
  scheduleItemAssignees,
  scheduleItemAttachments,
  scheduleItemNotes,
  scheduleItemPredecessors,
  scheduleItemTodos,
  scheduleItems,
  scheduleSettings,
  schedulePhases,
  scheduleTagSettings,
  scheduleWorkdayExceptionCategories,
  scheduleWorkdayExceptions,
  users,
} from "@workspace/db/schema";
import {
  assertCanAccessJob,
  assertCanManageJob,
  assertCanManageScheduleItem,
  assertCanViewScheduleItem,
  isAdmin,
  listAccessibleJobIds,
  type AuthContext,
} from "../lib/authorization";
import { requireManagerOrAbove } from "../middleware/require-auth";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { validateUploadForMediaType, writeActivity } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { logger } from "../lib/logger";
import { buildScheduleListVisibilityFilter } from "../lib/schedule-visibility";
import {
  buildStoredFileName,
  buildUploadPath,
  deletePhysicalFile,
  probeStorageStatuses,
  writeUploadedBuffer,
  writeUploadedFromPath,
} from "../lib/storage";
import {
  cleanupTempUpload,
  deletePhysicalFileBestEffort,
  uploadArray,
} from "../lib/uploads";
import { createUploadPerUserRateLimit } from "../lib/rate-limit";

const uploadRateLimit = createUploadPerUserRateLimit();

const router: IRouter = Router();
type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

const dependencyTypes = [
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
] as const;

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const optionalUuid = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  .refine((value) => value === null || z.string().uuid().safeParse(value).success, {
    message: "Expected a valid UUID.",
  });

const optionalDate = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Dates must be in YYYY-MM-DD format.",
  });

const optionalTime = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  .refine((value) => value === null || /^\d{2}:\d{2}(:\d{2})?$/.test(value), {
    message: "Times must use HH:MM or HH:MM:SS format.",
  });

const predecessorSchema = z.object({
  scheduleItemId: z.string().uuid(),
  dependencyType: z.enum(dependencyTypes),
  lagDays: z.coerce.number().int().min(0).max(365).optional().default(0),
});

const schedulePayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    displayColor: optionalString,
    assigneeIds: z.array(z.string().uuid()).optional().default([]),
    notifyUserIds: z.array(z.string().uuid()).optional().default([]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    workDays: z.coerce.number().int().positive().max(365).optional().default(1),
    endDate: optionalDate,
    isHourly: z.coerce.boolean().optional().default(false),
    startTime: optionalTime,
    endTime: optionalTime,
    progress: z.coerce.number().int().min(0).max(100).optional().default(0),
    reminder: z.enum(reminderOptions).optional().default("none"),
    notes: optionalString,
    tags: z.array(z.string().trim().min(1).max(100)).optional().default([]),
    predecessors: z.array(predecessorSchema).optional().default([]),
    phaseId: optionalUuid,
    showOnGantt: z.coerce.boolean().optional().default(true),
    visibleToEstimators: z.coerce.boolean().optional().default(true),
    visibleToInstallers: z.coerce.boolean().optional().default(true),
    visibleToOfficeStaff: z.coerce.boolean().optional().default(true),
    isComplete: z.coerce.boolean().optional().default(false),
    isPersonalTodo: z.coerce.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.isHourly && !value.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hourly items require a start time.",
        path: ["startTime"],
      });
    }

    const seenPredecessorIds = new Set<string>();
    value.predecessors.forEach((predecessor, index) => {
      if (seenPredecessorIds.has(predecessor.scheduleItemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate predecessors are not allowed.",
          path: ["predecessors", index, "scheduleItemId"],
        });
        return;
      }
      seenPredecessorIds.add(predecessor.scheduleItemId);
    });
  });

const scheduleSettingPayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const schedulePhasePayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: optionalString,
});

const scheduleSettingsPayloadSchema = z.object({
  defaultView: z
    .enum(["calendar_month", "calendar_week", "calendar_day", "calendar_agenda", "list", "gantt"])
    .optional(),
  showTimesOnMonthView: z.coerce.boolean().optional(),
  showJobNameOnAllListedJobs: z.coerce.boolean().optional(),
  automaticallyMarkItemsComplete: z.coerce.boolean().optional(),
  includeHeaderOnPdfExports: z.coerce.boolean().optional(),
});

const workdayExceptionCategoryPayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const workdayExceptionPayloadBaseSchema = z.object({
  title: z.string().trim().min(1).max(255),
  type: z.enum(["non_workday", "extra_workday"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sameEveryYear: z.coerce.boolean().optional().default(false),
  categoryId: optionalUuid,
  appliesToAllJobs: z.coerce.boolean().optional().default(false),
  jobIds: z.array(z.string().uuid()).optional().default([]),
  notes: optionalString,
});

const workdayExceptionPayloadSchema = workdayExceptionPayloadBaseSchema
  .superRefine((value, ctx) => {
    if (!value.appliesToAllJobs && value.jobIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one job.",
        path: ["jobIds"],
      });
    }

    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be on or after the start date.",
        path: ["endDate"],
      });
    }
  });

const workdayExceptionUpdatePayloadSchema = workdayExceptionPayloadBaseSchema.partial().superRefine((value, ctx) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must be on or after the start date.",
      path: ["endDate"],
    });
  }
});

const scheduleNotePayloadSchema = z.object({
  note: z.string().trim().min(1).max(10_000),
});

const createDocPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

const scheduleTodoPayloadSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
});

const scheduleTodoUpdatePayloadSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  isComplete: z.coerce.boolean().optional(),
});

// Narrow payload accepted by POST /schedule-items/:id/complete.
// This is the assignee-side write path for crew members; it deliberately
// only carries the completion-state fields and never touches schedule
// dates, visibility, predecessors, or other admin/PM-managed properties.
const scheduleCompletionPayloadSchema = z.object({
  isComplete: z.coerce.boolean(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
});

type ScheduleMeta = {
  notes: string | null;
  tags: string[];
  predecessors: Array<z.infer<typeof predecessorSchema>>;
};

const scheduleMetaMarker = "__cadstoneScheduleMeta";

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

function normalizeUniqueStrings(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

const requireScheduleJobRouteAccess = asyncHandler(async (req, _res, next) => {
  const jobId = getParam(req.params.jobId, "job id");

  if (req.method === "GET") {
    await assertCanAccessJob(req.auth!, jobId);
  } else {
    await assertCanManageJob(req.auth!, jobId);
  }

  next();
});

const requireScheduleItemRouteAccess = asyncHandler(async (req, _res, next) => {
  const itemId = getParam(req.params.id, "schedule item id");
  const path = req.path || "/";
  // /complete is the narrow self-service endpoint a crew member uses to
  // flip their own assignment's completion state — it must be reachable
  // with view-level access. The handler then re-checks that the caller
  // is either an assignee or has manage-level rights on the item.
  const isCollaborativeUpdate =
    path.startsWith("/notes") ||
    path.startsWith("/todos") ||
    path.startsWith("/complete");

  if (req.method === "GET" || isCollaborativeUpdate) {
    await assertCanViewScheduleItem(req.auth!, itemId);
  } else {
    await assertCanManageScheduleItem(req.auth!, itemId);
  }

  next();
});

router.use("/jobs/:jobId/schedule", requireScheduleJobRouteAccess);
router.use("/jobs/:jobId/workday-exceptions", requireScheduleJobRouteAccess);
router.use("/schedule-items/:id", requireScheduleItemRouteAccess);

function normalizeTimeValue(value: string | null) {
  if (!value) {
    return null;
  }

  return value.length === 5 ? `${value}:00` : value;
}

type ScheduleHistoryItem = {
  title: string;
  displayColor: string | null;
  assigneeIds: string[];
  assignees: Array<{
    fullName: string | null;
    email: string;
  }>;
  startDate: string;
  workDays: number;
  endDate: string;
  isHourly: boolean | null;
  startTime: string | null;
  progress: number | null;
  reminder: string | null;
  phaseName: string | null;
  tags: string[];
  predecessors: Array<{
    scheduleItemId: string;
    title: string;
    dependencyType: z.infer<typeof predecessorSchema>["dependencyType"];
    lagDays: number;
  }>;
  showOnGantt: boolean | null;
  visibleToEstimators: boolean | null;
  visibleToInstallers: boolean | null;
  visibleToOfficeStaff: boolean | null;
  isComplete: boolean | null;
};

type ScheduleHistoryChange = {
  field: string;
  label: string;
  from: string;
  to: string;
};

function labelizeScheduleValue(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function predecessorDependencyLabel(value: z.infer<typeof predecessorSchema>["dependencyType"]) {
  if (value === "finish_to_start") {
    return "Finish-to-Start (FS)";
  }

  if (value === "start_to_start") {
    return "Start-to-Start (SS)";
  }

  if (value === "finish_to_finish") {
    return "Finish-to-Finish (FF)";
  }

  return "Start-to-Finish (SF)";
}

function buildScheduleHistorySnapshot(item: ScheduleHistoryItem) {
  return {
    title: item.title,
    displayColor: item.displayColor ?? "#2563eb",
    assignees:
      item.assignees.length > 0
        ? item.assignees.map((assignee) => assignee.fullName ?? assignee.email).join(", ")
        : "—",
    startDate: item.startDate,
    workDays: `${item.workDays} ${item.workDays === 1 ? "day" : "days"}`,
    endDate: item.endDate,
    hourly: item.isHourly ? "Yes" : "No",
    startTime: item.startTime ?? "—",
    progress: `${item.progress ?? 0}%`,
    reminder: labelizeScheduleValue(item.reminder ?? "none"),
    phase: item.phaseName ?? "Unassigned",
    tags: item.tags.length > 0 ? item.tags.join(", ") : "—",
    predecessors:
      item.predecessors.length > 0
        ? item.predecessors
            .map((predecessor) =>
              `${predecessor.title} • ${predecessorDependencyLabel(predecessor.dependencyType)} • lag ${predecessor.lagDays} day${predecessor.lagDays === 1 ? "" : "s"}`)
            .join("; ")
        : "—",
    showOnGantt: item.showOnGantt === false ? "No" : "Yes",
    visibleToEstimators: item.visibleToEstimators === false ? "No" : "Yes",
    visibleToInstallers: item.visibleToInstallers === false ? "No" : "Yes",
    visibleToOfficeStaff: item.visibleToOfficeStaff === false ? "No" : "Yes",
    complete: item.isComplete ? "Complete" : "Incomplete",
  };
}

function buildScheduleHistoryChanges(
  before: ScheduleHistoryItem | null,
  after: ScheduleHistoryItem,
) {
  const nextSnapshot = buildScheduleHistorySnapshot(after);
  const previousSnapshot = before ? buildScheduleHistorySnapshot(before) : null;
  const labels: Record<string, string> = {
    title: "Title",
    displayColor: "Display Color",
    assignees: "Assignees",
    startDate: "Start Date",
    workDays: "Work Days",
    endDate: "End Date",
    hourly: "Hourly",
    startTime: "Start Time",
    progress: "Progress",
    reminder: "Reminder",
    phase: "Phase",
    tags: "Tags",
    predecessors: "Predecessors",
    showOnGantt: "Show on Gantt",
    visibleToEstimators: "Visible to Estimators",
    visibleToInstallers: "Visible to Installers",
    visibleToOfficeStaff: "Visible to Office Staff",
    complete: "Complete",
  };

  return Object.entries(nextSnapshot).flatMap(([field, value]) => {
    const previousValue = previousSnapshot?.[field as keyof typeof nextSnapshot] ?? "—";

    if (previousValue === value) {
      return [];
    }

    return [
      {
        field,
        label: labels[field] ?? labelizeScheduleValue(field),
        from: String(previousValue),
        to: String(value),
      } satisfies ScheduleHistoryChange,
    ];
  });
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

type WorkdayExceptionRecord = {
  id: string;
  title: string;
  type: "non_workday" | "extra_workday";
  startDate: string;
  endDate: string;
  sameEveryYear: boolean;
  categoryId: string | null;
  categoryName: string | null;
  appliesToAllJobs: boolean;
  jobIds: string[];
  notes: string | null;
};

function comparableExceptionDate(date: Date, sameEveryYear: boolean) {
  if (sameEveryYear) {
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  return date.toISOString().slice(0, 10);
}

function matchesWorkdayException(date: Date, exception: WorkdayExceptionRecord) {
  const value = comparableExceptionDate(date, exception.sameEveryYear);
  const start = exception.sameEveryYear ? exception.startDate.slice(5, 10) : exception.startDate;
  const end = exception.sameEveryYear ? exception.endDate.slice(5, 10) : exception.endDate;
  return value >= start && value <= end;
}

function classifyWorkday(date: Date, exceptions: WorkdayExceptionRecord[]) {
  const matches = exceptions.filter((exception) => matchesWorkdayException(date, exception));
  const extra = matches.find((exception) => exception.type === "extra_workday");

  if (extra) {
    return {
      isWorkday: true,
      label: extra.title,
      type: "extra_workday" as const,
    };
  }

  const nonWorkday = matches.find((exception) => exception.type === "non_workday");

  if (nonWorkday) {
    return {
      isWorkday: false,
      label: nonWorkday.title,
      type: "non_workday" as const,
    };
  }

  return {
    isWorkday: !isWeekend(date),
    label: isWeekend(date) ? "Non-workday" : null,
    type: isWeekend(date) ? ("non_workday" as const) : null,
  };
}

function calculateBusinessEndDate(startDate: string, workDays: number, exceptions: WorkdayExceptionRecord[] = []) {
  const current = new Date(`${startDate}T00:00:00.000Z`);

  while (!classifyWorkday(current, exceptions).isWorkday) {
    current.setUTCDate(current.getUTCDate() + 1);
  }

  let remaining = Math.max(workDays, 1);

  while (remaining > 1) {
    current.setUTCDate(current.getUTCDate() + 1);

    if (classifyWorkday(current, exceptions).isWorkday) {
      remaining -= 1;
    }
  }

  return current.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function diffInDays(left: Date, right: Date) {
  return Math.round((right.getTime() - left.getTime()) / 86_400_000);
}

function addBusinessDays(startDate: string, amount: number, exceptions: WorkdayExceptionRecord[] = []) {
  if (amount <= 0) {
    return startDate;
  }

  return calculateBusinessEndDate(startDate, amount + 1, exceptions);
}

function encodeScheduleMeta(meta: ScheduleMeta) {
  if (!meta.notes && meta.tags.length === 0 && meta.predecessors.length === 0) {
    return null;
  }

  return JSON.stringify({
    [scheduleMetaMarker]: true,
    notes: meta.notes,
    tags: meta.tags,
    predecessors: meta.predecessors,
  });
}

function decodeScheduleMeta(value: string | null): ScheduleMeta {
  if (!value) {
    return {
      notes: null,
      tags: [],
      predecessors: [],
    };
  }

  try {
    const parsed = JSON.parse(value) as
      | {
          [scheduleMetaMarker]?: boolean;
          notes?: string | null;
          tags?: string[];
          predecessors?: Array<z.infer<typeof predecessorSchema>>;
        }
      | null;

    if (parsed && parsed[scheduleMetaMarker]) {
      return {
        notes: typeof parsed.notes === "string" ? parsed.notes : null,
        tags: Array.isArray(parsed.tags) ? normalizeUniqueStrings(parsed.tags) : [],
        predecessors: Array.isArray(parsed.predecessors)
          ? parsed.predecessors
          : [],
      };
    }
  } catch {
    return {
      notes: value,
      tags: [],
      predecessors: [],
    };
  }

  return {
    notes: value,
    tags: [],
    predecessors: [],
  };
}

function deriveScheduleStatus(item: {
  startDate: string;
  endDate: string;
  progress: number | null;
  isComplete: boolean | null;
}) {
  const todayDate = new Date();
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;

  if (item.isComplete || (item.progress ?? 0) >= 100) {
    return "completed";
  }

  if (item.endDate < today) {
    return "overdue";
  }

  if (item.startDate > today) {
    return "upcoming";
  }

  return "in_progress";
}

function fileIconKind(mimeType: string | null) {
  if (!mimeType) {
    return "file";
  }

  if (mimeType.includes("pdf")) {
    return "pdf";
  }

  if (mimeType.includes("word") || mimeType.includes("document")) {
    return "doc";
  }

  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType.includes("csv")) {
    return "sheet";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  return "file";
}

async function ensureJobExists(jobId: string) {
  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
    })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))
    .limit(1);

  if (!job) {
    throw new HttpError(404, "Job not found.");
  }

  await Promise.all([ensureDefaultPhase(jobId), ensureDefaultScheduleSettings(jobId)]);

  return job;
}

/**
 * Read-only variant of ensureJobExists. Skips the lazy INSERTs of a
 * default phase / settings row so the schedule GET endpoint stays
 * write-free; defaults are created on the next write path instead.
 */
async function verifyJobExists(jobId: string) {
  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
    })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))
    .limit(1);

  if (!job) {
    throw new HttpError(404, "Job not found.");
  }

  return job;
}

async function getScheduleItemOrThrow(id: string) {
  const [item] = await db
    .select()
    .from(scheduleItems)
    .where(and(eq(scheduleItems.id, id), isNull(scheduleItems.deletedAt)))
    .limit(1);

  if (!item) {
    throw new HttpError(404, "Schedule item not found.");
  }

  return item;
}

async function assertPredecessorsBelongToJob(jobId: string, itemIds: string[]) {
  if (itemIds.length === 0) {
    return;
  }

  const rows = await db
    .select({
      id: scheduleItems.id,
    })
    .from(scheduleItems)
    .where(
      and(
        inArray(scheduleItems.id, itemIds),
        eq(scheduleItems.jobId, jobId),
        isNull(scheduleItems.deletedAt),
      ),
    );

  if (rows.length !== itemIds.length) {
    throw new HttpError(400, "Predecessors must belong to the same job.");
  }
}

async function assertPhaseBelongsToJob(jobId: string, phaseId: string | null) {
  if (!phaseId) {
    return;
  }

  const [phase] = await db
    .select({ id: schedulePhases.id })
    .from(schedulePhases)
    .where(and(eq(schedulePhases.id, phaseId), eq(schedulePhases.jobId, jobId)))
    .limit(1);

  if (!phase) {
    throw new HttpError(400, "Phase must belong to the same job.");
  }
}

async function ensureDefaultPhase(jobId: string) {
  await db
    .insert(schedulePhases)
    .values({
      jobId,
      name: "Pre-Construction",
      color: "#e76f8a",
    })
    .onConflictDoNothing({
      target: [schedulePhases.jobId, schedulePhases.name],
    });

  const [phase] = await db
    .select({
      id: schedulePhases.id,
      name: schedulePhases.name,
      color: schedulePhases.color,
    })
    .from(schedulePhases)
    .where(and(eq(schedulePhases.jobId, jobId), eq(schedulePhases.name, "Pre-Construction")))
    .limit(1);

  if (!phase) {
    throw new HttpError(500, "Failed to ensure default schedule phase.");
  }

  return phase;
}

async function ensureDefaultScheduleSettings(
  jobId: string,
  executor: DbExecutor = db,
) {
  await executor
    .insert(scheduleSettings)
    .values({
      id: crypto.randomUUID(),
      jobId,
      defaultView: "calendar_month",
      showTimesOnMonthView: false,
      showJobNameOnAllListedJobs: true,
      automaticallyMarkItemsComplete: false,
      includeHeaderOnPdfExports: true,
    })
    .onConflictDoNothing({
      target: scheduleSettings.jobId,
    });

  const [created] = await executor
    .select()
    .from(scheduleSettings)
    .where(eq(scheduleSettings.jobId, jobId))
    .limit(1);

  if (!created) {
    throw new HttpError(500, "Failed to ensure default schedule settings.");
  }

  return created;
}

async function loadAllWorkdayExceptions(
  executor: DbExecutor = db,
): Promise<WorkdayExceptionRecord[]> {
  const rows = await executor
    .select({
      id: scheduleWorkdayExceptions.id,
      title: scheduleWorkdayExceptions.title,
      type: scheduleWorkdayExceptions.type,
      startDate: scheduleWorkdayExceptions.startDate,
      endDate: scheduleWorkdayExceptions.endDate,
      sameEveryYear: scheduleWorkdayExceptions.sameEveryYear,
      categoryId: scheduleWorkdayExceptions.categoryId,
      categoryName: scheduleWorkdayExceptionCategories.name,
      appliesToAllJobs: scheduleWorkdayExceptions.appliesToAllJobs,
      jobIds: scheduleWorkdayExceptions.jobIds,
      notes: scheduleWorkdayExceptions.notes,
    })
    .from(scheduleWorkdayExceptions)
    .leftJoin(
      scheduleWorkdayExceptionCategories,
      eq(scheduleWorkdayExceptions.categoryId, scheduleWorkdayExceptionCategories.id),
    )
    .orderBy(asc(scheduleWorkdayExceptions.startDate), asc(scheduleWorkdayExceptions.title));

  return rows.map((row): WorkdayExceptionRecord => ({
    ...row,
    type: row.type === "extra_workday" ? "extra_workday" : "non_workday",
    sameEveryYear: !!row.sameEveryYear,
    appliesToAllJobs: !!row.appliesToAllJobs,
    jobIds: Array.isArray(row.jobIds)
      ? row.jobIds.filter((jobIdValue): jobIdValue is string => typeof jobIdValue === "string")
      : [],
  }));
}

async function getWorkdayExceptionsForJob(
  jobId: string,
  executor: DbExecutor = db,
): Promise<WorkdayExceptionRecord[]> {
  const all = await loadAllWorkdayExceptions(executor);
  return all.filter((row) => row.appliesToAllJobs || row.jobIds.includes(jobId));
}

async function getWorkdayExceptionsByJob(
  jobIds: string[],
): Promise<Map<string, WorkdayExceptionRecord[]>> {
  const unique = Array.from(new Set(jobIds));
  const byJob = new Map<string, WorkdayExceptionRecord[]>();

  if (unique.length === 0) {
    return byJob;
  }

  const all = await loadAllWorkdayExceptions();

  for (const jobId of unique) {
    byJob.set(
      jobId,
      all.filter((row) => row.appliesToAllJobs || row.jobIds.includes(jobId)),
    );
  }

  return byJob;
}

async function syncPredecessors(
  scheduleItemId: string,
  predecessors: Array<z.infer<typeof predecessorSchema>>,
  executor: DbExecutor = db,
) {
  await executor
    .delete(scheduleItemPredecessors)
    .where(eq(scheduleItemPredecessors.scheduleItemId, scheduleItemId));

  if (predecessors.length === 0) {
    return;
  }

  if (predecessors.some((predecessor) => predecessor.scheduleItemId === scheduleItemId)) {
    throw new HttpError(400, "A schedule item cannot be its own predecessor.");
  }

  await executor.insert(scheduleItemPredecessors).values(
    predecessors.map((predecessor) => ({
      id: crypto.randomUUID(),
      scheduleItemId,
      predecessorId: predecessor.scheduleItemId,
      dependencyType: predecessor.dependencyType,
      lagDays: predecessor.lagDays,
    })),
  );
}

function applyPredecessorDates(
  payload: z.infer<typeof schedulePayloadSchema>,
  predecessorItems: Array<{
    id: string;
    startDate: string;
    endDate: string;
  }>,
  exceptions: WorkdayExceptionRecord[],
) {
  if (payload.predecessors.length === 0) {
    return payload;
  }

  const predecessorMap = new Map(predecessorItems.map((item) => [item.id, item]));
  const resolvedStartDate = resolvePredecessorStartDate(
    payload.startDate,
    payload.workDays,
    payload.predecessors,
    predecessorMap,
    exceptions,
  );

  return {
    ...payload,
    startDate: resolvedStartDate,
    endDate: payload.endDate ?? calculateBusinessEndDate(resolvedStartDate, payload.workDays, exceptions),
  };
}

function resolvePredecessorStartDate(
  startDate: string,
  workDays: number,
  predecessors: Array<z.infer<typeof predecessorSchema>>,
  predecessorMap: Map<string, { startDate: string; endDate: string }>,
  exceptions: WorkdayExceptionRecord[],
) {
  let resolvedStartDate = startDate;

  for (const predecessor of predecessors) {
    const linked = predecessorMap.get(predecessor.scheduleItemId);

    if (!linked) {
      continue;
    }

    if (predecessor.dependencyType === "finish_to_start") {
      const candidate = addBusinessDays(linked.endDate, predecessor.lagDays + 1, exceptions);
      if (candidate > resolvedStartDate) {
        resolvedStartDate = candidate;
      }
      continue;
    }

    if (predecessor.dependencyType === "start_to_start") {
      const candidate = addBusinessDays(linked.startDate, predecessor.lagDays, exceptions);
      if (candidate > resolvedStartDate) {
        resolvedStartDate = candidate;
      }
      continue;
    }

    if (predecessor.dependencyType === "finish_to_finish") {
      const desiredEnd = addBusinessDays(linked.endDate, predecessor.lagDays, exceptions);
      const candidateStart = calculateBusinessEndDate(desiredEnd, Math.max(workDays, 1), exceptions);
      if (candidateStart > resolvedStartDate) {
        resolvedStartDate = candidateStart;
      }
      continue;
    }

    if (predecessor.dependencyType === "start_to_finish") {
      const desiredEnd = addBusinessDays(linked.startDate, predecessor.lagDays, exceptions);
      const candidateStart = calculateBusinessEndDate(desiredEnd, Math.max(workDays, 1), exceptions);
      if (candidateStart > resolvedStartDate) {
        resolvedStartDate = candidateStart;
      }
    }
  }

  return resolvedStartDate;
}

function predecessorConflictReasons(
  item: {
    title: string;
    startDate: string;
    endDate: string;
    predecessors: Array<{
      scheduleItemId: string;
      dependencyType: z.infer<typeof predecessorSchema>["dependencyType"];
      lagDays: number;
      title?: string;
    }>;
  },
  predecessorMap: Map<string, { title: string; startDate: string; endDate: string }>,
  exceptions: WorkdayExceptionRecord[],
) {
  const reasons: string[] = [];

  for (const predecessor of item.predecessors) {
    const linked = predecessorMap.get(predecessor.scheduleItemId);

    if (!linked) {
      continue;
    }

    if (predecessor.dependencyType === "finish_to_start") {
      const requiredStart = addBusinessDays(linked.endDate, predecessor.lagDays + 1, exceptions);
      if (item.startDate < requiredStart) {
        reasons.push(`${item.title} starts before ${linked.title} finishes`);
      }
      continue;
    }

    if (predecessor.dependencyType === "start_to_start") {
      const requiredStart = addBusinessDays(linked.startDate, predecessor.lagDays, exceptions);
      if (item.startDate < requiredStart) {
        reasons.push(`${item.title} starts before ${linked.title} is allowed to start it`);
      }
      continue;
    }

    if (predecessor.dependencyType === "finish_to_finish") {
      const requiredEnd = addBusinessDays(linked.endDate, predecessor.lagDays, exceptions);
      if (item.endDate < requiredEnd) {
        reasons.push(`${item.title} finishes before ${linked.title} requirement is met`);
      }
      continue;
    }

    const requiredEnd = addBusinessDays(linked.startDate, predecessor.lagDays, exceptions);
    if (item.endDate < requiredEnd) {
      reasons.push(`${item.title} finishes before ${linked.title} start dependency is met`);
    }
  }

  return reasons;
}

async function syncAssignees(
  scheduleItemId: string,
  assigneeIds: string[],
  executor: DbExecutor = db,
) {
  await executor
    .delete(scheduleItemAssignees)
    .where(eq(scheduleItemAssignees.scheduleItemId, scheduleItemId));

  const uniqueUserIds = Array.from(new Set(assigneeIds));

  if (uniqueUserIds.length > 0) {
    await executor.insert(scheduleItemAssignees).values(
      uniqueUserIds.map((userId) => ({
        scheduleItemId,
        userId,
      })),
    );
  }
}

async function ensureTagSettings(jobId: string, tagNames: string[], executor: DbExecutor = db) {
  const uniqueTagNames = normalizeUniqueStrings(tagNames);

  if (uniqueTagNames.length === 0) {
    return;
  }

  const existing = await executor
    .select({
      name: scheduleTagSettings.name,
    })
    .from(scheduleTagSettings)
    .where(and(eq(scheduleTagSettings.jobId, jobId), inArray(scheduleTagSettings.name, uniqueTagNames)));
  const existingNames = new Set(existing.map((tag) => tag.name));
  const missing = uniqueTagNames.filter((tag) => !existingNames.has(tag));

  if (missing.length === 0) {
    return;
  }

  await executor.insert(scheduleTagSettings).values(
    missing.map((name) => ({
      jobId,
      name,
    })),
  );
}

async function assertWorkdayExceptionCategoryBelongsToJob(jobId: string, categoryId: string | null) {
  if (!categoryId) {
    return;
  }

  const category = await getWorkdayExceptionCategoryOrThrow(categoryId);

  if (category.jobId && category.jobId !== jobId) {
    throw new HttpError(400, "Workday exception category must belong to this job.");
  }
}

async function applyAutomaticCompletionIfEnabled(
  jobId: string,
  executor: DbExecutor = db,
) {
  const settings = await ensureDefaultScheduleSettings(jobId, executor);

  if (!settings.automaticallyMarkItemsComplete) {
    return;
  }

  const todayDate = new Date();
  const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;

  await executor
    .update(scheduleItems)
    .set({
      isComplete: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduleItems.jobId, jobId),
        isNull(scheduleItems.deletedAt),
        or(eq(scheduleItems.isComplete, false), isNull(scheduleItems.isComplete)),
        sql`${scheduleItems.endDate} < ${today}`,
      ),
    );
}

/**
 * Mark overdue, incomplete schedule items complete for every job whose
 * `automaticallyMarkItemsComplete` setting is enabled. Single statement,
 * safe to call from a periodic timer. Returns the row count flipped.
 */
export async function sweepAllAutomaticCompletion(now: Date = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${scheduleItems} AS si
    SET is_complete = true,
        updated_at = NOW()
    FROM ${scheduleSettings} AS ss
    WHERE si.job_id = ss.job_id
      AND ss.automatically_mark_items_complete = true
      AND si.deleted_at IS NULL
      AND (si.is_complete = false OR si.is_complete IS NULL)
      AND si.end_date < ${today}::date
    RETURNING si.id
  `);

  return result.rows.length;
}

export interface ScheduleAutoCompleteSweeperHandle {
  /** Stop the periodic sweeper. Safe to call multiple times. */
  stop: () => void;
  /** Run a sweep immediately. Used internally and in tests. */
  runNow: () => Promise<number>;
}

const DEFAULT_AUTO_COMPLETE_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // every hour

/**
 * Run sweepAllAutomaticCompletion on a periodic timer. Returns a handle
 * that can stop the timer or run an immediate sweep (for tests).
 */
export function startScheduleAutoCompleteSweeper(
  options: { intervalMs?: number } = {},
): ScheduleAutoCompleteSweeperHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_AUTO_COMPLETE_SWEEP_INTERVAL_MS;
  let running = false;

  const runNow = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    try {
      const flipped = await sweepAllAutomaticCompletion();
      if (flipped > 0) {
        logger.info({ flipped }, "Schedule auto-complete sweep flipped overdue items");
      }
      return flipped;
    } catch (err) {
      logger.error({ err }, "Schedule auto-complete sweep failed");
      return 0;
    } finally {
      running = false;
    }
  };

  // Kick off an initial sweep, but don't block startup on it.
  void runNow();

  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  // Don't keep the event loop alive purely for this timer.
  timer.unref();

  logger.info({ intervalMs }, "Schedule auto-complete sweeper started");

  return {
    stop: () => clearInterval(timer),
    runNow,
  };
}

export type ScheduleCascadeItem = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  workDays: number;
};

export type ScheduleCascadePredecessor = {
  scheduleItemId: string;
  predecessorId: string;
  dependencyType: z.infer<typeof predecessorSchema>["dependencyType"];
  lagDays: number;
};

export type ScheduleCascadeResult = {
  startDate: string;
  endDate: string;
};

/**
 * Pure cascade math. Returns itemId -> cascade-resolved
 * {startDate, endDate} given items, predecessor edges, and workday
 * exceptions. No DB access — used by both read and write paths.
 */
export function computeJobScheduleCascade(
  items: ScheduleCascadeItem[],
  predecessorRows: ScheduleCascadePredecessor[],
  exceptions: WorkdayExceptionRecord[],
): Map<string, ScheduleCascadeResult> {
  const result = new Map<string, ScheduleCascadeResult>();

  if (items.length === 0) {
    return result;
  }

  const itemIds = new Set(items.map((item) => item.id));
  const itemsById = new Map(items.map((item) => [item.id, { ...item }]));
  const predecessorsByItemId = new Map<
    string,
    Array<{
      scheduleItemId: string;
      dependencyType: z.infer<typeof predecessorSchema>["dependencyType"];
      lagDays: number;
    }>
  >();

  for (const row of predecessorRows) {
    if (!itemIds.has(row.scheduleItemId) || !itemIds.has(row.predecessorId)) {
      continue;
    }

    const current = predecessorsByItemId.get(row.scheduleItemId) ?? [];
    current.push({
      scheduleItemId: row.predecessorId,
      dependencyType: row.dependencyType,
      lagDays: row.lagDays,
    });
    predecessorsByItemId.set(row.scheduleItemId, current);
  }

  const orderedItems = [...items].sort((left, right) => left.startDate.localeCompare(right.startDate));

  for (let pass = 0; pass < orderedItems.length; pass += 1) {
    let changed = false;

    for (const item of orderedItems) {
      const predecessors = predecessorsByItemId.get(item.id) ?? [];
      const current = itemsById.get(item.id);

      if (!current) {
        continue;
      }

      if (predecessors.length === 0) {
        const computedEndDate = calculateBusinessEndDate(current.startDate, current.workDays, exceptions);

        if (computedEndDate !== current.endDate) {
          current.endDate = computedEndDate;
          changed = true;
        }

        continue;
      }

      const predecessorEntries: Array<[string, { startDate: string; endDate: string }]> = [];

      for (const predecessor of predecessors) {
        const linked = itemsById.get(predecessor.scheduleItemId);

        if (linked) {
          predecessorEntries.push([
            predecessor.scheduleItemId,
            {
              startDate: linked.startDate,
              endDate: linked.endDate,
            },
          ]);
        }
      }

      const predecessorMap = new Map<string, { startDate: string; endDate: string }>(predecessorEntries);

      const nextStartDate = resolvePredecessorStartDate(
        current.startDate,
        current.workDays,
        predecessors,
        predecessorMap,
        exceptions,
      );
      const nextEndDate = calculateBusinessEndDate(nextStartDate, current.workDays, exceptions);

      if (nextStartDate !== current.startDate || nextEndDate !== current.endDate) {
        current.startDate = nextStartDate;
        current.endDate = nextEndDate;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  for (const item of itemsById.values()) {
    result.set(item.id, { startDate: item.startDate, endDate: item.endDate });
  }

  return result;
}

/**
 * Load the cascade inputs for a job in a single round-trip: items,
 * predecessors, and the workday exceptions that apply.
 */
async function loadJobScheduleCascadeInputs(
  jobId: string,
  executor: DbExecutor = db,
) {
  const [items, exceptions, predecessorRows] = await Promise.all([
    executor
      .select({
        id: scheduleItems.id,
        title: scheduleItems.title,
        startDate: scheduleItems.startDate,
        endDate: scheduleItems.endDate,
        workDays: scheduleItems.workDays,
      })
      .from(scheduleItems)
      .where(and(eq(scheduleItems.jobId, jobId), isNull(scheduleItems.deletedAt)))
      .orderBy(asc(scheduleItems.startDate), asc(scheduleItems.title)),
    getWorkdayExceptionsForJob(jobId, executor),
    executor
      .select({
        scheduleItemId: scheduleItemPredecessors.scheduleItemId,
        predecessorId: scheduleItemPredecessors.predecessorId,
        dependencyType: scheduleItemPredecessors.dependencyType,
        lagDays: scheduleItemPredecessors.lagDays,
      })
      .from(scheduleItemPredecessors)
      .innerJoin(
        scheduleItems,
        eq(scheduleItemPredecessors.scheduleItemId, scheduleItems.id),
      )
      .where(and(eq(scheduleItems.jobId, jobId), isNull(scheduleItems.deletedAt))),
  ]);

  return {
    items,
    exceptions,
    predecessorRows: predecessorRows.map((row) => ({
      ...row,
      dependencyType: row.dependencyType as z.infer<typeof predecessorSchema>["dependencyType"],
    })),
  };
}

/**
 * Persist the cascaded start/end dates for a job. Write-paths only —
 * reads call computeJobScheduleCascade directly to stay side-effect free.
 */
async function synchronizeJobSchedule(
  jobId: string,
  executor: DbExecutor = db,
) {
  const { items, exceptions, predecessorRows } = await loadJobScheduleCascadeInputs(
    jobId,
    executor,
  );

  if (items.length === 0) {
    await applyAutomaticCompletionIfEnabled(jobId, executor);
    return;
  }

  const cascaded = computeJobScheduleCascade(items, predecessorRows, exceptions);

  const updates = items.flatMap((original) => {
    const next = cascaded.get(original.id);
    if (!next) return [];
    if (next.startDate === original.startDate && next.endDate === original.endDate) {
      return [];
    }
    return [{ id: original.id, startDate: next.startDate, endDate: next.endDate }];
  });

  if (updates.length > 0) {
    const valuesSql = sql.join(
      updates.map(
        (update) => sql`(${update.id}, ${update.startDate}, ${update.endDate})`,
      ),
      sql`, `,
    );

    await executor.execute(sql`
      UPDATE ${scheduleItems}
      SET
        start_date = data.start_date::date,
        end_date = data.end_date::date,
        updated_at = NOW()
      FROM (VALUES ${valuesSql}) AS data(id, start_date, end_date)
      WHERE ${scheduleItems.id} = data.id::uuid
    `);
  }

  await applyAutomaticCompletionIfEnabled(jobId, executor);
}

async function ensureScheduleAttachmentFolder(scheduleItemId: string, jobId: string) {
  const title = `Schedule Item ${scheduleItemId} Attachments`;

  const [existing] = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.jobId, jobId),
        eq(folders.scope, "schedule_item"),
        eq(folders.scheduleItemId, scheduleItemId),
        eq(folders.title, title),
        eq(folders.mediaType, "document"),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(folders)
    .values({
      jobId,
      scope: "schedule_item",
      scheduleItemId,
      title,
      mediaType: "document",
    })
    .returning();

  return created;
}

async function maybeDeletePhysicalFile(fileUrl: string | null | undefined, fileId: string) {
  if (!fileUrl) {
    return;
  }

  const [duplicate] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.fileUrl, fileUrl), sql`${files.id} <> ${fileId}`));

  if (!duplicate) {
    await deletePhysicalFile(fileUrl);
  }
}

async function assertUniquePhaseName(jobId: string, name: string, excludeId?: string) {
  const conditions = [eq(schedulePhases.jobId, jobId), eq(schedulePhases.name, name)];

  if (excludeId) {
    conditions.push(ne(schedulePhases.id, excludeId));
  }

  const [existing] = await db
    .select({ id: schedulePhases.id })
    .from(schedulePhases)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new HttpError(409, "A phase with that name already exists.");
  }
}

async function assertUniqueTagName(jobId: string, name: string, excludeId?: string) {
  const conditions = [eq(scheduleTagSettings.jobId, jobId), eq(scheduleTagSettings.name, name)];

  if (excludeId) {
    conditions.push(ne(scheduleTagSettings.id, excludeId));
  }

  const [existing] = await db
    .select({ id: scheduleTagSettings.id })
    .from(scheduleTagSettings)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new HttpError(409, "A tag with that name already exists.");
  }
}

async function getPhaseOrThrow(jobId: string, phaseId: string) {
  const [phase] = await db
    .select()
    .from(schedulePhases)
    .where(and(eq(schedulePhases.id, phaseId), eq(schedulePhases.jobId, jobId)))
    .limit(1);

  if (!phase) {
    throw new HttpError(404, "Schedule phase not found.");
  }

  return phase;
}

async function getTagOrThrow(jobId: string, tagId: string) {
  const [tag] = await db
    .select()
    .from(scheduleTagSettings)
    .where(and(eq(scheduleTagSettings.id, tagId), eq(scheduleTagSettings.jobId, jobId)))
    .limit(1);

  if (!tag) {
    throw new HttpError(404, "Schedule tag not found.");
  }

  return tag;
}

async function getWorkdayExceptionCategoryOrThrow(categoryId: string) {
  const [category] = await db
    .select()
    .from(scheduleWorkdayExceptionCategories)
    .where(eq(scheduleWorkdayExceptionCategories.id, categoryId))
    .limit(1);

  if (!category) {
    throw new HttpError(404, "Workday exception category not found.");
  }

  return category;
}

async function getWorkdayExceptionOrThrow(exceptionId: string) {
  const [exception] = await db
    .select()
    .from(scheduleWorkdayExceptions)
    .where(eq(scheduleWorkdayExceptions.id, exceptionId))
    .limit(1);

  if (!exception) {
    throw new HttpError(404, "Workday exception not found.");
  }

  return exception;
}

function workdayExceptionAppliesToJob(
  jobId: string,
  exception: {
    appliesToAllJobs: boolean | null;
    jobIds: string[] | null;
  },
) {
  return !!exception.appliesToAllJobs || (Array.isArray(exception.jobIds) && exception.jobIds.includes(jobId));
}

function uniqueJobIds(jobIds: string[]) {
  return Array.from(new Set(jobIds));
}

async function listAllActiveJobIds() {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(isNull(jobs.deletedAt));

  return rows.map((row) => row.id);
}

async function resolveWorkdayExceptionTargetJobIds(
  auth: AuthContext,
  exception: {
    appliesToAllJobs: boolean | null;
    jobIds: string[] | null;
  },
) {
  if (exception.appliesToAllJobs) {
    if (!isAdmin(auth)) {
      throw new HttpError(403, "Only admins can manage company-wide workday exceptions.");
    }

    return listAllActiveJobIds();
  }

  const jobIds = uniqueJobIds(Array.isArray(exception.jobIds) ? exception.jobIds : []);

  await Promise.all(jobIds.map((targetJobId) => assertCanManageJob(auth, targetJobId)));

  return jobIds;
}

async function synchronizeAffectedJobSchedules(
  jobIds: string[],
  executor: DbExecutor = db,
) {
  for (const affectedJobId of uniqueJobIds(jobIds)) {
    await synchronizeJobSchedule(affectedJobId, executor);
  }
}

async function buildBaselinePayload(jobId: string, executor: DbExecutor = db) {
  const rows = await executor
    .select({
      id: scheduleItems.id,
      title: scheduleItems.title,
      startDate: scheduleItems.startDate,
      endDate: scheduleItems.endDate,
    })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.jobId, jobId), isNull(scheduleItems.deletedAt)))
    .orderBy(asc(scheduleItems.startDate), asc(scheduleItems.title));

  return rows.map((row) => ({
    scheduleItemId: row.id,
    title: row.title,
    baselineStartDate: row.startDate,
    baselineEndDate: row.endDate,
  }));
}

type BaselineSnapshotEntry = {
  scheduleItemId: string;
  title: string;
  baselineStartDate: string;
  baselineEndDate: string;
};

async function filterBaselineSnapshotForAuth(
  auth: AuthContext,
  jobId: string,
  entries: Array<{ scheduleItemId: string }>,
) {
  if (entries.length === 0 || isAdmin(auth)) {
    return entries;
  }

  const itemIds = Array.from(new Set(entries.map((entry) => entry.scheduleItemId)));
  const visibility = buildScheduleListVisibilityFilter(auth);
  const conditions: SQL[] = [
    eq(scheduleItems.jobId, jobId),
    inArray(scheduleItems.id, itemIds),
    isNull(scheduleItems.deletedAt),
  ];

  if (visibility) {
    conditions.push(visibility);
  }

  const visibleRows = await db
    .select({ id: scheduleItems.id })
    .from(scheduleItems)
    .where(and(...conditions)!);
  const visibleIds = new Set(visibleRows.map((row) => row.id));

  return entries.filter((entry) => visibleIds.has(entry.scheduleItemId));
}

async function upsertBaselineForJob(jobId: string, userId: string) {
  // Persist cascade + auto-complete + baseline write atomically so a
  // failure in any step rolls back the others. Without this, a failed
  // baseline INSERT could leave the cascade UPDATE committed (or vice
  // versa) and the persisted state would drift from what the user saw.
  const txResult = await db.transaction(async (tx) => {
    await synchronizeJobSchedule(jobId, tx);
    const items = await buildBaselinePayload(jobId, tx);

    const [prior] = await tx
      .select({ id: scheduleBaselines.id })
      .from(scheduleBaselines)
      .where(eq(scheduleBaselines.jobId, jobId))
      .limit(1);

    if (prior) {
      await tx
        .update(scheduleBaselines)
        .set({
          capturedAt: new Date(),
          capturedBy: userId,
          itemsSnapshot: items,
          updatedAt: new Date(),
        })
        .where(eq(scheduleBaselines.id, prior.id));
    } else {
      await tx.insert(scheduleBaselines).values({
        id: crypto.randomUUID(),
        jobId,
        capturedAt: new Date(),
        capturedBy: userId,
        itemsSnapshot: items,
      });
    }

    return { existed: !!prior, itemsSnapshot: items };
  });

  // `existing` and `itemsSnapshot` are still needed in the response shape
  // below — pull them out of the transaction result.
  const existing = txResult.existed ? { id: jobId } : null;
  const itemsSnapshot = txResult.itemsSnapshot;

  const [baseline] = await db
    .select({
      id: scheduleBaselines.id,
      jobId: scheduleBaselines.jobId,
      capturedAt: scheduleBaselines.capturedAt,
      capturedBy: scheduleBaselines.capturedBy,
      capturedByName: users.fullName,
    })
    .from(scheduleBaselines)
    .leftJoin(users, eq(scheduleBaselines.capturedBy, users.id))
    .where(eq(scheduleBaselines.jobId, jobId))
    .limit(1);

  return {
    statusCode: existing ? 200 : 201,
    baseline: baseline
      ? {
          ...baseline,
          items: itemsSnapshot.map((item) => ({
            ...item,
            currentStartDate: item.baselineStartDate,
            currentEndDate: item.baselineEndDate,
            shiftDays: 0,
          })),
        }
      : null,
  };
}

async function hydrateScheduleItems(
  itemIds: string[],
  requestingUserId?: string,
  /**
   * Optional override map of cascade-resolved start/end dates. The read
   * endpoint passes this so the response reflects the cascade WITHOUT the
   * handler having to write the cascaded dates back to the DB. Without an
   * override the rows' persisted dates are used unchanged.
   */
  cascadedDates?: Map<string, { startDate: string; endDate: string }>,
) {
  const uniqueItemIds = Array.from(new Set(itemIds))

  if (uniqueItemIds.length === 0) {
    return []
  }

  const rows = await db
    .select({
      id: scheduleItems.id,
      jobId: scheduleItems.jobId,
      schedulePhaseId: scheduleItems.schedulePhaseId,
      title: scheduleItems.title,
      displayColor: scheduleItems.displayColor,
      startDate: scheduleItems.startDate,
      endDate: scheduleItems.endDate,
      workDays: scheduleItems.workDays,
      isHourly: scheduleItems.isHourly,
      startTime: scheduleItems.startTime,
      endTime: scheduleItems.endTime,
      progress: scheduleItems.progress,
      reminder: scheduleItems.reminder,
      showOnGantt: scheduleItems.showOnGantt,
      visibleToEstimators: scheduleItems.visibleToEstimators,
      visibleToInstallers: scheduleItems.visibleToInstallers,
      visibleToOfficeStaff: scheduleItems.visibleToOfficeStaff,
      isComplete: scheduleItems.isComplete,
      isPersonalTodo: scheduleItems.isPersonalTodo,
      notes: scheduleItems.notes,
      createdBy: scheduleItems.createdBy,
      createdAt: scheduleItems.createdAt,
      updatedAt: scheduleItems.updatedAt,
      deletedAt: scheduleItems.deletedAt,
      createdByName: users.fullName,
      createdByAvatarUrl: users.avatarUrl,
      phaseName: schedulePhases.name,
      phaseColor: schedulePhases.color,
    })
    .from(scheduleItems)
    .leftJoin(users, eq(scheduleItems.createdBy, users.id))
    .leftJoin(schedulePhases, eq(scheduleItems.schedulePhaseId, schedulePhases.id))
    .where(
      and(
        inArray(scheduleItems.id, uniqueItemIds),
        isNull(scheduleItems.deletedAt),
        // Defense-in-depth: never return another user's personal to-do row,
        // even if the caller forgot to pre-filter upstream.
        requestingUserId
          ? or(
              eq(scheduleItems.isPersonalTodo, false),
              isNull(scheduleItems.isPersonalTodo),
              eq(scheduleItems.createdBy, requestingUserId),
            )
          : undefined,
      ),
    )

  const rowById = new Map(rows.map((row) => [row.id, row]))
  const jobIds = Array.from(new Set(rows.map((row) => row.jobId).filter((jobId): jobId is string => !!jobId)))

  const [assigneeRows, predecessorRows, noteRows, attachmentRows, todoRows, workdayExceptionsByJobId] = await Promise.all([
    db
      .select({
        scheduleItemId: scheduleItemAssignees.scheduleItemId,
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(scheduleItemAssignees)
      .innerJoin(users, eq(scheduleItemAssignees.userId, users.id))
      .where(inArray(scheduleItemAssignees.scheduleItemId, uniqueItemIds))
      .orderBy(asc(users.fullName)),
    db
      .select({
        itemId: scheduleItemPredecessors.scheduleItemId,
        scheduleItemId: scheduleItemPredecessors.predecessorId,
        dependencyType: scheduleItemPredecessors.dependencyType,
        lagDays: scheduleItemPredecessors.lagDays,
        title: scheduleItems.title,
        startDate: scheduleItems.startDate,
        endDate: scheduleItems.endDate,
      })
      .from(scheduleItemPredecessors)
      .innerJoin(scheduleItems, eq(scheduleItemPredecessors.predecessorId, scheduleItems.id))
      .where(
        and(
          inArray(scheduleItemPredecessors.scheduleItemId, uniqueItemIds),
          requestingUserId
            ? or(
                eq(scheduleItems.isPersonalTodo, false),
                isNull(scheduleItems.isPersonalTodo),
                eq(scheduleItems.createdBy, requestingUserId),
              )
            : undefined,
        ),
      ),
    db
      .select({
        scheduleItemId: scheduleItemNotes.scheduleItemId,
        id: scheduleItemNotes.id,
        note: scheduleItemNotes.note,
        createdAt: scheduleItemNotes.createdAt,
        authorId: users.id,
        authorName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(scheduleItemNotes)
      .leftJoin(users, eq(scheduleItemNotes.createdBy, users.id))
      .where(inArray(scheduleItemNotes.scheduleItemId, uniqueItemIds))
      .orderBy(desc(scheduleItemNotes.createdAt)),
    db
      .select({
        scheduleItemId: scheduleItemAttachments.scheduleItemId,
        id: scheduleItemAttachments.id,
        fileId: files.id,
        filename: files.filename,
        originalName: files.originalName,
        fileUrl: files.fileUrl,
        fileSize: files.fileSize,
        mimeType: files.mimeType,
        createdAt: files.createdAt,
      })
      .from(scheduleItemAttachments)
      .innerJoin(files, eq(scheduleItemAttachments.fileId, files.id))
      .where(inArray(scheduleItemAttachments.scheduleItemId, uniqueItemIds))
      .orderBy(desc(files.createdAt)),
    db
      .select({
        scheduleItemId: scheduleItemTodos.scheduleItemId,
        id: scheduleItemTodos.id,
        title: scheduleItemTodos.title,
        isComplete: scheduleItemTodos.isComplete,
        createdAt: scheduleItemTodos.createdAt,
        updatedAt: scheduleItemTodos.updatedAt,
        createdBy: scheduleItemTodos.createdBy,
        createdByName: users.fullName,
      })
      .from(scheduleItemTodos)
      .leftJoin(users, eq(scheduleItemTodos.createdBy, users.id))
      .where(inArray(scheduleItemTodos.scheduleItemId, uniqueItemIds))
      .orderBy(desc(scheduleItemTodos.createdAt)),
    getWorkdayExceptionsByJob(jobIds),
  ])

  const assigneesByItemId = new Map<string, Array<{
    id: string
    fullName: string | null
    email: string
    role: string
    avatarUrl: string | null
  }>>()
  for (const row of assigneeRows) {
    const group = assigneesByItemId.get(row.scheduleItemId) ?? []
    group.push({
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatarUrl,
    })
    assigneesByItemId.set(row.scheduleItemId, group)
  }

  const predecessorsByItemId = new Map<string, typeof predecessorRows>()
  for (const row of predecessorRows) {
    const group = predecessorsByItemId.get(row.itemId) ?? []
    group.push(row)
    predecessorsByItemId.set(row.itemId, group)
  }

  const notesByItemId = new Map<string, typeof noteRows>()
  for (const row of noteRows) {
    const group = notesByItemId.get(row.scheduleItemId) ?? []
    group.push(row)
    notesByItemId.set(row.scheduleItemId, group)
  }

  const attachmentsByItemId = new Map<string, typeof attachmentRows>()
  for (const row of attachmentRows) {
    const group = attachmentsByItemId.get(row.scheduleItemId) ?? []
    group.push(row)
    attachmentsByItemId.set(row.scheduleItemId, group)
  }

  const attachmentStorageStatuses = await probeStorageStatuses(
    attachmentRows.map((row) => row.fileUrl),
  )

  const todosByItemId = new Map<string, typeof todoRows>()
  for (const row of todoRows) {
    const group = todosByItemId.get(row.scheduleItemId) ?? []
    group.push(row)
    todosByItemId.set(row.scheduleItemId, group)
  }

  return uniqueItemIds.flatMap((itemId) => {
    const dbRow = rowById.get(itemId)

    if (!dbRow) {
      return []
    }

    // Apply optional cascade overrides so the read endpoint can show the
    // cascaded dates without persisting them.
    const cascadeOverride = cascadedDates?.get(itemId)
    const row = cascadeOverride
      ? { ...dbRow, startDate: cascadeOverride.startDate, endDate: cascadeOverride.endDate }
      : dbRow

    const meta = decodeScheduleMeta(row.notes)
    const predecessorRowsForItem = predecessorsByItemId.get(itemId) ?? []
    const fallbackPredecessors =
      predecessorRowsForItem.length === 0
        ? meta.predecessors.map((predecessor) => ({
            itemId,
            scheduleItemId: predecessor.scheduleItemId,
            dependencyType: predecessor.dependencyType,
            lagDays: predecessor.lagDays,
            title: "Unknown task",
            startDate: row.startDate,
            endDate: row.endDate,
          }))
        : []
    const resolvedPredecessorRows = predecessorRowsForItem.length > 0 ? predecessorRowsForItem : fallbackPredecessors
    const predecessorMap = new Map(
      resolvedPredecessorRows.map((predecessor) => {
        // Cascaded dates also apply to predecessor rows so conflict
        // detection compares against the cascade-resolved values, not the
        // stale persisted ones.
        const predOverride = cascadedDates?.get(predecessor.scheduleItemId)
        return [
          predecessor.scheduleItemId,
          {
            title: predecessor.title ?? "Unknown task",
            startDate: predOverride?.startDate ?? predecessor.startDate,
            endDate: predOverride?.endDate ?? predecessor.endDate,
          },
        ]
      }),
    )
    const predecessorEntries = resolvedPredecessorRows.map((predecessor) => ({
      scheduleItemId: predecessor.scheduleItemId,
      dependencyType: predecessor.dependencyType as z.infer<typeof predecessorSchema>["dependencyType"],
      lagDays: predecessor.lagDays,
      title: predecessor.title ?? "Unknown task",
    }))
    const workdayExceptions = row.jobId ? workdayExceptionsByJobId.get(row.jobId) ?? [] : []
    const conflictReasons = predecessorConflictReasons(
      {
        title: row.title,
        startDate: row.startDate,
        endDate: row.endDate,
        predecessors: predecessorEntries,
      },
      predecessorMap,
      workdayExceptions,
    )

    const notesStream = [
      ...(meta.notes
        ? [
            {
              id: "legacy-" + row.id,
              note: meta.notes,
              createdAt: row.createdAt,
              authorId: row.createdBy,
              authorName: row.createdByName,
              authorAvatarUrl: row.createdByAvatarUrl,
              isLegacy: true,
            },
          ]
        : []),
      ...(notesByItemId.get(itemId) ?? []).map((note) => ({
        ...note,
        isLegacy: false,
      })),
    ]

    const assignees = assigneesByItemId.get(itemId) ?? []
    const attachments = (attachmentsByItemId.get(itemId) ?? []).map((attachment) => ({
      id: attachment.id,
      fileId: attachment.fileId,
      filename: attachment.filename,
      originalName: attachment.originalName,
      fileUrl: attachment.fileUrl,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      createdAt: attachment.createdAt,
      icon: fileIconKind(attachment.mimeType),
      storageStatus:
        attachment.fileUrl &&
        attachmentStorageStatuses.get(attachment.fileUrl) === "ok"
          ? ("ok" as const)
          : ("missing" as const),
    }))
    const relatedTodos = (todosByItemId.get(itemId) ?? []).map((todo) => ({
      id: todo.id,
      title: todo.title,
      isComplete: todo.isComplete,
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
      createdBy: todo.createdBy,
      createdByName: todo.createdByName,
    }))

    return [{
      item: {
        ...row,
        displayColor: row.displayColor ?? "#2563eb",
        notes: meta.notes,
        tags: meta.tags,
        notifyUserIds: [],
        phaseId: row.schedulePhaseId,
        phaseName: row.phaseName,
        phaseColor: row.phaseColor,
        assigneeIds: assignees.map((assignee) => assignee.id),
        assignees,
        predecessors: predecessorEntries,
        notesStream,
        noteCount: notesStream.length,
        attachments,
        relatedTodos,
        relatedTodoCount: relatedTodos.length,
        status: deriveScheduleStatus({
          startDate: row.startDate,
          endDate: row.endDate,
          progress: row.progress,
          isComplete: row.isComplete,
        }),
        hasConflict: conflictReasons.length > 0,
        conflictReasons,
      },
    }]
  })
}

async function hydrateScheduleItem(itemId: string, requestingUserId?: string) {
  const [hydrated] = await hydrateScheduleItems([itemId], requestingUserId)

  if (!hydrated) {
    throw new HttpError(404, "Schedule item not found.")
  }

  return hydrated
}

export type HydratedScheduleItem = Awaited<ReturnType<typeof hydrateScheduleItem>>["item"];

const SCHEDULE_DOC_NOTES_LIMIT = 20;

const SCHEDULE_COLOR_LABELS: Record<string, string> = {
  "#7b2d26": "Maroon",
  "#7a1f3d": "Merlot",
  "#9b2c2c": "Tuscan Red",
  "#e76f8a": "Rose",
  "#7c6aa6": "Victoria",
  "#7b5b3a": "Brown",
  "#6f4e37": "Coffee",
  "#d99a1c": "Amber",
  "#4f8a10": "Cucumber",
  "#6e3c5d": "Plum",
  "#7e3ace": "Purple",
  "#b695e0": "Lavender",
  "#5f6edc": "Iris",
  "#8b5cf6": "Violet",
  "#1f3c88": "Navy",
  "#2563eb": "Levi",
};

function formatColorLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  const normalized = value.toLowerCase();
  const named = SCHEDULE_COLOR_LABELS[normalized];
  return named ? `${named} (${normalized})` : `Custom (${value})`;
}

function formatHourTimeLabel(value: string | null) {
  if (!value) return null;
  const [hhRaw, mmRaw = "00"] = value.split(":");
  const hour = Number.parseInt(hhRaw ?? "", 10);
  const minute = Number.parseInt(mmRaw, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const period = hour >= 12 ? "PM" : "AM";
  const display = ((hour + 11) % 12) + 1;
  return `${display}:${String(minute).padStart(2, "0")} ${period}`;
}

function placeholderText(value: string | null | undefined, fallback = "Not set") {
  if (value === null || value === undefined) return fallback;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function formatYesNoLabel(value: boolean | null | undefined) {
  if (value === null || value === undefined) return "Not set";
  return value ? "Yes" : "No";
}

export function buildScheduleItemDocBody(params: {
  item: HydratedScheduleItem;
  jobTitle: string | null;
  createdByName: string | null;
  createdByEmail: string;
  createdAt: Date;
}): string {
  const { item, jobTitle, createdByName, createdByEmail, createdAt } = params;
  const lines: string[] = [];

  lines.push(item.title);
  lines.push("=".repeat(Math.max(item.title.length, 3)));
  lines.push("");

  const completionLabel = item.isComplete ? "Complete" : "In Progress";
  const progressValue = item.progress ?? 0;
  lines.push("STATUS");
  lines.push(`  Completion: ${completionLabel}`);
  lines.push(`  Progress: ${progressValue}%`);
  lines.push(`  Display Color: ${formatColorLabel(item.displayColor ?? null)}`);
  lines.push("");

  lines.push("JOB");
  lines.push(`  Job: ${placeholderText(jobTitle, "Unknown job")}`);
  lines.push(`  Phase: ${placeholderText(item.phaseName ?? null, "None")}`);
  lines.push("");

  lines.push("ASSIGNEES");
  if (item.assignees.length === 0) {
    lines.push("  None");
  } else {
    for (const assignee of item.assignees) {
      const name = assignee.fullName?.trim() || assignee.email;
      lines.push(`  - ${name}`);
    }
  }
  lines.push("");

  lines.push("SCHEDULE");
  lines.push(`  Start Date: ${item.startDate}`);
  lines.push(`  End Date: ${item.endDate}`);
  lines.push(`  Work Days: ${item.workDays}`);
  lines.push(`  Hourly: ${item.isHourly ? "Yes" : "No"}`);
  if (item.isHourly) {
    lines.push(`  Start Time: ${placeholderText(formatHourTimeLabel(item.startTime))}`);
    lines.push(`  End Time: ${placeholderText(formatHourTimeLabel(item.endTime))}`);
  }
  lines.push("");

  lines.push("TAGS");
  lines.push(`  ${item.tags.length > 0 ? item.tags.join(", ") : "None"}`);
  lines.push("");

  lines.push("REMINDER");
  lines.push(`  ${labelizeScheduleValue(item.reminder ?? "none")}`);
  lines.push("");

  lines.push("PREDECESSORS");
  if (item.predecessors.length === 0) {
    lines.push("  None");
  } else {
    for (const predecessor of item.predecessors) {
      const lagSuffix = predecessor.lagDays === 1 ? "" : "s";
      lines.push(
        `  - ${predecessor.title} • ${predecessorDependencyLabel(predecessor.dependencyType)} • lag ${predecessor.lagDays} day${lagSuffix}`,
      );
    }
  }
  lines.push("");

  lines.push("VISIBILITY");
  lines.push(`  Show on Gantt: ${formatYesNoLabel(item.showOnGantt)}`);
  lines.push(`  Visible to Estimators: ${formatYesNoLabel(item.visibleToEstimators)}`);
  lines.push(`  Visible to Installers: ${formatYesNoLabel(item.visibleToInstallers)}`);
  lines.push(`  Visible to Office Staff: ${formatYesNoLabel(item.visibleToOfficeStaff)}`);
  lines.push("");

  const totalNotes = item.notesStream.length;
  const notesHeading =
    totalNotes > SCHEDULE_DOC_NOTES_LIMIT
      ? `NOTES (most recent first, showing latest ${SCHEDULE_DOC_NOTES_LIMIT} of ${totalNotes})`
      : "NOTES (most recent first)";
  lines.push(notesHeading);
  if (totalNotes === 0) {
    lines.push("  None");
  } else {
    const slice = item.notesStream
      .slice()
      .sort((a, b) => {
        const aTs = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt as string).getTime();
        const bTs = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt as string).getTime();
        return bTs - aTs;
      })
      .slice(0, SCHEDULE_DOC_NOTES_LIMIT);
    for (const note of slice) {
      const author = note.authorName?.trim() || "Unknown author";
      const ts =
        note.createdAt instanceof Date
          ? note.createdAt.toISOString()
          : String(note.createdAt ?? "");
      lines.push(`  [${ts}] ${author}:`);
      for (const noteLine of note.note.split("\n")) {
        lines.push(`    ${noteLine}`);
      }
    }
  }
  lines.push("");

  lines.push("---");
  const creator = createdByName?.trim() || createdByEmail;
  lines.push(`Item ID: ${item.id}`);
  lines.push(`Document created by: ${creator}`);
  lines.push(`Document created at: ${createdAt.toISOString()}`);

  return lines.join("\n");
}

export const __scheduleDocTesting = {
  hydrateScheduleItem,
};
router.get(
  "/jobs/:jobId/schedule/settings",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const [storedSettings, phases, tags, categories] = await Promise.all([
      ensureDefaultScheduleSettings(jobId),
      db
        .select({
          id: schedulePhases.id,
          name: schedulePhases.name,
          color: schedulePhases.color,
        })
        .from(schedulePhases)
        .where(eq(schedulePhases.jobId, jobId))
        .orderBy(asc(schedulePhases.name)),
      db
        .select({
          id: scheduleTagSettings.id,
          name: scheduleTagSettings.name,
        })
        .from(scheduleTagSettings)
        .where(eq(scheduleTagSettings.jobId, jobId))
        .orderBy(asc(scheduleTagSettings.name)),
      db
        .select({
          id: scheduleWorkdayExceptionCategories.id,
          name: scheduleWorkdayExceptionCategories.name,
        })
        .from(scheduleWorkdayExceptionCategories)
        .where(or(eq(scheduleWorkdayExceptionCategories.jobId, jobId), isNull(scheduleWorkdayExceptionCategories.jobId)))
        .orderBy(asc(scheduleWorkdayExceptionCategories.name)),
    ]);

    res.json({
      defaultView: storedSettings.defaultView,
      showTimesOnMonthView: !!storedSettings.showTimesOnMonthView,
      showJobNameOnAllListedJobs: !!storedSettings.showJobNameOnAllListedJobs,
      automaticallyMarkItemsComplete: !!storedSettings.automaticallyMarkItemsComplete,
      includeHeaderOnPdfExports: !!storedSettings.includeHeaderOnPdfExports,
      phases,
      tags,
      workdayExceptionCategories: categories,
    });
  }),
);

router.put(
  "/jobs/:jobId/schedule/settings",
  asyncHandler(async (req, res) => {
    const body = scheduleSettingsPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule settings payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");

    // Persist the settings change and the (possibly new) auto-complete
    // sweep atomically. If the sweep fails the settings change rolls back,
    // so a viewer never observes the new value while the sweep is still
    // in flight.
    const updated = await db.transaction(async (tx) => {
      const existing = await ensureDefaultScheduleSettings(jobId, tx);

      const [row] = await tx
        .update(scheduleSettings)
        .set({
          defaultView: body.data.defaultView ?? existing.defaultView,
          showTimesOnMonthView: body.data.showTimesOnMonthView ?? existing.showTimesOnMonthView,
          showJobNameOnAllListedJobs:
            body.data.showJobNameOnAllListedJobs ?? existing.showJobNameOnAllListedJobs,
          automaticallyMarkItemsComplete:
            body.data.automaticallyMarkItemsComplete ?? existing.automaticallyMarkItemsComplete,
          includeHeaderOnPdfExports:
            body.data.includeHeaderOnPdfExports ?? existing.includeHeaderOnPdfExports,
          updatedAt: new Date(),
        })
        .where(eq(scheduleSettings.jobId, jobId))
        .returning();

      await applyAutomaticCompletionIfEnabled(jobId, tx);
      return row;
    });

    res.json({ settings: updated });
  }),
);

router.post(
  "/jobs/:jobId/schedule/settings/phases",
  asyncHandler(async (req, res) => {
    const body = schedulePhasePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid phase payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    const job = await ensureJobExists(jobId);
    await assertUniquePhaseName(jobId, body.data.name);

    const [phase] = await db
      .insert(schedulePhases)
      .values({
        jobId,
        name: body.data.name,
        color: body.data.color ?? "#e76f8a",
      })
      .returning({
        id: schedulePhases.id,
        name: schedulePhases.name,
        color: schedulePhases.color,
      });

    await writeActivity({
      entityType: "schedule_phase",
      entityId: phase.id,
      action: "created",
      userId: req.auth!.userId,
      jobId,
      description: `Created schedule phase ${phase.name} for ${job.title}`,
    });

    res.status(201).json({ phase });
  }),
);

router.put(
  "/jobs/:jobId/schedule/settings/phases/:phaseId",
  asyncHandler(async (req, res) => {
    const body = schedulePhasePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid phase payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    const phaseId = getParam(req.params.phaseId, "phase id");
    await ensureJobExists(jobId);
    await getPhaseOrThrow(jobId, phaseId);
    await assertUniquePhaseName(jobId, body.data.name, phaseId);

    const [phase] = await db
      .update(schedulePhases)
      .set({
        name: body.data.name,
        color: body.data.color ?? "#e76f8a",
        updatedAt: new Date(),
      })
      .where(eq(schedulePhases.id, phaseId))
      .returning({
        id: schedulePhases.id,
        name: schedulePhases.name,
        color: schedulePhases.color,
      });

    res.json({ phase });
  }),
);

router.get(
  "/jobs/:jobId/schedule/phases",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const phases = await db
      .select({
        id: schedulePhases.id,
        name: schedulePhases.name,
        color: schedulePhases.color,
      })
      .from(schedulePhases)
      .where(eq(schedulePhases.jobId, jobId))
      .orderBy(asc(schedulePhases.name));

    res.json({ phases });
  }),
);

router.post(
  "/jobs/:jobId/schedule/phases",
  asyncHandler(async (req, res) => {
    const body = schedulePhasePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid phase payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    await assertUniquePhaseName(jobId, body.data.name);

    const [phase] = await db
      .insert(schedulePhases)
      .values({
        jobId,
        name: body.data.name,
        color: body.data.color ?? "#e76f8a",
      })
      .returning({
        id: schedulePhases.id,
        name: schedulePhases.name,
        color: schedulePhases.color,
      });

    res.status(201).json({ phase });
  }),
);

router.put(
  "/jobs/:jobId/schedule/phases/:phaseId",
  asyncHandler(async (req, res) => {
    const body = schedulePhasePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid phase payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    const phaseId = getParam(req.params.phaseId, "phase id");
    await ensureJobExists(jobId);
    await getPhaseOrThrow(jobId, phaseId);
    await assertUniquePhaseName(jobId, body.data.name, phaseId);

    const [phase] = await db
      .update(schedulePhases)
      .set({
        name: body.data.name,
        color: body.data.color ?? "#e76f8a",
        updatedAt: new Date(),
      })
      .where(eq(schedulePhases.id, phaseId))
      .returning({
        id: schedulePhases.id,
        name: schedulePhases.name,
        color: schedulePhases.color,
      });

    res.json({ phase });
  }),
);

router.delete(
  "/jobs/:jobId/schedule/phases/:phaseId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    const phaseId = getParam(req.params.phaseId, "phase id");
    await ensureJobExists(jobId);
    await getPhaseOrThrow(jobId, phaseId);

    await db
      .update(scheduleItems)
      .set({
        schedulePhaseId: null,
        updatedAt: new Date(),
      })
      .where(eq(scheduleItems.schedulePhaseId, phaseId));
    await db.delete(schedulePhases).where(eq(schedulePhases.id, phaseId));

    res.json({ success: true });
  }),
);

router.post(
  "/jobs/:jobId/schedule/settings/tags",
  asyncHandler(async (req, res) => {
    const body = scheduleSettingPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid tag payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    const job = await ensureJobExists(jobId);
    await assertUniqueTagName(jobId, body.data.name);

    const [tag] = await db
      .insert(scheduleTagSettings)
      .values({
        jobId,
        name: body.data.name,
      })
      .returning({
        id: scheduleTagSettings.id,
        name: scheduleTagSettings.name,
      });

    await writeActivity({
      entityType: "schedule_tag",
      entityId: tag.id,
      action: "created",
      userId: req.auth!.userId,
      jobId,
      description: `Created schedule tag ${tag.name} for ${job.title}`,
    });

    res.status(201).json({ tag });
  }),
);

router.put(
  "/jobs/:jobId/schedule/settings/tags/:tagId",
  asyncHandler(async (req, res) => {
    const body = scheduleSettingPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid tag payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    const tagId = getParam(req.params.tagId, "tag id");
    await ensureJobExists(jobId);
    await getTagOrThrow(jobId, tagId);
    await assertUniqueTagName(jobId, body.data.name, tagId);

    const [tag] = await db
      .update(scheduleTagSettings)
      .set({
        name: body.data.name,
        updatedAt: new Date(),
      })
      .where(eq(scheduleTagSettings.id, tagId))
      .returning({
        id: scheduleTagSettings.id,
        name: scheduleTagSettings.name,
      });

    res.json({ tag });
  }),
);

router.get(
  "/jobs/:jobId/schedule/baseline",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    // Read-only existence check; ensureJobExists also lazy-INSERTs a
    // default phase + settings row, which would still be a hidden write
    // on this read-shaped endpoint. Defaults are created on the next
    // write path. Mirrors the #162 fix on GET /jobs/:jobId/schedule.
    await verifyJobExists(jobId);

    // Read-only endpoint: cascade is computed in memory and applied as
    // overrides on the "current" dates returned in the response.
    // Persistence happens on write paths and the periodic auto-complete
    // sweeper. Mirrors the #162 fix on GET /jobs/:jobId/schedule — opening
    // the baseline tab must never silently rewrite persisted dates,
    // because that confuses read-scope PATs/agents and races concurrent
    // viewers. Audit task #210 found and removed the hidden write here.
    const cascadeInputs = await loadJobScheduleCascadeInputs(jobId);
    const cascadedDates = computeJobScheduleCascade(
      cascadeInputs.items,
      cascadeInputs.predecessorRows,
      cascadeInputs.exceptions,
    );

    const [baseline] = await db
      .select({
        id: scheduleBaselines.id,
        jobId: scheduleBaselines.jobId,
        capturedAt: scheduleBaselines.capturedAt,
        capturedBy: scheduleBaselines.capturedBy,
        capturedByName: users.fullName,
        itemsSnapshot: scheduleBaselines.itemsSnapshot,
      })
      .from(scheduleBaselines)
      .leftJoin(users, eq(scheduleBaselines.capturedBy, users.id))
      .where(eq(scheduleBaselines.jobId, jobId))
      .limit(1);

    if (!baseline) {
      res.json({ baseline: null });
      return;
    }

    // Use the in-memory cascade-resolved dates as the "current" view; fall
    // back to the persisted row for any item the cascade can't override.
    const currentItemMap = new Map(
      cascadeInputs.items.map((item) => {
        const next = cascadedDates.get(item.id);
        return [
          item.id,
          {
            id: item.id,
            startDate: next?.startDate ?? item.startDate,
            endDate: next?.endDate ?? item.endDate,
          },
        ];
      }),
    );
    const snapshot = Array.isArray(baseline.itemsSnapshot)
      ? (baseline.itemsSnapshot as BaselineSnapshotEntry[])
      : [];
    const allItems = snapshot.map((entry) => {
      const current = currentItemMap.get(entry.scheduleItemId);
      const shiftDays = current
        ? diffInDays(parseIsoDate(entry.baselineEndDate), parseIsoDate(current.endDate))
        : 0;

      return {
        scheduleItemId: entry.scheduleItemId,
        title: entry.title,
        baselineStartDate: entry.baselineStartDate,
        baselineEndDate: entry.baselineEndDate,
        currentStartDate: current?.startDate ?? null,
        currentEndDate: current?.endDate ?? null,
        shiftDays,
      };
    });
    const items = await filterBaselineSnapshotForAuth(req.auth!, jobId, allItems);

    res.json({
      baseline: {
        id: baseline.id,
        jobId: baseline.jobId,
        capturedAt: baseline.capturedAt,
        capturedBy: baseline.capturedBy,
        capturedByName: baseline.capturedByName,
        items,
      },
    });
  }),
);

router.post(
  "/jobs/:jobId/schedule/baseline",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    const response = await upsertBaselineForJob(jobId, req.auth!.userId);
    res.status(response.statusCode).json({ baseline: response.baseline });
  }),
);

router.put(
  "/jobs/:jobId/schedule/baseline",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    const response = await upsertBaselineForJob(jobId, req.auth!.userId);
    res.status(response.statusCode).json({ baseline: response.baseline });
  }),
);

router.delete(
  "/jobs/:jobId/schedule/baseline",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    await db.delete(scheduleBaselines).where(eq(scheduleBaselines.jobId, jobId));
    res.json({ success: true });
  }),
);

router.post(
  "/jobs/:jobId/workday-exceptions/categories",
  asyncHandler(async (req, res) => {
    const body = workdayExceptionCategoryPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid workday exception category payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const [category] = await db
      .insert(scheduleWorkdayExceptionCategories)
      .values({
        id: crypto.randomUUID(),
        jobId,
        name: body.data.name,
      })
      .returning({
        id: scheduleWorkdayExceptionCategories.id,
        name: scheduleWorkdayExceptionCategories.name,
      });

    res.status(201).json({ category });
  }),
);

router.put(
  "/jobs/:jobId/workday-exceptions/categories/:categoryId",
  asyncHandler(async (req, res) => {
    const body = workdayExceptionCategoryPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid workday exception category payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    const categoryId = getParam(req.params.categoryId, "category id");
    await ensureJobExists(jobId);
    await assertWorkdayExceptionCategoryBelongsToJob(jobId, categoryId);

    const [category] = await db
      .update(scheduleWorkdayExceptionCategories)
      .set({
        name: body.data.name,
        updatedAt: new Date(),
      })
      .where(eq(scheduleWorkdayExceptionCategories.id, categoryId))
      .returning({
        id: scheduleWorkdayExceptionCategories.id,
        name: scheduleWorkdayExceptionCategories.name,
      });

    res.json({ category });
  }),
);

router.get(
  "/jobs/:jobId/workday-exceptions",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const exceptions = await getWorkdayExceptionsForJob(jobId);
    res.json({ exceptions });
  }),
);

router.post(
  "/jobs/:jobId/workday-exceptions",
  asyncHandler(async (req, res) => {
    const body = workdayExceptionPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid workday exception payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    await assertWorkdayExceptionCategoryBelongsToJob(jobId, body.data.categoryId);
    const affectedJobIds = await resolveWorkdayExceptionTargetJobIds(req.auth!, {
      appliesToAllJobs: body.data.appliesToAllJobs,
      jobIds: body.data.appliesToAllJobs ? [] : body.data.jobIds,
    });

    // Insert + per-job cascade run together so a cascade failure rolls
    // back the exception (otherwise the new holiday would be saved but
    // schedule items still reflect the old workday math).
    const exception = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scheduleWorkdayExceptions)
        .values({
          id: crypto.randomUUID(),
          title: body.data.title,
          type: body.data.type,
          startDate: body.data.startDate,
          endDate: body.data.endDate,
          sameEveryYear: body.data.sameEveryYear,
          categoryId: body.data.categoryId,
          appliesToAllJobs: body.data.appliesToAllJobs,
          jobIds: body.data.appliesToAllJobs ? [] : body.data.jobIds,
          notes: body.data.notes,
          createdBy: req.auth!.userId,
        })
        .returning();

      await synchronizeAffectedJobSchedules(affectedJobIds, tx);
      return created;
    });

    res.status(201).json({ exception });
  }),
);

router.put(
  "/jobs/:jobId/workday-exceptions/:exceptionId",
  asyncHandler(async (req, res) => {
    const body = workdayExceptionUpdatePayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid workday exception payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    const exceptionId = getParam(req.params.exceptionId, "exception id");
    await ensureJobExists(jobId);
    const existing = await getWorkdayExceptionOrThrow(exceptionId);

    if (!workdayExceptionAppliesToJob(jobId, existing)) {
      throw new HttpError(404, "Workday exception not found.");
    }

    const nextCategoryId = body.data.categoryId ?? existing.categoryId;
    await assertWorkdayExceptionCategoryBelongsToJob(jobId, nextCategoryId);

    const nextAppliesToAllJobs = body.data.appliesToAllJobs ?? existing.appliesToAllJobs ?? false;
    const nextJobIds = body.data.jobIds ?? (Array.isArray(existing.jobIds) ? existing.jobIds : []);

    if (!nextAppliesToAllJobs && nextJobIds.length === 0) {
      throw new HttpError(400, "Select at least one job.");
    }

    const previouslyAffectedJobIds = await resolveWorkdayExceptionTargetJobIds(req.auth!, existing);
    const nextAffectedJobIds = await resolveWorkdayExceptionTargetJobIds(req.auth!, {
      appliesToAllJobs: nextAppliesToAllJobs,
      jobIds: nextAppliesToAllJobs ? [] : nextJobIds,
    });

    const exception = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(scheduleWorkdayExceptions)
        .set({
          title: body.data.title ?? existing.title,
          type: body.data.type ?? existing.type,
          startDate: body.data.startDate ?? existing.startDate,
          endDate: body.data.endDate ?? existing.endDate,
          sameEveryYear: body.data.sameEveryYear ?? existing.sameEveryYear,
          categoryId: nextCategoryId,
          appliesToAllJobs: nextAppliesToAllJobs,
          jobIds: nextAppliesToAllJobs ? [] : nextJobIds,
          notes: body.data.notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(eq(scheduleWorkdayExceptions.id, exceptionId))
        .returning();

      await synchronizeAffectedJobSchedules(
        [...previouslyAffectedJobIds, ...nextAffectedJobIds],
        tx,
      );
      return updated;
    });

    res.json({ exception });
  }),
);

router.delete(
  "/jobs/:jobId/workday-exceptions/:exceptionId",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    const exceptionId = getParam(req.params.exceptionId, "exception id");
    await ensureJobExists(jobId);
    const existing = await getWorkdayExceptionOrThrow(exceptionId);

    if (!workdayExceptionAppliesToJob(jobId, existing)) {
      throw new HttpError(404, "Workday exception not found.");
    }

    const affectedJobIds = await resolveWorkdayExceptionTargetJobIds(req.auth!, existing);

    await db.transaction(async (tx) => {
      await tx
        .delete(scheduleWorkdayExceptions)
        .where(eq(scheduleWorkdayExceptions.id, exceptionId));
      await synchronizeAffectedJobSchedules(affectedJobIds, tx);
    });
    res.json({ success: true });
  }),
);

router.post(
  "/jobs/:jobId/schedule/track-conflicts",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    await synchronizeJobSchedule(jobId);

    const rows = await db
      .select({
        id: scheduleItems.id,
      })
      .from(scheduleItems)
      .where(and(eq(scheduleItems.jobId, jobId), isNull(scheduleItems.deletedAt)))
      .orderBy(asc(scheduleItems.startDate), asc(scheduleItems.title));
    const currentUserId = req.auth!.userId;
    const hydrated = await hydrateScheduleItems(rows.map((row) => row.id), currentUserId);
    const conflicts = hydrated
      .map((entry) => entry.item)
      .filter((item) => !item.isPersonalTodo || item.createdBy === currentUserId)
      .filter((item) => item.hasConflict);

    res.json({
      conflicts,
      count: conflicts.length,
    });
  }),
);

router.post(
  "/jobs/:jobId/schedule/notify-assigned-users",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    const visibility = buildScheduleListVisibilityFilter(req.auth!);
    const conditions: SQL[] = [eq(scheduleItems.jobId, jobId), isNull(scheduleItems.deletedAt)];
    if (visibility) {
      conditions.push(visibility);
    }

    const rows = await db
      .select({
        scheduleItemId: scheduleItems.id,
        scheduleItemTitle: scheduleItems.title,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
      })
      .from(scheduleItems)
      .innerJoin(
        scheduleItemAssignees,
        eq(scheduleItemAssignees.scheduleItemId, scheduleItems.id),
      )
      .innerJoin(users, eq(scheduleItemAssignees.userId, users.id))
      .where(and(...conditions)!)
      .orderBy(asc(scheduleItems.startDate), asc(scheduleItems.title), asc(users.fullName));

    const recipients = new Map<string, { id: string; fullName: string; email: string }>();
    const itemsById = new Map<string, { id: string; title: string }>();

    for (const row of rows) {
      recipients.set(row.userId, {
        id: row.userId,
        fullName: row.fullName,
        email: row.email,
      });
      itemsById.set(row.scheduleItemId, {
        id: row.scheduleItemId,
        title: row.scheduleItemTitle,
      });
    }

    if (recipients.size > 0 && itemsById.size > 0) {
      await writeActivity({
        entityType: "schedule_notification",
        entityId: crypto.randomUUID(),
        action: "queued",
        userId: req.auth!.userId,
        jobId,
        description: `Queued schedule notifications for ${recipients.size} assigned user${recipients.size === 1 ? "" : "s"} across ${itemsById.size} item${itemsById.size === 1 ? "" : "s"}`,
        extra: {
          notifyUserIds: Array.from(recipients.keys()),
          recipients: Array.from(recipients.values()),
          scheduleItems: Array.from(itemsById.values()),
        },
      });
    }

    const recipientList = Array.from(recipients.values());
    const responseRecipients = isAdmin(req.auth!) || req.auth!.role === "project_manager"
      ? recipientList
      : recipientList.filter((recipient) => recipient.id === req.auth!.userId);

    res.json({
      success: true,
      countUsers: recipients.size,
      countItems: itemsById.size,
      recipients: responseRecipients,
    });
  }),
);

const SCHEDULE_LIST_DEFAULT_LIMIT = 200;
const SCHEDULE_LIST_MAX_LIMIT = 500;

const scheduleListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SCHEDULE_LIST_MAX_LIMIT)
    .optional()
    .default(SCHEDULE_LIST_DEFAULT_LIMIT),
  cursor: z.string().optional(),
});

router.get(
  "/jobs/:jobId/schedule",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await verifyJobExists(jobId);

    // Read-only endpoint: cascade is computed in memory and applied as
    // overrides during hydration. Persistence happens on write paths and
    // in the periodic auto-complete sweeper.
    const cascadeInputs = await loadJobScheduleCascadeInputs(jobId);
    const cascadedDates = computeJobScheduleCascade(
      cascadeInputs.items,
      cascadeInputs.predecessorRows,
      cascadeInputs.exceptions,
    );

    const parsedQuery = scheduleListQuerySchema.safeParse(req.query);

    if (!parsedQuery.success) {
      throw new HttpError(400, "Invalid schedule list query.", parsedQuery.error.flatten());
    }

    const { page, limit, cursor: rawCursor } = parsedQuery.data;
    // Cursor mode is opt-in by passing an explicit `cursor` query param.
    // `?limit=N` alone keeps page-mode semantics so callers always receive the
    // visibility-scoped `totalItems`/`totalPages` they need to render counts.
    const isCursorMode = Object.prototype.hasOwnProperty.call(
      req.query,
      "cursor",
    );
    const cursorPayload = rawCursor ? decodeCursor(rawCursor) : null;
    const auth = req.auth!;
    const currentUserId = auth.userId;

    // Filter visibility in SQL; ordering is applied in memory against
    // the cascaded dates.
    const filters: SQL[] = [
      eq(scheduleItems.jobId, jobId),
      isNull(scheduleItems.deletedAt),
    ];
    const visibility = buildScheduleListVisibilityFilter(auth);
    if (visibility) filters.push(visibility);

    if (cursorPayload) {
      const cursorStartDateRaw = String(cursorPayload.k[0] ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cursorStartDateRaw)) {
        throw new HttpError(400, "Invalid cursor.", undefined, "validation");
      }
    }

    const baseWhere = and(...filters);

    // Persisted start_date can lag the cascade now that GET is read-only,
    // so order in memory by the cascaded (startDate, id) to keep cursor
    // traversal consistent with the dates the response surfaces.
    const candidates = await db
      .select({ id: scheduleItems.id, startDate: scheduleItems.startDate })
      .from(scheduleItems)
      .where(baseWhere);

    const orderedCandidates = candidates
      .map((row) => ({
        id: row.id,
        startDate: cascadedDates.get(row.id)?.startDate ?? row.startDate,
      }))
      .sort((a, b) => {
        if (a.startDate !== b.startDate) {
          return a.startDate < b.startDate ? -1 : 1;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

    if (isCursorMode) {
      // Cursor key is (cascaded startDate, id) — same source of truth
      // as the response.
      const startIndex = cursorPayload
        ? orderedCandidates.findIndex((row) => {
            const cursorStartDate = String(cursorPayload.k[0] ?? "");
            const cursorId = cursorPayload.id;
            if (row.startDate !== cursorStartDate) {
              return row.startDate > cursorStartDate;
            }
            return row.id > cursorId;
          })
        : 0;
      const sliceFrom = startIndex < 0 ? orderedCandidates.length : startIndex;
      const window = orderedCandidates.slice(sliceFrom, sliceFrom + limit + 1);

      const hasMore = window.length > limit;
      const pageRows = hasMore ? window.slice(0, limit) : window;
      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && last
        ? encodeCursor({
            v: 1,
            k: [last.startDate],
            id: last.id,
          })
        : null;

      const hydrated = await hydrateScheduleItems(
        pageRows.map((row) => row.id),
        currentUserId,
        cascadedDates,
      );
      const data = hydrated.map((entry) => entry.item);

      res.json({
        data,
        pagination: {
          limit,
          hasMore,
          nextCursor,
        },
      });
      return;
    }

    const totalItems = orderedCandidates.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const offset = (page - 1) * limit;

    const pageRows =
      totalItems === 0 || offset >= totalItems
        ? []
        : orderedCandidates.slice(offset, offset + limit);

    const hydrated = await hydrateScheduleItems(
      pageRows.map((row) => row.id),
      currentUserId,
      cascadedDates,
    );
    const data = hydrated.map((entry) => entry.item);

    res.json({
      data,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
    });
  }),
);

const companyScheduleQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SCHEDULE_LIST_MAX_LIMIT)
    .optional()
    .default(SCHEDULE_LIST_DEFAULT_LIMIT),
  cursor: z.string().optional(),
  clientId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  phaseId: z.string().uuid().optional(),
  status: z.enum(["upcoming", "in_progress", "overdue", "complete"]).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

router.get(
  "/schedule",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const parsedQuery = companyScheduleQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new HttpError(
        400,
        "Invalid schedule query.",
        parsedQuery.error.flatten(),
      );
    }

    const { page, limit, cursor: rawCursor, clientId, jobId, assigneeId, phaseId, status, from, to } = parsedQuery.data;
    const isCursorMode = Object.prototype.hasOwnProperty.call(req.query, "cursor");
    const cursorPayload = rawCursor ? decodeCursor(rawCursor) : null;
    const auth = req.auth!;
    const currentUserId = auth.userId;
    const today = new Date().toISOString().split("T")[0];

    const accessibleJobIds = await listAccessibleJobIds(auth);
    if (accessibleJobIds && accessibleJobIds.length === 0) {
      res.json({
        data: [],
        pagination: isCursorMode
          ? { limit, hasMore: false, nextCursor: null }
          : { page, limit, totalItems: 0, totalPages: 1 },
      });
      return;
    }

    const filters: SQL[] = [
      isNull(scheduleItems.deletedAt),
      isNull(jobs.deletedAt),
    ];
    const visibility = buildScheduleListVisibilityFilter(auth);
    if (visibility) filters.push(visibility);
    if (accessibleJobIds) filters.push(inArray(scheduleItems.jobId, accessibleJobIds));
    if (clientId) filters.push(eq(jobs.clientId, clientId));
    if (jobId) filters.push(eq(scheduleItems.jobId, jobId));
    if (phaseId) filters.push(eq(scheduleItems.schedulePhaseId, phaseId));
    if (from) filters.push(sql`${scheduleItems.endDate} >= ${from}`);
    if (to) filters.push(sql`${scheduleItems.startDate} <= ${to}`);
    if (status === "complete") {
      filters.push(eq(scheduleItems.isComplete, true));
    } else if (status === "overdue") {
      filters.push(eq(scheduleItems.isComplete, false));
      filters.push(sql`${scheduleItems.endDate} < ${today}`);
    } else if (status === "in_progress") {
      filters.push(eq(scheduleItems.isComplete, false));
      filters.push(sql`${scheduleItems.startDate} <= ${today}`);
      filters.push(sql`${scheduleItems.endDate} >= ${today}`);
    } else if (status === "upcoming") {
      filters.push(eq(scheduleItems.isComplete, false));
      filters.push(sql`${scheduleItems.startDate} > ${today}`);
    }
    if (assigneeId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM ${scheduleItemAssignees} WHERE ${scheduleItemAssignees.scheduleItemId} = ${scheduleItems.id} AND ${scheduleItemAssignees.userId} = ${assigneeId})`,
      );
    }
    // Defense-in-depth: never expose another user's personal to-do row.
    filters.push(
      or(
        eq(scheduleItems.isPersonalTodo, false),
        isNull(scheduleItems.isPersonalTodo),
        eq(scheduleItems.createdBy, currentUserId),
      ) as SQL,
    );

    const baseWhere = and(...filters);

    // Single SQL per page: fetch the candidate IDs ordered by (startDate, id)
    // joined with jobs (for visibility/client filters). Hydration is batched.
    const candidatesQuery = db
      .select({
        id: scheduleItems.id,
        startDate: scheduleItems.startDate,
        jobId: scheduleItems.jobId,
        jobTitle: jobs.title,
        clientId: jobs.clientId,
      })
      .from(scheduleItems)
      .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
      .where(baseWhere)
      .orderBy(asc(scheduleItems.startDate), asc(scheduleItems.id));

    if (isCursorMode) {
      if (cursorPayload) {
        const cursorStartDate = String(cursorPayload.k[0] ?? "");
        const cursorId = typeof cursorPayload.id === "string" ? cursorPayload.id : "";
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(cursorStartDate) || !uuidPattern.test(cursorId)) {
          throw new HttpError(400, "Invalid cursor.", undefined, "validation");
        }
        const cursorRows = await db
          .select({
            id: scheduleItems.id,
            startDate: scheduleItems.startDate,
            jobId: scheduleItems.jobId,
            jobTitle: jobs.title,
            clientId: jobs.clientId,
          })
          .from(scheduleItems)
          .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
          .where(
            and(
              baseWhere,
              sql`(${scheduleItems.startDate}, ${scheduleItems.id}) > (${cursorStartDate}::date, ${cursorId})`,
            ),
          )
          .orderBy(asc(scheduleItems.startDate), asc(scheduleItems.id))
          .limit(limit + 1);
        const hasMore = cursorRows.length > limit;
        const pageRows = hasMore ? cursorRows.slice(0, limit) : cursorRows;
        const last = pageRows[pageRows.length - 1];
        const nextCursor = hasMore && last
          ? encodeCursor({ v: 1, k: [last.startDate], id: last.id })
          : null;
        const data = await hydrateAndAttachContext(pageRows, currentUserId);
        res.json({
          data,
          pagination: { limit, hasMore, nextCursor },
        });
        return;
      }
      const initialRows = await candidatesQuery.limit(limit + 1);
      const hasMore = initialRows.length > limit;
      const pageRows = hasMore ? initialRows.slice(0, limit) : initialRows;
      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && last
        ? encodeCursor({ v: 1, k: [last.startDate], id: last.id })
        : null;
      const data = await hydrateAndAttachContext(pageRows, currentUserId);
      res.json({
        data,
        pagination: { limit, hasMore, nextCursor },
      });
      return;
    }

    const offset = (page - 1) * limit;
    const [[totalRow], pageRows] = await Promise.all([
      db
        .select({ total: count() })
        .from(scheduleItems)
        .leftJoin(jobs, eq(scheduleItems.jobId, jobs.id))
        .where(baseWhere),
      candidatesQuery.limit(limit).offset(offset),
    ]);
    const totalItems = Number(totalRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const data = await hydrateAndAttachContext(pageRows, currentUserId);
    res.json({
      data,
      pagination: { page, limit, totalItems, totalPages },
    });
  }),
);

async function hydrateAndAttachContext(
  pageRows: Array<{ id: string; jobId: string | null; jobTitle: string | null; clientId: string | null }>,
  currentUserId: string,
) {
  if (pageRows.length === 0) return [];
  const hydrated = await hydrateScheduleItems(
    pageRows.map((row) => row.id),
    currentUserId,
  );
  const contextById = new Map(pageRows.map((row) => [row.id, row]));
  const clientIds = Array.from(
    new Set(pageRows.map((row) => row.clientId).filter((id): id is string => !!id)),
  );
  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const clientRows = await db
      .select({ id: clients.id, name: clients.companyName })
      .from(clients)
      .where(inArray(clients.id, clientIds));
    for (const row of clientRows) {
      clientNameById.set(row.id, row.name);
    }
  }
  return hydrated.map((entry) => {
    const ctx = contextById.get(entry.item.id);
    return {
      ...entry.item,
      jobTitle: ctx?.jobTitle ?? null,
      clientId: ctx?.clientId ?? null,
      clientName: ctx?.clientId ? clientNameById.get(ctx.clientId) ?? null : null,
    };
  });
}

router.post(
  "/jobs/:jobId/schedule",
  asyncHandler(async (req, res) => {
    const body = schedulePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    const exceptions = await getWorkdayExceptionsForJob(jobId);
    await assertPredecessorsBelongToJob(
      jobId,
      body.data.predecessors.map((predecessor) => predecessor.scheduleItemId),
    );
    await assertPhaseBelongsToJob(jobId, body.data.phaseId);
    let item: typeof scheduleItems.$inferSelect;
    const predecessorIds = body.data.predecessors.map((predecessor) => predecessor.scheduleItemId);
    const predecessorItems = predecessorIds.length > 0
      ? await db
          .select({
            id: scheduleItems.id,
            startDate: scheduleItems.startDate,
            endDate: scheduleItems.endDate,
          })
          .from(scheduleItems)
          .where(and(inArray(scheduleItems.id, predecessorIds), isNull(scheduleItems.deletedAt)))
      : [];
    const normalizedPayload = applyPredecessorDates(
      {
        ...body.data,
        endDate: null,
      },
      predecessorItems,
      exceptions,
    );

    item = await db.transaction(async (tx) => {
      await ensureTagSettings(jobId, normalizedPayload.tags, tx);

      const [createdItem] = await tx
        .insert(scheduleItems)
        .values({
          jobId,
          schedulePhaseId: normalizedPayload.phaseId,
          title: normalizedPayload.title,
          displayColor: normalizedPayload.displayColor ?? "#2563eb",
          startDate: normalizedPayload.startDate,
          workDays: normalizedPayload.workDays,
          endDate: normalizedPayload.endDate ?? calculateBusinessEndDate(normalizedPayload.startDate, normalizedPayload.workDays, exceptions),
          isHourly: normalizedPayload.isHourly,
          startTime: normalizeTimeValue(normalizedPayload.startTime),
          endTime: normalizeTimeValue(normalizedPayload.endTime),
          progress: normalizedPayload.progress,
          reminder: normalizedPayload.reminder,
          showOnGantt: normalizedPayload.showOnGantt,
          visibleToEstimators: normalizedPayload.visibleToEstimators,
          visibleToInstallers: normalizedPayload.visibleToInstallers,
          visibleToOfficeStaff: normalizedPayload.visibleToOfficeStaff,
          isComplete: normalizedPayload.isComplete,
          isPersonalTodo: normalizedPayload.isPersonalTodo,
          notes: encodeScheduleMeta({
            notes: normalizedPayload.notes,
            tags: normalizeUniqueStrings(normalizedPayload.tags),
            predecessors: normalizedPayload.predecessors,
          }),
          createdBy: req.auth!.userId,
        })
        .returning();

      await syncAssignees(createdItem.id, normalizedPayload.assigneeIds, tx);
      await syncPredecessors(createdItem.id, normalizedPayload.predecessors, tx);

      // Cascade persistence and auto-complete sweep run inside the same
      // transaction as the user's insert, so a failure in either step
      // rolls back the whole write instead of leaving a half-applied
      // schedule on disk.
      await synchronizeJobSchedule(jobId, tx);

      return createdItem;
    });

    if (normalizedPayload.notifyUserIds.length > 0) {
      const recipients = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.id, normalizedPayload.notifyUserIds));

      await writeActivity({
        entityType: "schedule_item_notification",
        entityId: item.id,
        action: "queued",
        userId: req.auth!.userId,
        jobId,
        description: `Queued schedule item notifications for ${item.title}`,
        extra: {
          scheduleItemId: item.id,
          notifyUserIds: recipients.map((recipient) => recipient.id),
          recipients,
        },
      });
    }

    const hydrated = await hydrateScheduleItem(item.id, req.auth!.userId);
    await writeActivity({
      entityType: "schedule_item",
      entityId: item.id,
      action: "created",
      userId: req.auth!.userId,
      jobId,
      description: `Created schedule item ${item.title}`,
      extra: {
        scheduleItemId: item.id,
        changes: buildScheduleHistoryChanges(null, hydrated.item),
        current: buildScheduleHistorySnapshot(hydrated.item),
      },
    });
    res.status(201).json(hydrated);
  }),
);

router.get(
  "/schedule-items/:id",
  asyncHandler(async (req, res) => {
    const itemId = getParam(req.params.id, "schedule item id");
    const hydrated = await hydrateScheduleItem(itemId, req.auth!.userId);

    if (hydrated.item.isPersonalTodo && hydrated.item.createdBy !== req.auth!.userId) {
      throw new HttpError(403, "You do not have access to that schedule item.");
    }

    res.json(hydrated);
  }),
);

// Narrow self-service endpoint that lets an assigned crew member flip
// just the completion-state fields on a schedule item from the field —
// no dates, no predecessors, no visibility flags. Admins and PMs that
// already have manage rights on the item can also call this; in their
// case the route is just a smaller-payload alternative to the full PUT.
router.post(
  "/schedule-items/:id/complete",
  asyncHandler(async (req, res) => {
    const body = scheduleCompletionPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(
        400,
        "Invalid schedule item completion payload.",
        body.error.flatten(),
      );
    }

    const itemId = getParam(req.params.id, "schedule item id");
    const existing = await getScheduleItemOrThrow(itemId);

    if (!existing.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    if (existing.isPersonalTodo && existing.createdBy !== req.auth!.userId) {
      throw new HttpError(403, "You do not have access to that schedule item.");
    }

    // Re-check write permission narrowly: caller must either be a manager
    // of the item (admin / PM-on-job) OR be currently assigned to it.
    // The route-level middleware only confirmed view access.
    let canManage = false;
    try {
      await assertCanManageScheduleItem(req.auth!, itemId);
      canManage = true;
    } catch (err) {
      if (!(err instanceof HttpError) || err.statusCode !== 403) {
        throw err;
      }
    }

    if (!canManage) {
      const [assignment] = await db
        .select({ userId: scheduleItemAssignees.userId })
        .from(scheduleItemAssignees)
        .where(
          and(
            eq(scheduleItemAssignees.scheduleItemId, itemId),
            eq(scheduleItemAssignees.userId, req.auth!.userId),
          ),
        )
        .limit(1);

      if (!assignment) {
        throw new HttpError(
          403,
          "Only assigned users can mark this schedule item complete.",
        );
      }
    }

    const existingHydrated = await hydrateScheduleItem(itemId, req.auth!.userId);

    const isComplete = body.data.isComplete;
    // If the caller didn't pass an explicit progress value, derive a
    // sensible one from the new completion state: 100 when flipping to
    // complete, otherwise leave the existing progress alone (or pull it
    // back from 100 to 99 when un-completing so the row stops looking
    // "done" in progress views).
    const previousProgress = existing.progress ?? 0;
    let nextProgress: number;
    if (typeof body.data.progress === "number") {
      nextProgress = body.data.progress;
    } else if (isComplete) {
      nextProgress = 100;
    } else {
      nextProgress = previousProgress >= 100 ? 99 : previousProgress;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(scheduleItems)
        .set({
          isComplete,
          progress: nextProgress,
          updatedAt: new Date(),
        })
        .where(eq(scheduleItems.id, itemId));

      // Same atomicity guarantee as the full PUT — keep the cascade in
      // sync with the persisted row inside one transaction.
      await synchronizeJobSchedule(existing.jobId!, tx);
    });

    const hydrated = await hydrateScheduleItem(itemId, req.auth!.userId);
    const changes = buildScheduleHistoryChanges(existingHydrated.item, hydrated.item);
    const markedComplete =
      !existingHydrated.item.isComplete && hydrated.item.isComplete;

    // writeActivity also fires emitRealtimeEvent("activity:created", ...),
    // which is what the PM/admin views listen to for live updates.
    await writeActivity({
      entityType: "schedule_item",
      entityId: itemId,
      action: markedComplete ? "completed" : "updated",
      userId: req.auth!.userId,
      jobId: existing.jobId,
      description: markedComplete
        ? `Marked schedule item ${existing.title} complete`
        : `Updated schedule item ${existing.title}`,
      extra: {
        scheduleItemId: itemId,
        changes,
        previous: buildScheduleHistorySnapshot(existingHydrated.item),
        current: buildScheduleHistorySnapshot(hydrated.item),
      },
    });

    res.json(hydrated);
  }),
);

router.put(
  "/schedule-items/:id",
  asyncHandler(async (req, res) => {
    const body = schedulePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item payload.", body.error.flatten());
    }

    const itemId = getParam(req.params.id, "schedule item id");

    if (body.data.predecessors.some((predecessor) => predecessor.scheduleItemId === itemId)) {
      throw new HttpError(400, "A schedule item cannot be its own predecessor.");
    }

    const existing = await getScheduleItemOrThrow(itemId);
    const existingHydrated = await hydrateScheduleItem(itemId, req.auth!.userId);

    if (existingHydrated.item.isPersonalTodo && existingHydrated.item.createdBy !== req.auth!.userId) {
      throw new HttpError(403, "You do not have access to that schedule item.");
    }

    if (!existing.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const exceptions = await getWorkdayExceptionsForJob(existing.jobId);
    await assertPredecessorsBelongToJob(
      existing.jobId,
      body.data.predecessors.map((predecessor) => predecessor.scheduleItemId),
    );
    await assertPhaseBelongsToJob(existing.jobId, body.data.phaseId);
    const predecessorIds = body.data.predecessors.map((predecessor) => predecessor.scheduleItemId);
    const predecessorItems = predecessorIds.length > 0
      ? await db
          .select({
            id: scheduleItems.id,
            startDate: scheduleItems.startDate,
            endDate: scheduleItems.endDate,
          })
          .from(scheduleItems)
          .where(and(inArray(scheduleItems.id, predecessorIds), isNull(scheduleItems.deletedAt)))
      : [];
    const normalizedPayload = applyPredecessorDates(
      {
        ...body.data,
        endDate: null,
      },
      predecessorItems,
      exceptions,
    );

    await db.transaction(async (tx) => {
      await ensureTagSettings(existing.jobId, normalizedPayload.tags, tx);

      await tx
        .update(scheduleItems)
        .set({
          schedulePhaseId: normalizedPayload.phaseId,
          title: normalizedPayload.title,
          displayColor: normalizedPayload.displayColor ?? "#2563eb",
          startDate: normalizedPayload.startDate,
          workDays: normalizedPayload.workDays,
          endDate: normalizedPayload.endDate ?? calculateBusinessEndDate(normalizedPayload.startDate, normalizedPayload.workDays, exceptions),
          isHourly: normalizedPayload.isHourly,
          startTime: normalizeTimeValue(normalizedPayload.startTime),
          endTime: normalizeTimeValue(normalizedPayload.endTime),
          progress: normalizedPayload.progress,
          reminder: normalizedPayload.reminder,
          showOnGantt: normalizedPayload.showOnGantt,
          visibleToEstimators: normalizedPayload.visibleToEstimators,
          visibleToInstallers: normalizedPayload.visibleToInstallers,
          visibleToOfficeStaff: normalizedPayload.visibleToOfficeStaff,
          isComplete: normalizedPayload.isComplete,
          notes: encodeScheduleMeta({
            notes: normalizedPayload.notes,
            tags: normalizeUniqueStrings(normalizedPayload.tags),
            predecessors: normalizedPayload.predecessors,
          }),
          updatedAt: new Date(),
        })
        .where(eq(scheduleItems.id, itemId));

      await syncAssignees(itemId, normalizedPayload.assigneeIds, tx);
      await syncPredecessors(itemId, normalizedPayload.predecessors, tx);

      // Same atomicity guarantee as the POST handler — cascade
      // persistence shares this transaction with the user's update.
      await synchronizeJobSchedule(existing.jobId, tx);
    });

    if (normalizedPayload.notifyUserIds.length > 0) {
      const recipients = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.id, normalizedPayload.notifyUserIds));

      await writeActivity({
        entityType: "schedule_item_notification",
        entityId: itemId,
        action: "queued",
        userId: req.auth!.userId,
        jobId: existing.jobId,
        description: `Queued schedule item notifications for ${body.data.title}`,
        extra: {
          scheduleItemId: itemId,
          notifyUserIds: recipients.map((recipient) => recipient.id),
          recipients,
        },
      });
    }

    const hydrated = await hydrateScheduleItem(itemId, req.auth!.userId);
    const changes = buildScheduleHistoryChanges(existingHydrated.item, hydrated.item);
    const markedComplete = !existingHydrated.item.isComplete && hydrated.item.isComplete;
    await writeActivity({
      entityType: "schedule_item",
      entityId: itemId,
      action: markedComplete ? "completed" : "updated",
      userId: req.auth!.userId,
      jobId: existing.jobId,
      description: markedComplete
        ? `Marked schedule item ${body.data.title} complete`
        : `Updated schedule item ${body.data.title}`,
      extra: {
        scheduleItemId: itemId,
        changes,
        previous: buildScheduleHistorySnapshot(existingHydrated.item),
        current: buildScheduleHistorySnapshot(hydrated.item),
      },
    });
    res.json(hydrated);
  }),
);

router.post(
  "/schedule-items/:id/todos",
  asyncHandler(async (req, res) => {
    const body = scheduleTodoPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item to-do payload.", body.error.flatten());
    }

    const itemId = getParam(req.params.id, "schedule item id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const [todo] = await db
      .insert(scheduleItemTodos)
      .values({
        scheduleItemId: itemId,
        title: body.data.title ?? item.title,
        createdBy: req.auth!.userId,
      })
      .returning({
        id: scheduleItemTodos.id,
        title: scheduleItemTodos.title,
        isComplete: scheduleItemTodos.isComplete,
        createdAt: scheduleItemTodos.createdAt,
        updatedAt: scheduleItemTodos.updatedAt,
        createdBy: scheduleItemTodos.createdBy,
      });

    const [author] = await db
      .select({
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.id, req.auth!.userId))
      .limit(1);

    await writeActivity({
      entityType: "schedule_item_todo",
      entityId: todo.id,
      action: "created",
      userId: req.auth!.userId,
      jobId: item.jobId,
      description: `Created linked to-do ${todo.title} for schedule item ${item.title}`,
      extra: {
        scheduleItemId: itemId,
        todoId: todo.id,
      },
    });

    res.status(201).json({
      todo: {
        ...todo,
        createdByName: author?.fullName ?? null,
      },
    });
  }),
);

router.put(
  "/schedule-items/:id/todos/:todoId",
  asyncHandler(async (req, res) => {
    const body = scheduleTodoUpdatePayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item to-do payload.", body.error.flatten());
    }

    const itemId = getParam(req.params.id, "schedule item id");
    const todoId = getParam(req.params.todoId, "to-do id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const [existing] = await db
      .select()
      .from(scheduleItemTodos)
      .where(and(eq(scheduleItemTodos.id, todoId), eq(scheduleItemTodos.scheduleItemId, itemId)))
      .limit(1);

    if (!existing) {
      throw new HttpError(404, "Linked to-do not found.");
    }

    const [todo] = await db
      .update(scheduleItemTodos)
      .set({
        title: body.data.title ?? existing.title,
        isComplete: body.data.isComplete ?? existing.isComplete,
        updatedAt: new Date(),
      })
      .where(eq(scheduleItemTodos.id, todoId))
      .returning({
        id: scheduleItemTodos.id,
        title: scheduleItemTodos.title,
        isComplete: scheduleItemTodos.isComplete,
        createdAt: scheduleItemTodos.createdAt,
        updatedAt: scheduleItemTodos.updatedAt,
        createdBy: scheduleItemTodos.createdBy,
      });

    const [author] = todo.createdBy
      ? await db
          .select({
            fullName: users.fullName,
          })
          .from(users)
          .where(eq(users.id, todo.createdBy))
          .limit(1)
      : [];

    res.json({
      todo: {
        ...todo,
        createdByName: author?.fullName ?? null,
      },
    });
  }),
);

router.delete(
  "/schedule-items/:id/todos/:todoId",
  asyncHandler(async (req, res) => {
    const itemId = getParam(req.params.id, "schedule item id");
    const todoId = getParam(req.params.todoId, "to-do id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const [todo] = await db
      .select({
        id: scheduleItemTodos.id,
        title: scheduleItemTodos.title,
      })
      .from(scheduleItemTodos)
      .where(and(eq(scheduleItemTodos.id, todoId), eq(scheduleItemTodos.scheduleItemId, itemId)))
      .limit(1);

    if (!todo) {
      throw new HttpError(404, "Linked to-do not found.");
    }

    await db.delete(scheduleItemTodos).where(eq(scheduleItemTodos.id, todoId));

    await writeActivity({
      entityType: "schedule_item_todo",
      entityId: todo.id,
      action: "deleted",
      userId: req.auth!.userId,
      jobId: item.jobId,
      description: `Deleted linked to-do ${todo.title} from schedule item ${item.title}`,
      extra: {
        scheduleItemId: itemId,
        todoId,
      },
    });

    res.json({ success: true });
  }),
);

router.post(
  "/schedule-items/:id/notes",
  asyncHandler(async (req, res) => {
    const body = scheduleNotePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item note payload.", body.error.flatten());
    }

    const itemId = getParam(req.params.id, "schedule item id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const [note] = await db
      .insert(scheduleItemNotes)
      .values({
        scheduleItemId: itemId,
        note: body.data.note,
        createdBy: req.auth!.userId,
      })
      .returning({
        id: scheduleItemNotes.id,
        note: scheduleItemNotes.note,
        createdAt: scheduleItemNotes.createdAt,
      });

    const [author] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, req.auth!.userId))
      .limit(1);

    await writeActivity({
      entityType: "schedule_item_note",
      entityId: note.id,
      action: "created",
      userId: req.auth!.userId,
      jobId: item.jobId,
      description: `Added a note to schedule item ${item.title}`,
      extra: {
        scheduleItemId: itemId,
        noteId: note.id,
      },
    });

    res.status(201).json({
      note: {
        ...note,
        authorId: author?.id ?? null,
        authorName: author?.fullName ?? null,
        authorAvatarUrl: author?.avatarUrl ?? null,
        isLegacy: false,
      },
    });
  }),
);

router.post(
  "/schedule-items/:id/attachments",
  requireScheduleItemRouteAccess,
  uploadRateLimit,
  uploadArray("files", 20),
  asyncHandler(async (req, res) => {
    const itemId = getParam(req.params.id, "schedule item id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const attachmentFolder = await ensureScheduleAttachmentFolder(itemId, item.jobId);
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (uploadedFiles.length === 0) {
      throw new HttpError(400, "At least one attachment is required.");
    }

    const attachments = [];

    for (const uploadedFile of uploadedFiles) {
      validateUploadForMediaType("document", uploadedFile);

      const storedFileName = buildStoredFileName(uploadedFile.originalname);
      const uploadPath = buildUploadPath({
        jobId: item.jobId,
        mediaType: "document",
        storedFileName,
      });

      try {
        if (uploadedFile.path) {
          await writeUploadedFromPath(uploadPath.fileUrl, uploadedFile.path, {
            contentType: uploadedFile.mimetype,
          });
        } else {
          await writeUploadedBuffer(uploadPath.fileUrl, uploadedFile.buffer, {
            contentType: uploadedFile.mimetype,
          });
        }
      } finally {
        await cleanupTempUpload(uploadedFile);
      }

      let file: typeof files.$inferSelect;
      let attachment: { id: string };

      try {
        ({ file, attachment } = await db.transaction(async (tx) => {
          const [createdFile] = await tx
            .insert(files)
            .values({
              folderId: attachmentFolder.id,
              filename: storedFileName,
              originalName: uploadedFile.originalname,
              fileUrl: uploadPath.fileUrl,
              fileSize: uploadedFile.size,
              mimeType: uploadedFile.mimetype,
              uploadedBy: req.auth!.userId,
            })
            .returning();

          const [createdAttachment] = await tx
            .insert(scheduleItemAttachments)
            .values({
              scheduleItemId: itemId,
              fileId: createdFile.id,
            })
            .returning({
              id: scheduleItemAttachments.id,
            });

          return {
            file: createdFile,
            attachment: createdAttachment,
          };
        }));
      } catch (error) {
        await deletePhysicalFileBestEffort(uploadPath.fileUrl, "schedule-item-attachment-upload:rollback");
        throw error;
      }

      await writeActivity({
        entityType: "schedule_item_attachment",
        entityId: attachment.id,
        action: "uploaded",
        userId: req.auth!.userId,
        jobId: item.jobId,
        description: `Uploaded ${file.originalName} to schedule item ${item.title}`,
        extra: {
          scheduleItemId: itemId,
          fileId: file.id,
        },
      });

      attachments.push({
        id: attachment.id,
        fileId: file.id,
        filename: file.filename,
        originalName: file.originalName,
        fileUrl: file.fileUrl,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
        icon: fileIconKind(file.mimeType),
        storageStatus: "ok" as const,
      });
    }

    res.status(201).json({ attachments });
  }),
);

router.post(
  "/schedule-items/:id/attachments/new-doc/preview",
  requireScheduleItemRouteAccess,
  asyncHandler(async (req, res) => {
    const body = createDocPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item document payload.", body.error.flatten());
    }

    const itemId = getParam(req.params.id, "schedule item id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const [hydrated, jobRecord, creatorRecord] = await Promise.all([
      hydrateScheduleItem(itemId, req.auth!.userId),
      db
        .select({ title: jobs.title })
        .from(jobs)
        .where(eq(jobs.id, item.jobId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, req.auth!.userId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const defaultTitle = `${item.title} Notes`;
    const requestedTitle = body.data.title?.trim() || defaultTitle;
    const documentContents = buildScheduleItemDocBody({
      item: hydrated.item,
      jobTitle: jobRecord?.title ?? null,
      createdByName: creatorRecord?.fullName ?? null,
      createdByEmail: req.auth!.email,
      createdAt: new Date(),
    });

    res.json({
      preview: {
        title: requestedTitle,
        defaultTitle,
        body: documentContents,
      },
    });
  }),
);

router.post(
  "/schedule-items/:id/attachments/new-doc",
  requireScheduleItemRouteAccess,
  asyncHandler(async (req, res) => {
    const body = createDocPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item document payload.", body.error.flatten());
    }

    const itemId = getParam(req.params.id, "schedule item id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const attachmentFolder = await ensureScheduleAttachmentFolder(itemId, item.jobId);
    const requestedTitle = body.data.title?.trim() || `${item.title} Notes`;
    const originalName = requestedTitle.toLowerCase().endsWith(".txt")
      ? requestedTitle
      : `${requestedTitle}.txt`;
    const storedFileName = buildStoredFileName(originalName);
    const uploadPath = buildUploadPath({
      jobId: item.jobId,
      mediaType: "document",
      storedFileName,
    });
    const [hydrated, jobRecord, creatorRecord] = await Promise.all([
      hydrateScheduleItem(itemId, req.auth!.userId),
      db
        .select({ title: jobs.title })
        .from(jobs)
        .where(eq(jobs.id, item.jobId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, req.auth!.userId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const documentCreatedAt = new Date();
    const documentContents = buildScheduleItemDocBody({
      item: hydrated.item,
      jobTitle: jobRecord?.title ?? null,
      createdByName: creatorRecord?.fullName ?? null,
      createdByEmail: req.auth!.email,
      createdAt: documentCreatedAt,
    });

    await writeUploadedBuffer(uploadPath.fileUrl, Buffer.from(documentContents, "utf8"), {
      contentType: "text/plain; charset=utf-8",
    });

    let file: typeof files.$inferSelect;
    let attachment: { id: string };

    try {
      ({ file, attachment } = await db.transaction(async (tx) => {
        const [createdFile] = await tx
          .insert(files)
          .values({
            folderId: attachmentFolder.id,
            filename: storedFileName,
            originalName,
            fileUrl: uploadPath.fileUrl,
            fileSize: Buffer.byteLength(documentContents, "utf8"),
            mimeType: "text/plain",
            uploadedBy: req.auth!.userId,
          })
          .returning();

        const [createdAttachment] = await tx
          .insert(scheduleItemAttachments)
          .values({
            scheduleItemId: itemId,
            fileId: createdFile.id,
          })
          .returning({
            id: scheduleItemAttachments.id,
          });

        return {
          file: createdFile,
          attachment: createdAttachment,
        };
      }));
    } catch (error) {
      await deletePhysicalFileBestEffort(uploadPath.fileUrl, "schedule-item-attachment-doc:rollback");
      throw error;
    }

    await writeActivity({
      entityType: "schedule_item_attachment",
      entityId: attachment.id,
      action: "created",
      userId: req.auth!.userId,
      jobId: item.jobId,
      description: `Created ${file.originalName} for schedule item ${item.title}`,
      extra: {
        scheduleItemId: itemId,
        fileId: file.id,
      },
    });

    res.status(201).json({
      attachment: {
        id: attachment.id,
        fileId: file.id,
        filename: file.filename,
        originalName: file.originalName,
        fileUrl: file.fileUrl,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
        icon: fileIconKind(file.mimeType),
        storageStatus: "ok" as const,
      },
    });
  }),
);

router.delete(
  "/schedule-items/:id/attachments/:attachmentId",
  requireScheduleItemRouteAccess,
  asyncHandler(async (req, res) => {
    const itemId = getParam(req.params.id, "schedule item id");
    const attachmentId = getParam(req.params.attachmentId, "attachment id");
    const item = await getScheduleItemOrThrow(itemId);

    if (!item.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    const [attachment] = await db
      .select({
        id: scheduleItemAttachments.id,
        fileId: files.id,
        originalName: files.originalName,
        fileUrl: files.fileUrl,
      })
      .from(scheduleItemAttachments)
      .innerJoin(files, eq(scheduleItemAttachments.fileId, files.id))
      .where(
        and(
          eq(scheduleItemAttachments.id, attachmentId),
          eq(scheduleItemAttachments.scheduleItemId, itemId),
        ),
      )
      .limit(1);

    if (!attachment) {
      throw new HttpError(404, "Attachment not found.");
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(scheduleItemAttachments)
        .where(eq(scheduleItemAttachments.id, attachmentId));
      await tx.delete(files).where(eq(files.id, attachment.fileId));
    });

    try {
      await maybeDeletePhysicalFile(attachment.fileUrl, attachment.fileId);
    } catch (error) {
      logger.error(
        {
          err: error,
          attachmentId,
          fileId: attachment.fileId,
          fileUrl: attachment.fileUrl,
        },
        "Failed to delete schedule attachment physical file",
      );
    }

    await writeActivity({
      entityType: "schedule_item_attachment",
      entityId: attachmentId,
      action: "deleted",
      userId: req.auth!.userId,
      jobId: item.jobId,
      description: `Deleted ${attachment.originalName} from schedule item ${item.title}`,
      extra: {
        scheduleItemId: itemId,
        fileId: attachment.fileId,
      },
    });

    res.json({ success: true });
  }),
);

router.delete(
  "/schedule-items/:id",
  asyncHandler(async (req, res) => {
    const itemId = getParam(req.params.id, "schedule item id");
    const hydrated = await hydrateScheduleItem(itemId, req.auth!.userId);
    const existing = await getScheduleItemOrThrow(itemId);

    if (hydrated.item.isPersonalTodo && hydrated.item.createdBy !== req.auth!.userId) {
      throw new HttpError(403, "You do not have access to that schedule item.");
    }

    if (!existing.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    // Soft-delete + cascade in a single transaction. Removing an item
    // changes the predecessor graph for the rest of the job, so a failed
    // cascade must roll back the soft delete (otherwise downstream items'
    // persisted dates go stale until the next unrelated write).
    await db.transaction(async (tx) => {
      await tx
        .update(scheduleItems)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(scheduleItems.id, itemId));

      await synchronizeJobSchedule(existing.jobId, tx);
    });

    await writeActivity({
      entityType: "schedule_item",
      entityId: itemId,
      action: "deleted",
      userId: req.auth!.userId,
      jobId: existing.jobId,
      description: `Deleted schedule item ${existing.title}`,
      extra: {
        scheduleItemId: itemId,
        previous: buildScheduleHistorySnapshot(hydrated.item),
      },
    });

    res.json({ success: true });
  }),
);

export default router;
