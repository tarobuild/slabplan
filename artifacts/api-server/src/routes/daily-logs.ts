import multer from "multer";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  dailyLogAttachments,
  dailyLogTags,
  dailyLogs,
  files,
  folders,
  jobs,
  users,
} from "@workspace/db/schema";
import { writeActivity } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { logger } from "../lib/logger";
import { emitRealtimeEvent } from "../lib/realtime";
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

const weatherDataSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .optional()
  .default(null);

const dailyLogListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  keywords: z.string().trim().optional(),
  createdBy: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  tag: z.string().trim().optional(),
  sharedWith: z
    .enum(["internal", "subs_vendors", "client", "private"])
    .optional(),
});

const dailyLogPayloadSchema = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: optionalString,
  notes: z.string().optional().default(""),
  weatherData: weatherDataSchema,
  includeWeather: z.coerce.boolean().optional().default(true),
  includeWeatherNotes: z.coerce.boolean().optional().default(false),
  weatherNotes: optionalString,
  shareInternalUsers: z.coerce.boolean().optional().default(true),
  shareSubsVendors: z.coerce.boolean().optional().default(false),
  shareClient: z.coerce.boolean().optional().default(false),
  isPrivate: z.coerce.boolean().optional().default(false),
  notifyUserIds: z.array(z.string().uuid()).optional().default([]),
  tags: z.array(z.string().trim().min(1).max(100)).optional().default([]),
});

const weatherMetaKey = "__cadstoneMeta";

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

function encodeWeatherPayload(
  weatherData: Record<string, unknown> | null,
  notifyUserIds: string[],
) {
  const nextWeatherData: Record<string, unknown> = weatherData ? { ...weatherData } : {};
  nextWeatherData[weatherMetaKey] = {
    notifyUserIds: Array.from(new Set(notifyUserIds)),
  };
  return nextWeatherData;
}

function decodeWeatherPayload(value: Record<string, unknown> | null | undefined) {
  if (!value || Array.isArray(value)) {
    return {
      weatherData: null,
      notifyUserIds: [] as string[],
    };
  }

  const nextValue = { ...value };
  const rawMeta = nextValue[weatherMetaKey];
  delete nextValue[weatherMetaKey];

  const notifyUserIds =
    rawMeta &&
    typeof rawMeta === "object" &&
    !Array.isArray(rawMeta) &&
    Array.isArray((rawMeta as { notifyUserIds?: unknown[] }).notifyUserIds)
      ? (rawMeta as { notifyUserIds: string[] }).notifyUserIds.filter((item) => typeof item === "string")
      : [];

  return {
    weatherData: Object.keys(nextValue).length > 0 ? nextValue : null,
    notifyUserIds,
  };
}

async function ensureJobExists(jobId: string) {
  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      city: jobs.city,
      state: jobs.state,
      streetAddress: jobs.streetAddress,
      zipCode: jobs.zipCode,
    })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), isNull(jobs.deletedAt)))
    .limit(1);

  if (!job) {
    throw new HttpError(404, "Job not found.");
  }

  return job;
}

async function getDailyLogOrThrow(id: string) {
  const [log] = await db
    .select()
    .from(dailyLogs)
    .where(and(eq(dailyLogs.id, id), isNull(dailyLogs.deletedAt)))
    .limit(1);

  if (!log) {
    throw new HttpError(404, "Daily log not found.");
  }

  return log;
}

async function ensureDailyLogAttachmentFolder(dailyLogId: string) {
  const title = `Daily Log ${dailyLogId} Attachments`;

  const [existing] = await db
    .select()
    .from(folders)
    .where(
      and(
        isNull(folders.jobId),
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
      jobId: null,
      title,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    })
    .returning();

  return created;
}

async function maybeDeletePhysicalFile(fileUrl: string | null | undefined, fileId: string) {
  if (!fileUrl) {
    return;
  }

  const [remainingFile] = await db
    .select({ total: count() })
    .from(files)
    .where(and(eq(files.fileUrl, fileUrl), sql`${files.id} <> ${fileId}`));

  if (!remainingFile || Number(remainingFile.total) === 0) {
    await deletePhysicalFile(fileUrl);
  }
}

async function syncDailyLogTags(dailyLogId: string, tags: string[]) {
  await db
    .delete(dailyLogTags)
    .where(eq(dailyLogTags.dailyLogId, dailyLogId));

  const normalized = normalizeUniqueStrings(tags);

  if (normalized.length > 0) {
    await db.insert(dailyLogTags).values(
      normalized.map((tagName) => ({
        dailyLogId,
        tagName,
      })),
    );
  }
}

