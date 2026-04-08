import crypto from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  max,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  dailyLogAttachments,
  dailyLogComments,
  dailyLogCustomFields,
  dailyLogLikes,
  dailyLogSettings,
  dailyLogTags,
  dailyLogTodos,
  dailyLogs,
  jobs,
  users,
} from "@workspace/db/schema";
import { HttpError, asyncHandler } from "../lib/http";
import { requireAdmin } from "../middleware/require-auth";

const router: IRouter = Router();

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const settingsPayloadSchema = z.object({
  stampLocation: z.coerce.boolean().optional(),
  defaultNotes: z.string().optional(),
  includeWeatherByDefault: z.coerce.boolean().optional(),
  includeWeatherNotesByDefault: z.coerce.boolean().optional(),
  shareInternalUsersByDefault: z.coerce.boolean().optional(),
  notifyInternalUsersByDefault: z.coerce.boolean().optional(),
  shareEstimatorsByDefault: z.coerce.boolean().optional(),
  notifyEstimatorsByDefault: z.coerce.boolean().optional(),
  shareInstallersByDefault: z.coerce.boolean().optional(),
  notifyInstallersByDefault: z.coerce.boolean().optional(),
});

const customFieldTypeValues = ["text", "number", "date", "dropdown", "checkbox"] as const;

const customFieldPayloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
  fieldType: z.enum(customFieldTypeValues),
  options: z.array(z.string().trim().min(1).max(100)).optional().default([]),
  displayOrder: z.coerce.number().int().min(0).optional(),
}).superRefine((value, ctx) => {
  if (value.fieldType === "dropdown" && value.options.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Dropdown custom fields require at least one option.",
      path: ["options"],
    });
  }
});

const myDailyLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(50),
  keywords: z.string().trim().optional(),
});

function deriveVisibilityLabel(log: {
  isPrivate: boolean | null;
  shareInternalUsers: boolean | null;
  shareClient: boolean | null;
  shareSubsVendors: boolean | null;
}) {
  if (log.isPrivate) {
    return "Private";
  }

  if (log.shareClient) {
    return "Estimators";
  }

  if (log.shareSubsVendors) {
    return "Installers";
  }

  if (log.shareInternalUsers) {
    return "Internal";
  }

  return "Internal";
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

function firstParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

async function ensureSettingsRow() {
  const [existing] = await db
    .select()
    .from(dailyLogSettings)
    .orderBy(asc(dailyLogSettings.createdAt))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(dailyLogSettings)
    .values({
      id: crypto.randomUUID(),
      stampLocation: false,
      defaultNotes: "",
      includeWeatherByDefault: true,
      includeWeatherNotesByDefault: false,
      shareInternalUsersByDefault: true,
      notifyInternalUsersByDefault: false,
      shareEstimatorsByDefault: false,
      notifyEstimatorsByDefault: false,
      shareInstallersByDefault: false,
      notifyInstallersByDefault: false,
    })
    .returning();

  return created;
}

async function assertCustomFieldNameUnique(name: string, excludeId?: string) {
  const [existing] = await db
    .select({ id: dailyLogCustomFields.id })
    .from(dailyLogCustomFields)
    .where(
      excludeId
        ? and(eq(dailyLogCustomFields.name, name), sql`${dailyLogCustomFields.id} <> ${excludeId}`)
        : eq(dailyLogCustomFields.name, name),
    )
    .limit(1);

  if (existing) {
    throw new HttpError(409, "A daily log custom field with that name already exists.");
  }
}

router.get(
  "/daily-logs/settings",
  asyncHandler(async (_req, res) => {
    const settings = await ensureSettingsRow();
    res.json({ settings });
  }),
);

router.put(
  "/daily-logs/settings",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = settingsPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid daily log settings payload.", body.error.flatten());
    }

    const existing = await ensureSettingsRow();

    const [settings] = await db
      .update(dailyLogSettings)
      .set({
        stampLocation: body.data.stampLocation ?? existing.stampLocation,
        defaultNotes: body.data.defaultNotes ?? existing.defaultNotes,
        includeWeatherByDefault: body.data.includeWeatherByDefault ?? existing.includeWeatherByDefault,
        includeWeatherNotesByDefault:
          body.data.includeWeatherNotesByDefault ?? existing.includeWeatherNotesByDefault,
        shareInternalUsersByDefault:
          body.data.shareInternalUsersByDefault ?? existing.shareInternalUsersByDefault,
        notifyInternalUsersByDefault:
          body.data.notifyInternalUsersByDefault ?? existing.notifyInternalUsersByDefault,
        shareEstimatorsByDefault:
          body.data.shareEstimatorsByDefault ?? existing.shareEstimatorsByDefault,
        notifyEstimatorsByDefault:
          body.data.notifyEstimatorsByDefault ?? existing.notifyEstimatorsByDefault,
        shareInstallersByDefault:
          body.data.shareInstallersByDefault ?? existing.shareInstallersByDefault,
        notifyInstallersByDefault:
          body.data.notifyInstallersByDefault ?? existing.notifyInstallersByDefault,
        updatedAt: new Date(),
      })
      .where(eq(dailyLogSettings.id, existing.id))
      .returning();

    res.json({ settings });
  }),
);

