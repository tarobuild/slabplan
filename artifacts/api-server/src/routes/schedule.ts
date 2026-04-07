import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  jobs,
  reminderOptions,
  scheduleItemAssignees,
  scheduleItems,
  users,
} from "@workspace/db/schema";
import { writeActivity } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

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
  })
  .superRefine((value, ctx) => {
    if (value.isHourly && (!value.startTime || !value.endTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hourly items require both a start and end time.",
        path: ["startTime"],
      });
    }
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

function normalizeTimeValue(value: string | null) {
  if (!value) {
    return null;
  }

  return value.length === 5 ? `${value}:00` : value;
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function calculateBusinessEndDate(startDate: string, workDays: number) {
  const current = new Date(`${startDate}T00:00:00.000Z`);

  while (isWeekend(current)) {
    current.setUTCDate(current.getUTCDate() + 1);
  }

  let remaining = Math.max(workDays, 1);

  while (remaining > 1) {
    current.setUTCDate(current.getUTCDate() + 1);

    if (!isWeekend(current)) {
      remaining -= 1;
    }
  }

  return current.toISOString().slice(0, 10);
}

function encodeScheduleMeta(meta: ScheduleMeta) {
  if (meta.tags.length === 0 && meta.predecessors.length === 0) {
    return meta.notes;
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
}) {
  const progress = item.progress ?? 0;

  if (progress >= 100) {
    return "completed";
  }

  const today = new Date().toISOString().slice(0, 10);

  if (item.endDate < today) {
    return "overdue";
  }

  if (item.startDate > today) {
    return "upcoming";
  }

  return "in_progress";
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

async function syncAssignees(scheduleItemId: string, assigneeIds: string[]) {
  await db
    .delete(scheduleItemAssignees)
    .where(eq(scheduleItemAssignees.scheduleItemId, scheduleItemId));

  const uniqueUserIds = Array.from(new Set(assigneeIds));

  if (uniqueUserIds.length > 0) {
    await db.insert(scheduleItemAssignees).values(
      uniqueUserIds.map((userId) => ({
        scheduleItemId,
        userId,
      })),
    );
  }
}

async function hydrateScheduleItem(itemId: string) {
  const [row] = await db
    .select({
      id: scheduleItems.id,
      jobId: scheduleItems.jobId,
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
      notes: scheduleItems.notes,
      createdBy: scheduleItems.createdBy,
      createdAt: scheduleItems.createdAt,
      updatedAt: scheduleItems.updatedAt,
      deletedAt: scheduleItems.deletedAt,
      createdByName: users.fullName,
    })
    .from(scheduleItems)
    .leftJoin(users, eq(scheduleItems.createdBy, users.id))
    .where(and(eq(scheduleItems.id, itemId), isNull(scheduleItems.deletedAt)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "Schedule item not found.");
  }

  const meta = decodeScheduleMeta(row.notes);

  const [assignees, predecessorRows] = await Promise.all([
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(scheduleItemAssignees)
      .innerJoin(users, eq(scheduleItemAssignees.userId, users.id))
      .where(eq(scheduleItemAssignees.scheduleItemId, itemId))
      .orderBy(asc(users.fullName)),
    meta.predecessors.length > 0
      ? db
          .select({
            id: scheduleItems.id,
            title: scheduleItems.title,
          })
          .from(scheduleItems)
          .where(inArray(
            scheduleItems.id,
            meta.predecessors.map((predecessor) => predecessor.scheduleItemId),
          ))
      : Promise.resolve([]),
  ]);

  const predecessorMap = new Map(
    predecessorRows.map((predecessor) => [predecessor.id, predecessor.title]),
  );

  return {
    item: {
      ...row,
      notes: meta.notes,
      tags: meta.tags,
      assigneeIds: assignees.map((assignee) => assignee.id),
      assignees,
      predecessors: meta.predecessors.map((predecessor) => ({
        ...predecessor,
        title: predecessorMap.get(predecessor.scheduleItemId) ?? "Unknown task",
      })),
      status: deriveScheduleStatus({
        startDate: row.startDate,
        endDate: row.endDate,
        progress: row.progress,
      }),
    },
  };
}

router.get(
  "/jobs/:jobId/schedule",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const rows = await db
      .select({
        id: scheduleItems.id,
      })
      .from(scheduleItems)
      .where(and(eq(scheduleItems.jobId, jobId), isNull(scheduleItems.deletedAt)))
      .orderBy(
        asc(scheduleItems.startDate),
        asc(scheduleItems.title),
        desc(scheduleItems.createdAt),
      );

    const hydrated = await Promise.all(rows.map((row) => hydrateScheduleItem(row.id)));

    res.json({
      items: hydrated.map((entry) => entry.item),
    });
  }),
);

router.post(
  "/jobs/:jobId/schedule",
  asyncHandler(async (req, res) => {
    const body = schedulePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid schedule item payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);
    await assertPredecessorsBelongToJob(
      jobId,
      body.data.predecessors.map((predecessor) => predecessor.scheduleItemId),
    );

    const [item] = await db
      .insert(scheduleItems)
      .values({
        jobId,
        title: body.data.title,
        displayColor: body.data.displayColor ?? "#2563EB",
        startDate: body.data.startDate,
        workDays: body.data.workDays,
        endDate:
          body.data.endDate ?? calculateBusinessEndDate(body.data.startDate, body.data.workDays),
        isHourly: body.data.isHourly,
        startTime: normalizeTimeValue(body.data.startTime),
        endTime: normalizeTimeValue(body.data.endTime),
        progress: body.data.progress,
        reminder: body.data.reminder,
        notes: encodeScheduleMeta({
          notes: body.data.notes,
          tags: normalizeUniqueStrings(body.data.tags),
          predecessors: body.data.predecessors,
        }),
        createdBy: req.auth.userId,
      })
      .returning();

    await syncAssignees(item.id, body.data.assigneeIds);

    await writeActivity({
      entityType: "schedule_item",
      entityId: item.id,
      action: "created",
      userId: req.auth.userId,
      jobId,
      description: `Created schedule item ${item.title}`,
      extra: {
        scheduleItemId: item.id,
      },
    });

    const hydrated = await hydrateScheduleItem(item.id);
    res.status(201).json(hydrated);
  }),
);