async function hydrateDailyLog(id: string) {
  const [row] = await db
    .select({
      id: dailyLogs.id,
      jobId: dailyLogs.jobId,
      logDate: dailyLogs.logDate,
      title: dailyLogs.title,
      notes: dailyLogs.notes,
      weatherData: dailyLogs.weatherData,
      includeWeather: dailyLogs.includeWeather,
      includeWeatherNotes: dailyLogs.includeWeatherNotes,
      weatherNotes: dailyLogs.weatherNotes,
      shareInternalUsers: dailyLogs.shareInternalUsers,
      shareSubsVendors: dailyLogs.shareSubsVendors,
      shareClient: dailyLogs.shareClient,
      isPrivate: dailyLogs.isPrivate,
      createdBy: dailyLogs.createdBy,
      createdAt: dailyLogs.createdAt,
      updatedAt: dailyLogs.updatedAt,
      publishedAt: dailyLogs.publishedAt,
      deletedAt: dailyLogs.deletedAt,
      createdByName: users.fullName,
    })
    .from(dailyLogs)
    .leftJoin(users, eq(dailyLogs.createdBy, users.id))
    .where(and(eq(dailyLogs.id, id), isNull(dailyLogs.deletedAt)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "Daily log not found.");
  }

  const [tagRows, attachmentRows] = await Promise.all([
    db
      .select({
        id: dailyLogTags.id,
        tagName: dailyLogTags.tagName,
      })
      .from(dailyLogTags)
      .where(eq(dailyLogTags.dailyLogId, id))
      .orderBy(asc(dailyLogTags.tagName)),
    db
      .select({
        id: dailyLogAttachments.id,
        fileId: files.id,
        originalName: files.originalName,
        fileUrl: files.fileUrl,
        fileSize: files.fileSize,
        mimeType: files.mimeType,
        createdAt: files.createdAt,
        uploadedByName: users.fullName,
      })
      .from(dailyLogAttachments)
      .innerJoin(files, eq(dailyLogAttachments.fileId, files.id))
      .leftJoin(users, eq(files.uploadedBy, users.id))
      .where(eq(dailyLogAttachments.dailyLogId, id))
      .orderBy(desc(files.createdAt)),
  ]);

  const weather = decodeWeatherPayload(
    row.weatherData as Record<string, unknown> | null | undefined,
  );

  const notifyUsers =
    weather.notifyUserIds.length > 0
      ? await db
          .select({
            id: users.id,
            fullName: users.fullName,
            email: users.email,
            role: users.role,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .where(inArray(users.id, weather.notifyUserIds))
          .orderBy(asc(users.fullName))
      : [];

  return {
    log: {
      ...row,
      weatherData: weather.weatherData,
      notifyUserIds: weather.notifyUserIds,
      notifyUsers,
      tags: tagRows.map((tag) => tag.tagName),
      attachments: attachmentRows,
      status: row.publishedAt ? "published" : "draft",
    },
  };
}

router.get(
  "/jobs/:jobId/daily-logs",
  asyncHandler(async (req, res) => {
    const query = dailyLogListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid daily log query.", query.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const conditions = [eq(dailyLogs.jobId, jobId), isNull(dailyLogs.deletedAt)];

    if (query.data.createdBy) {
      conditions.push(eq(dailyLogs.createdBy, query.data.createdBy));
    }

    if (query.data.from) {
      conditions.push(sql`${dailyLogs.logDate} >= ${query.data.from}`);
    }

    if (query.data.to) {
      conditions.push(sql`${dailyLogs.logDate} <= ${query.data.to}`);
    }

    if (query.data.keywords) {
      const search = `%${query.data.keywords}%`;
      conditions.push(
        sql`(${ilike(dailyLogs.title, search)} or ${ilike(dailyLogs.notes, search)} or ${ilike(dailyLogs.weatherNotes, search)})`,
      );
    }

    const rows = await db
      .select({
        id: dailyLogs.id,
        jobId: dailyLogs.jobId,
        logDate: dailyLogs.logDate,
        title: dailyLogs.title,
        notes: dailyLogs.notes,
        weatherData: dailyLogs.weatherData,
        includeWeather: dailyLogs.includeWeather,
        includeWeatherNotes: dailyLogs.includeWeatherNotes,
        weatherNotes: dailyLogs.weatherNotes,
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
      .where(and(...conditions))
      .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt));

    const logIds = rows.map((row) => row.id);
    const [tagRows, attachmentRows] = await Promise.all([
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
    ]);

    const tagsByLogId = new Map<string, string[]>();
    const attachmentCountByLogId = new Map<string, number>();

    for (const row of tagRows) {
      if (!row.dailyLogId) {
        continue;
      }

      const group = tagsByLogId.get(row.dailyLogId) ?? [];
      group.push(row.tagName);
      tagsByLogId.set(row.dailyLogId, group);
    }

    for (const row of attachmentRows) {
      if (!row.dailyLogId) {
        continue;
      }

      attachmentCountByLogId.set(row.dailyLogId, Number(row.total));
    }

    let filtered = rows.map((row) => {
      const weather = decodeWeatherPayload(
        row.weatherData as Record<string, unknown> | null | undefined,
      );

      return {
        ...row,
        weatherData: weather.weatherData,
        notifyUserIds: weather.notifyUserIds,
        tags: normalizeUniqueStrings(tagsByLogId.get(row.id) ?? []),
        attachmentCount: attachmentCountByLogId.get(row.id) ?? 0,
        status: row.publishedAt ? "published" : "draft",
      };
    });

    if (query.data.tag) {
      const expectedTag = query.data.tag.toLowerCase();
      filtered = filtered.filter((row) =>
        row.tags.some((tag) => tag.toLowerCase() === expectedTag),
      );
    }

    if (query.data.sharedWith) {
      filtered = filtered.filter((row) => {
        if (query.data.sharedWith === "internal") {
          return !!row.shareInternalUsers;
        }

        if (query.data.sharedWith === "subs_vendors") {
          return !!row.shareSubsVendors;
        }

        if (query.data.sharedWith === "client") {
          return !!row.shareClient;
        }

        return !!row.isPrivate;
      });
    }

    const totalItems = filtered.length;
    const offset = (query.data.page - 1) * query.data.pageSize;
    filtered = filtered.slice(offset, offset + query.data.pageSize);

    res.json({
      logs: filtered,
      pagination: {
        page: query.data.page,
        pageSize: query.data.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.data.pageSize)),
      },
    });
  }),
);