router.get(
  "/daily-logs/custom-fields",
  asyncHandler(async (_req, res) => {
    const fields = await db
      .select({
        id: dailyLogCustomFields.id,
        name: dailyLogCustomFields.name,
        fieldType: dailyLogCustomFields.fieldType,
        options: dailyLogCustomFields.options,
        displayOrder: dailyLogCustomFields.displayOrder,
        createdAt: dailyLogCustomFields.createdAt,
        updatedAt: dailyLogCustomFields.updatedAt,
      })
      .from(dailyLogCustomFields)
      .orderBy(asc(dailyLogCustomFields.displayOrder), asc(dailyLogCustomFields.createdAt));

    res.json({ fields });
  }),
);

router.post(
  "/daily-logs/custom-fields",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = customFieldPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid daily log custom field payload.", body.error.flatten());
    }

    await assertCustomFieldNameUnique(body.data.name);

    const [maxOrderRow] = await db
      .select({ value: max(dailyLogCustomFields.displayOrder) })
      .from(dailyLogCustomFields);

    const [field] = await db
      .insert(dailyLogCustomFields)
      .values({
        id: crypto.randomUUID(),
        name: body.data.name,
        fieldType: body.data.fieldType,
        options: body.data.fieldType === "dropdown" ? normalizeUniqueStrings(body.data.options) : [],
        displayOrder: body.data.displayOrder ?? Number(maxOrderRow?.value ?? -1) + 1,
      })
      .returning();

    res.status(201).json({ field });
  }),
);

router.put(
  "/daily-logs/custom-fields/:fieldId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = customFieldPayloadSchema.safeParse(req.body ?? {});

    if (!body.success) {
      throw new HttpError(400, "Invalid daily log custom field payload.", body.error.flatten());
    }

    const fieldId = firstParamValue(req.params.fieldId);

    if (!fieldId) {
      throw new HttpError(400, "Missing custom field id.");
    }

    const [existing] = await db
      .select()
      .from(dailyLogCustomFields)
      .where(eq(dailyLogCustomFields.id, fieldId))
      .limit(1);

    if (!existing) {
      throw new HttpError(404, "Daily log custom field not found.");
    }

    await assertCustomFieldNameUnique(body.data.name, fieldId);

    const [field] = await db
      .update(dailyLogCustomFields)
      .set({
        name: body.data.name,
        fieldType: body.data.fieldType,
        options: body.data.fieldType === "dropdown" ? normalizeUniqueStrings(body.data.options) : [],
        displayOrder: body.data.displayOrder ?? existing.displayOrder,
        updatedAt: new Date(),
      })
      .where(eq(dailyLogCustomFields.id, fieldId))
      .returning();

    res.json({ field });
  }),
);

router.delete(
  "/daily-logs/custom-fields/:fieldId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const fieldId = firstParamValue(req.params.fieldId);

    if (!fieldId) {
      throw new HttpError(400, "Missing custom field id.");
    }

    const [existing] = await db
      .select({ id: dailyLogCustomFields.id })
      .from(dailyLogCustomFields)
      .where(eq(dailyLogCustomFields.id, fieldId))
      .limit(1);

    if (!existing) {
      throw new HttpError(404, "Daily log custom field not found.");
    }

    await db.delete(dailyLogCustomFields).where(eq(dailyLogCustomFields.id, fieldId));
    res.json({ success: true });
  }),
);

