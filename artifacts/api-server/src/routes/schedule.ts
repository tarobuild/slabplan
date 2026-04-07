import multer from "multer";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  files,
  folders,
  jobs,
  reminderOptions,
  scheduleItemAssignees,
  scheduleItemAttachments,
  scheduleItemNotes,
  scheduleItemTodos,
  scheduleItems,
  schedulePhases,
  scheduleTagSettings,
  users,
} from "@workspace/db/schema";
import { writeActivity } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import {
  buildStoredFileName,
  buildUploadPath,
  deletePhysicalFile,
  writeUploadedBuffer,
} from "../lib/storage";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 200,
    files: 20,
  },
});

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
  })
  .superRefine((value, ctx) => {
    if (value.isHourly && !value.startTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hourly items require a start time.",
        path: ["startTime"],
      });
    }
  });

const scheduleSettingPayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
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

async function ensureScheduleAttachmentFolder(scheduleItemId: string, jobId: string) {
  const title = `Schedule Item ${scheduleItemId} Attachments`;

  const [existing] = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.jobId, jobId),
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

async function hydrateScheduleItem(itemId: string) {
  const [row] = await db
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
      notes: scheduleItems.notes,
      createdBy: scheduleItems.createdBy,
      createdAt: scheduleItems.createdAt,
      updatedAt: scheduleItems.updatedAt,
      deletedAt: scheduleItems.deletedAt,
      createdByName: users.fullName,
      createdByAvatarUrl: users.avatarUrl,
      phaseName: schedulePhases.name,
    })
    .from(scheduleItems)
    .leftJoin(users, eq(scheduleItems.createdBy, users.id))
    .leftJoin(schedulePhases, eq(scheduleItems.schedulePhaseId, schedulePhases.id))
    .where(and(eq(scheduleItems.id, itemId), isNull(scheduleItems.deletedAt)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "Schedule item not found.");
  }

  const meta = decodeScheduleMeta(row.notes);

  const [assignees, predecessorRows, noteRows, attachmentRows, todoRows] = await Promise.all([
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
          .where(
            inArray(
              scheduleItems.id,
              meta.predecessors.map((predecessor) => predecessor.scheduleItemId),
            ),
          )
      : Promise.resolve([]),
    db
      .select({
        id: scheduleItemNotes.id,
        note: scheduleItemNotes.note,
        createdAt: scheduleItemNotes.createdAt,
        authorId: users.id,
        authorName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(scheduleItemNotes)
      .leftJoin(users, eq(scheduleItemNotes.createdBy, users.id))
      .where(eq(scheduleItemNotes.scheduleItemId, itemId))
      .orderBy(desc(scheduleItemNotes.createdAt)),
    db
      .select({
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
      .where(eq(scheduleItemAttachments.scheduleItemId, itemId))
      .orderBy(desc(files.createdAt)),
    db
      .select({
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
      .where(eq(scheduleItemTodos.scheduleItemId, itemId))
      .orderBy(desc(scheduleItemTodos.createdAt)),
  ]);

  const predecessorMap = new Map(
    predecessorRows.map((predecessor) => [predecessor.id, predecessor.title]),
  );

  const notesStream = [
    ...(meta.notes
      ? [
          {
            id: `legacy-${itemId}`,
            note: meta.notes,
            createdAt: row.createdAt,
            authorId: row.createdBy,
            authorName: row.createdByName,
            authorAvatarUrl: row.createdByAvatarUrl,
            isLegacy: true,
          },
        ]
      : []),
    ...noteRows.map((note) => ({
      ...note,
      isLegacy: false,
    })),
  ];

  return {
    item: {
      ...row,
      displayColor: row.displayColor ?? "#2563eb",
      notes: meta.notes,
      tags: meta.tags,
      notifyUserIds: [],
      phaseId: row.schedulePhaseId,
      phaseName: row.phaseName,
      assigneeIds: assignees.map((assignee) => assignee.id),
      assignees,
      predecessors: meta.predecessors.map((predecessor) => ({
        ...predecessor,
        title: predecessorMap.get(predecessor.scheduleItemId) ?? "Unknown task",
      })),
      notesStream,
      noteCount: notesStream.length,
      attachments: attachmentRows.map((attachment) => ({
        ...attachment,
        icon: fileIconKind(attachment.mimeType),
      })),
      relatedTodos: todoRows,
      relatedTodoCount: todoRows.length,
      status: deriveScheduleStatus({
        startDate: row.startDate,
        endDate: row.endDate,
        progress: row.progress,
        isComplete: row.isComplete,
      }),
    },
  };
}

router.get(
  "/jobs/:jobId/schedule/settings",
  asyncHandler(async (req, res) => {
    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const [phases, tags] = await Promise.all([
      db
        .select({
          id: schedulePhases.id,
          name: schedulePhases.name,
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
    ]);

    res.json({ phases, tags });
  }),
);

router.post(
  "/jobs/:jobId/schedule/settings/phases",
  asyncHandler(async (req, res) => {
    const body = scheduleSettingPayloadSchema.safeParse(req.body);

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
      })
      .returning({
        id: schedulePhases.id,
        name: schedulePhases.name,
      });

    await writeActivity({
      entityType: "schedule_phase",
      entityId: phase.id,
      action: "created",
      userId: req.auth.userId,
      jobId,
      description: `Created schedule phase ${phase.name} for ${job.title}`,
    });

    res.status(201).json({ phase });
  }),
);

router.put(
  "/jobs/:jobId/schedule/settings/phases/:phaseId",
  asyncHandler(async (req, res) => {
    const body = scheduleSettingPayloadSchema.safeParse(req.body);

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
        updatedAt: new Date(),
      })
      .where(eq(schedulePhases.id, phaseId))
      .returning({
        id: schedulePhases.id,
        name: schedulePhases.name,
      });

    res.json({ phase });
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
      userId: req.auth.userId,
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
    await assertPhaseBelongsToJob(jobId, body.data.phaseId);

    const [item] = await db
      .insert(scheduleItems)
      .values({
        jobId,
        schedulePhaseId: body.data.phaseId,
        title: body.data.title,
        displayColor: body.data.displayColor ?? "#2563eb",
        startDate: body.data.startDate,
        workDays: body.data.workDays,
        endDate:
          body.data.endDate ?? calculateBusinessEndDate(body.data.startDate, body.data.workDays),
        isHourly: body.data.isHourly,
        startTime: normalizeTimeValue(body.data.startTime),
        endTime: normalizeTimeValue(body.data.endTime),
        progress: body.data.progress,
        reminder: body.data.reminder,
        showOnGantt: body.data.showOnGantt,
        visibleToEstimators: body.data.visibleToEstimators,
        visibleToInstallers: body.data.visibleToInstallers,
        visibleToOfficeStaff: body.data.visibleToOfficeStaff,
        isComplete: body.data.isComplete,
        notes: encodeScheduleMeta({
          notes: body.data.notes,
          tags: normalizeUniqueStrings(body.data.tags),
          predecessors: body.data.predecessors,
        }),
        createdBy: req.auth.userId,
      })
      .returning();

    await syncAssignees(item.id, body.data.assigneeIds);

    if (body.data.notifyUserIds.length > 0) {
      const recipients = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.id, body.data.notifyUserIds));

      await writeActivity({
        entityType: "schedule_item_notification",
        entityId: item.id,
        action: "queued",
        userId: req.auth.userId,
        jobId,
        description: `Queued schedule item notifications for ${item.title}`,
        extra: {
          scheduleItemId: item.id,
          notifyUserIds: recipients.map((recipient) => recipient.id),
          recipients,
        },
      });
    }

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
    await assertPhaseBelongsToJob(existing.jobId, body.data.phaseId);

    await db
      .update(scheduleItems)
      .set({
        schedulePhaseId: body.data.phaseId,
        title: body.data.title,
        displayColor: body.data.displayColor ?? "#2563eb",
        startDate: body.data.startDate,
        workDays: body.data.workDays,
        endDate:
          body.data.endDate ?? calculateBusinessEndDate(body.data.startDate, body.data.workDays),
        isHourly: body.data.isHourly,
        startTime: normalizeTimeValue(body.data.startTime),
        endTime: normalizeTimeValue(body.data.endTime),
        progress: body.data.progress,
        reminder: body.data.reminder,
        showOnGantt: body.data.showOnGantt,
        visibleToEstimators: body.data.visibleToEstimators,
        visibleToInstallers: body.data.visibleToInstallers,
        visibleToOfficeStaff: body.data.visibleToOfficeStaff,
        isComplete: body.data.isComplete,
        notes: encodeScheduleMeta({
          notes: body.data.notes,
          tags: normalizeUniqueStrings(body.data.tags),
          predecessors: body.data.predecessors,
        }),
        updatedAt: new Date(),
      })
      .where(eq(scheduleItems.id, itemId));

    await syncAssignees(itemId, body.data.assigneeIds);

    if (body.data.notifyUserIds.length > 0) {
      const recipients = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.id, body.data.notifyUserIds));

      await writeActivity({
        entityType: "schedule_item_notification",
        entityId: itemId,
        action: "queued",
        userId: req.auth.userId,
        jobId: existing.jobId,
        description: `Queued schedule item notifications for ${body.data.title}`,
        extra: {
          scheduleItemId: itemId,
          notifyUserIds: recipients.map((recipient) => recipient.id),
          recipients,
        },
      });
    }

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
        createdBy: req.auth.userId,
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
      .where(eq(users.id, req.auth.userId))
      .limit(1);

    await writeActivity({
      entityType: "schedule_item_todo",
      entityId: todo.id,
      action: "created",
      userId: req.auth.userId,
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
      userId: req.auth.userId,
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
        createdBy: req.auth.userId,
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
      .where(eq(users.id, req.auth.userId))
      .limit(1);

    await writeActivity({
      entityType: "schedule_item_note",
      entityId: note.id,
      action: "created",
      userId: req.auth.userId,
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
  upload.array("files", 20),
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
      const storedFileName = buildStoredFileName(uploadedFile.originalname);
      const uploadPath = buildUploadPath({
        jobId: item.jobId,
        mediaType: "document",
        storedFileName,
      });

      await writeUploadedBuffer(uploadPath.fileUrl, uploadedFile.buffer);

      const [file] = await db
        .insert(files)
        .values({
          folderId: attachmentFolder.id,
          filename: storedFileName,
          originalName: uploadedFile.originalname,
          fileUrl: uploadPath.fileUrl,
          fileSize: uploadedFile.size,
          mimeType: uploadedFile.mimetype,
          uploadedBy: req.auth.userId,
        })
        .returning();

      const [attachment] = await db
        .insert(scheduleItemAttachments)
        .values({
          scheduleItemId: itemId,
          fileId: file.id,
        })
        .returning({
          id: scheduleItemAttachments.id,
        });

      await writeActivity({
        entityType: "schedule_item_attachment",
        entityId: attachment.id,
        action: "uploaded",
        userId: req.auth.userId,
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
      });
    }

    res.status(201).json({ attachments });
  }),
);

router.post(
  "/schedule-items/:id/attachments/new-doc",
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
    const documentContents = [
      item.title,
      "",
      "Created from the schedule item files tab.",
      "",
      `Item ID: ${item.id}`,
      `Created: ${new Date().toISOString()}`,
    ].join("\n");

    await writeUploadedBuffer(uploadPath.fileUrl, Buffer.from(documentContents, "utf8"));

    const [file] = await db
      .insert(files)
      .values({
        folderId: attachmentFolder.id,
        filename: storedFileName,
        originalName,
        fileUrl: uploadPath.fileUrl,
        fileSize: Buffer.byteLength(documentContents, "utf8"),
        mimeType: "text/plain",
        uploadedBy: req.auth.userId,
      })
      .returning();

    const [attachment] = await db
      .insert(scheduleItemAttachments)
      .values({
        scheduleItemId: itemId,
        fileId: file.id,
      })
      .returning({
        id: scheduleItemAttachments.id,
      });

    await writeActivity({
      entityType: "schedule_item_attachment",
      entityId: attachment.id,
      action: "created",
      userId: req.auth.userId,
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
      },
    });
  }),
);

router.delete(
  "/schedule-items/:id/attachments/:attachmentId",
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

    await db
      .delete(scheduleItemAttachments)
      .where(eq(scheduleItemAttachments.id, attachmentId));
    await db.delete(files).where(eq(files.id, attachment.fileId));
    await maybeDeletePhysicalFile(attachment.fileUrl, attachment.fileId);

    await writeActivity({
      entityType: "schedule_item_attachment",
      entityId: attachmentId,
      action: "deleted",
      userId: req.auth.userId,
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