router.post(
  "/jobs/:jobId/daily-logs",
  asyncHandler(async (req, res) => {
    const body = dailyLogPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid daily log payload.", body.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const [log] = await db
      .insert(dailyLogs)
      .values({
        jobId,
        logDate: body.data.logDate,
        title: body.data.title,
        notes: body.data.notes,
        weatherData: encodeWeatherPayload(body.data.weatherData, body.data.notifyUserIds),
        includeWeather: body.data.includeWeather,
        includeWeatherNotes: body.data.includeWeatherNotes,
        weatherNotes: body.data.weatherNotes,
        shareInternalUsers: body.data.shareInternalUsers,
        shareSubsVendors: body.data.shareSubsVendors,
        shareClient: body.data.shareClient,
        isPrivate: body.data.isPrivate,
        createdBy: req.auth.userId,
      })
      .returning();

    await syncDailyLogTags(log.id, body.data.tags);

    await writeActivity({
      entityType: "daily_log",
      entityId: log.id,
      action: "created",
      userId: req.auth.userId,
      jobId,
      description: `Created daily log ${body.data.title || body.data.logDate}`,
      extra: {
        dailyLogId: log.id,
      },
    });

    const hydrated = await hydrateDailyLog(log.id);
    res.status(201).json(hydrated);
  }),
);

router.get(
  "/daily-logs/:id",
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const hydrated = await hydrateDailyLog(logId);
    res.json(hydrated);
  }),
);