router.get(
  "/daily-logs/mine",
  asyncHandler(async (req, res) => {
    const query = myDailyLogsQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid my daily logs query.", query.error.flatten());
    }

    const conditions = [
      eq(dailyLogs.createdBy, req.auth.userId),
      isNull(dailyLogs.deletedAt),
    ];

    if (query.data.keywords) {
      const search = `%${query.data.keywords}%`;
      conditions.push(
        sql`(${ilike(dailyLogs.title, search)} or ${ilike(dailyLogs.notes, search)} or ${ilike(dailyLogs.weatherNotes, search)} or ${ilike(jobs.title, search)})`,
      );
    }

    const rows = await db
      .select({
        id: dailyLogs.id,
        jobId: dailyLogs.jobId,
        jobTitle: jobs.title,
        logDate: dailyLogs.logDate,
        title: dailyLogs.title,
        notes: dailyLogs.notes,
        weatherData: dailyLogs.weatherData,
        includeWeather: dailyLogs.includeWeather,
        includeWeatherNotes: dailyLogs.includeWeatherNotes,
        weatherNotes: dailyLogs.weatherNotes,
        customFieldValues: dailyLogs.customFieldValues,
        shareInternalUsers: dailyLogs.shareInternalUsers,
        shareSubsVendors: dailyLogs.shareSubsVendors,
        shareClient: dailyLogs.shareClient,
        isPrivate: dailyLogs.isPrivate,
        createdBy: dailyLogs.createdBy,
        createdAt: dailyLogs.createdAt,
        updatedAt: dailyLogs.updatedAt,
        publishedAt: dailyLogs.publishedAt,
        createdByName: users.fullName,
      })
      .from(dailyLogs)
      .leftJoin(users, eq(dailyLogs.createdBy, users.id))
      .leftJoin(jobs, eq(dailyLogs.jobId, jobs.id))
      .where(and(...conditions))
      .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt));

    const logIds = rows.map((row) => row.id);
    const [tagRows, attachmentRows, likeRows, commentRows, todoRows] = await Promise.all([
      logIds.length > 0
        ? db
            .select({
              dailyLogId: dailyLogTags.dailyLogId,
              tagName: dailyLogTags.tagName,
            })
            .from(dailyLogTags)
            .where(inArray(dailyLogTags.dailyLogId, logIds))
        : Promise.resolve([]),
      logIds.length > 0
        ? db
            .select({
              dailyLogId: dailyLogAttachments.dailyLogId,
              total: count(),
            })
            .from(dailyLogAttachments)
            .where(inArray(dailyLogAttachments.dailyLogId, logIds))
            .groupBy(dailyLogAttachments.dailyLogId)
        : Promise.resolve([]),
      logIds.length > 0
        ? db
            .select({
              dailyLogId: dailyLogLikes.dailyLogId,
              userId: dailyLogLikes.userId,
            })
            .from(dailyLogLikes)
            .where(inArray(dailyLogLikes.dailyLogId, logIds))
        : Promise.resolve([]),
      logIds.length > 0
        ? db
            .select({
              dailyLogId: dailyLogComments.dailyLogId,
              total: count(),
            })
            .from(dailyLogComments)
            .where(
              and(
                inArray(dailyLogComments.dailyLogId, logIds),
                isNull(dailyLogComments.deletedAt),
              ),
            )
            .groupBy(dailyLogComments.dailyLogId)
        : Promise.resolve([]),
      logIds.length > 0
        ? db
            .select({
              dailyLogId: dailyLogTodos.dailyLogId,
              total: count(),
              complete: sql<number>`sum(case when ${dailyLogTodos.isComplete} then 1 else 0 end)`,
            })
            .from(dailyLogTodos)
            .where(inArray(dailyLogTodos.dailyLogId, logIds))
            .groupBy(dailyLogTodos.dailyLogId)
        : Promise.resolve([]),
    ]);

    const tagsByLogId = new Map();
    const attachmentCountByLogId = new Map();
    const likesCountByLogId = new Map();
    const likedByCurrentUser = new Set();
    const commentsCountByLogId = new Map();
    const todosCountByLogId = new Map();
    const completedTodosCountByLogId = new Map();

    for (const row of tagRows) {
      if (!row.dailyLogId) continue;
      const group = tagsByLogId.get(row.dailyLogId) ?? [];
      group.push(row.tagName);
      tagsByLogId.set(row.dailyLogId, group);
    }

    for (const row of attachmentRows) {
      if (!row.dailyLogId) continue;
      attachmentCountByLogId.set(row.dailyLogId, Number(row.total));
    }

    for (const row of likeRows) {
      likesCountByLogId.set(row.dailyLogId, (likesCountByLogId.get(row.dailyLogId) ?? 0) + 1);
      if (row.userId === req.auth.userId) {
        likedByCurrentUser.add(row.dailyLogId);
      }
    }

    for (const row of commentRows) {
      commentsCountByLogId.set(row.dailyLogId, Number(row.total));
    }

    for (const row of todoRows) {
      todosCountByLogId.set(row.dailyLogId, Number(row.total));
      completedTodosCountByLogId.set(row.dailyLogId, Number(row.complete ?? 0));
    }

    const totalItems = rows.length;
    const offset = (query.data.page - 1) * query.data.pageSize;
    const paged = rows.slice(offset, offset + query.data.pageSize).map((row) => ({
      ...row,
      tags: normalizeUniqueStrings(tagsByLogId.get(row.id) ?? []),
      customFieldValues:
        row.customFieldValues &&
        typeof row.customFieldValues === "object" &&
        !Array.isArray(row.customFieldValues)
          ? (row.customFieldValues as Record<string, string | number | boolean | null>)
          : {},
      attachmentCount: attachmentCountByLogId.get(row.id) ?? 0,
      likesCount: likesCountByLogId.get(row.id) ?? 0,
      commentsCount: commentsCountByLogId.get(row.id) ?? 0,
      likedByCurrentUser: likedByCurrentUser.has(row.id),
      visibilityLabel: deriveVisibilityLabel(row),
      todoCount: todosCountByLogId.get(row.id) ?? 0,
      completedTodoCount: completedTodosCountByLogId.get(row.id) ?? 0,
      status: row.publishedAt ? "published" : "draft",
    }));

    res.json({
      logs: paged,
      pagination: {
        page: query.data.page,
        pageSize: query.data.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.data.pageSize)),
      },
    });
  }),
);

export default router;