router.get(
  "/schedule-items/:id",
  asyncHandler(async (req, res) => {
    const itemId = getParam(req.params.id, "schedule item id");
    const hydrated = await hydrateScheduleItem(itemId);
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
    const existing = await getScheduleItemOrThrow(itemId);

    if (!existing.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    await assertPredecessorsBelongToJob(
      existing.jobId,
      body.data.predecessors.map((predecessor) => predecessor.scheduleItemId),
    );

    await db
      .update(scheduleItems)
      .set({
        title: body.data.title,
        displayColor: body.data.displayColor ?? "#2563EB",
        startDate: body.data.startDate,
        workDays: body.data.workDays,
        endDate:
          body.data.endDate ?? calculateBusinessEndDate(body.data.startDate, body.data.workDays),
        isHourly: body.data.isHourly,
        startTime: normalizeTimeValue(body.data.startTime),
        endTime: normalizeTimeValue(body.data.endTime),
        progress: body.data.progress,
        reminder: body.data.reminder,
        notes: encodeScheduleMeta({
          notes: body.data.notes,
          tags: normalizeUniqueStrings(body.data.tags),
          predecessors: body.data.predecessors,
        }),
        updatedAt: new Date(),
      })
      .where(eq(scheduleItems.id, itemId));

    await syncAssignees(itemId, body.data.assigneeIds);

    await writeActivity({
      entityType: "schedule_item",
      entityId: itemId,
      action: "updated",
      userId: req.auth.userId,
      jobId: existing.jobId,
      description: `Updated schedule item ${body.data.title}`,
      extra: {
        scheduleItemId: itemId,
      },
    });

    const hydrated = await hydrateScheduleItem(itemId);
    res.json(hydrated);
  }),
);

router.delete(
  "/schedule-items/:id",
  asyncHandler(async (req, res) => {
    const itemId = getParam(req.params.id, "schedule item id");
    const existing = await getScheduleItemOrThrow(itemId);

    if (!existing.jobId) {
      throw new HttpError(400, "Schedule item is missing a job.");
    }

    await db
      .update(scheduleItems)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scheduleItems.id, itemId));

    await writeActivity({
      entityType: "schedule_item",
      entityId: itemId,
      action: "deleted",
      userId: req.auth.userId,
      jobId: existing.jobId,
      description: `Deleted schedule item ${existing.title}`,
      extra: {
        scheduleItemId: itemId,
      },
    });

    res.json({ success: true });
  }),
);

export default router;