router.put(
  "/daily-logs/:id",
  asyncHandler(async (req, res) => {
    const body = dailyLogPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid daily log payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const existing = await getDailyLogOrThrow(logId);

    if (!existing.jobId) {
      throw new HttpError(400, "Daily log is missing a job.");
    }

    await db
      .update(dailyLogs)
      .set({
        logDate: body.data.logDate,
        title: body.data.title,
        notes: body.data.notes,
        weatherData: encodeWeatherPayload(body.data.weatherData, body.data.notifyUserIds),
        includeWeather: body.data.includeWeather,
        includeWeatherNotes: body.data.includeWeatherNotes,
        weatherNotes: body.data.weatherNotes,
        shareInternalUsers: body.data.shareInternalUsers,
        shareSubsVendors: body.data.shareSubsVendors,
        shareClient: body.data.shareClient,
        isPrivate: body.data.isPrivate,
        updatedAt: new Date(),
      })
      .where(eq(dailyLogs.id, logId));

    await syncDailyLogTags(logId, body.data.tags);

    await writeActivity({
      entityType: "daily_log",
      entityId: logId,
      action: "updated",
      userId: req.auth.userId,
      jobId: existing.jobId,
      description: `Updated daily log ${body.data.title || body.data.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    const hydrated = await hydrateDailyLog(logId);
    res.json(hydrated);
  }),
);

router.delete(
  "/daily-logs/:id",
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const existing = await getDailyLogOrThrow(logId);

    if (!existing.jobId) {
      throw new HttpError(400, "Daily log is missing a job.");
    }

    await db
      .update(dailyLogs)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dailyLogs.id, logId));

    await writeActivity({
      entityType: "daily_log",
      entityId: logId,
      action: "deleted",
      userId: req.auth.userId,
      jobId: existing.jobId,
      description: `Deleted daily log ${existing.title || existing.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    res.json({ success: true });
  }),
);

router.post(
  "/daily-logs/:id/publish",
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const existing = await getDailyLogOrThrow(logId);

    if (!existing.jobId) {
      throw new HttpError(400, "Daily log is missing a job.");
    }

    await db
      .update(dailyLogs)
      .set({
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dailyLogs.id, logId));

    const hydrated = await hydrateDailyLog(logId);

    logger.info(
      {
        dailyLogId: logId,
        recipients: hydrated.log.notifyUsers.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.fullName,
        })),
      },
      "Daily log publish notifications queued (stub)",
    );

    await writeActivity({
      entityType: "daily_log",
      entityId: logId,
      action: "published",
      userId: req.auth.userId,
      jobId: existing.jobId,
      description: `Published daily log ${hydrated.log.title || hydrated.log.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    emitRealtimeEvent("daily-log:published", {
      id: hydrated.log.id,
      jobId: hydrated.log.jobId,
      title: hydrated.log.title,
      logDate: hydrated.log.logDate,
      publishedAt: hydrated.log.publishedAt,
    });

    res.json(hydrated);
  }),
);

router.post(
  "/daily-logs/:id/attachments",
  upload.array("files", 20),
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);
    const attachmentFolder = await ensureDailyLogAttachmentFolder(logId);
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (uploadedFiles.length === 0) {
      throw new HttpError(400, "At least one attachment is required.");
    }

    const attachments = [];

    for (const uploadedFile of uploadedFiles) {
      const storedFileName = buildStoredFileName(uploadedFile.originalname);
      const uploadPath = buildUploadPath({
        jobId: `daily-log-${logId}`,
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
        .insert(dailyLogAttachments)
        .values({
          dailyLogId: logId,
          fileId: file.id,
        })
        .returning({
          id: dailyLogAttachments.id,
        });

      await writeActivity({
        entityType: "daily_log_attachment",
        entityId: attachment.id,
        action: "uploaded",
        userId: req.auth.userId,
        jobId: dailyLog.jobId!,
        description: `Uploaded ${file.originalName} to daily log ${dailyLog.title || dailyLog.logDate}`,
        extra: {
          dailyLogId: logId,
          fileId: file.id,
        },
      });

      attachments.push({
        id: attachment.id,
        fileId: file.id,
        originalName: file.originalName,
        fileUrl: file.fileUrl,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
      });
    }

    res.status(201).json({ attachments });
  }),
);

router.delete(
  "/daily-logs/:id/attachments/:attachmentId",
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const attachmentId = getParam(req.params.attachmentId, "attachment id");
    const dailyLog = await getDailyLogOrThrow(logId);

    const [attachment] = await db
      .select({
        id: dailyLogAttachments.id,
        fileId: files.id,
        originalName: files.originalName,
        fileUrl: files.fileUrl,
      })
      .from(dailyLogAttachments)
      .innerJoin(files, eq(dailyLogAttachments.fileId, files.id))
      .where(
        and(
          eq(dailyLogAttachments.id, attachmentId),
          eq(dailyLogAttachments.dailyLogId, logId),
        ),
      )
      .limit(1);

    if (!attachment) {
      throw new HttpError(404, "Attachment not found.");
    }

    await db
      .delete(dailyLogAttachments)
      .where(eq(dailyLogAttachments.id, attachmentId));
    await db.delete(files).where(eq(files.id, attachment.fileId));
    await maybeDeletePhysicalFile(attachment.fileUrl, attachment.fileId);

    await writeActivity({
      entityType: "daily_log_attachment",
      entityId: attachmentId,
      action: "deleted",
      userId: req.auth.userId,
      jobId: dailyLog.jobId!,
      description: `Deleted ${attachment.originalName} from daily log ${dailyLog.title || dailyLog.logDate}`,
      extra: {
        dailyLogId: logId,
        fileId: attachment.fileId,
      },
    });

    res.json({ success: true });
  }),
);

export default router;
