import crypto from "node:crypto";
import path from "node:path";
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
  clients,
  dailyLogAttachments,
  dailyLogComments,
  dailyLogCustomFields,
  dailyLogLikes,
  dailyLogTags,
  dailyLogTodos,
  dailyLogs,
  files,
  folders,
  jobs,
  users,
} from "@workspace/db/schema";
import {
  assertCanAccessJob,
  assertCanAccessJobFeature,
  assertCanCreateDailyLog,
  assertCanEditDailyLog,
  assertCanViewDailyLog,
  isAdmin,
  listAccessibleJobIds,
  type AuthContext,
} from "../lib/authorization";
import { requireAdmin } from "../middleware/require-auth";
import { decodeCursor, encodeCursor, isCursorModeRequested } from "../lib/cursor";
import { buildDailyLogVisibilityFilter } from "../lib/daily-log-visibility";
import {
  photoExtensions,
  validateUploadForMediaType,
  videoExtensions,
  writeActivity,
} from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { logger } from "../lib/logger";
import { emitRealtimeEvent } from "../lib/realtime";
import { buildContainsLikePattern } from "../lib/search";
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
  persistWithStorageRollback,
  uploadArray,
} from "../lib/uploads";
import { createUploadPerUserRateLimit } from "../lib/rate-limit";
import {
  fetchWeatherForAddress,
  fetchWeatherForCoords,
  getCachedForecastForAddress,
  getCachedForecastForCoords,
} from "../lib/weather";

const uploadRateLimit = createUploadPerUserRateLimit();

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

// Per-comment caps for the multipart upload + DB row attachment flow. Anything
// looser than these would leak the legacy base64-in-JSON limits back into the
// new endpoint, so they stay co-located with the schema.
const MAX_COMMENT_ATTACHMENTS = 10;
const MAX_COMMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const commentAttachmentSchema = z.object({
  fileId: z.string().uuid(),
});

const commentPayloadSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  parentCommentId: z.string().uuid().nullable().optional().default(null),
  mentions: z.array(z.string().uuid()).optional().default([]),
  attachments: z
    .array(commentAttachmentSchema)
    .max(MAX_COMMENT_ATTACHMENTS)
    .optional()
    .default([]),
  links: z.array(z.string().trim().url()).optional().default([]),
});

const commentReactionPayloadSchema = z.object({
  emoji: z.string().trim().min(1).max(32),
});

const todoPayloadSchema = z.object({
  title: z.string().trim().min(1).max(255),
});

const todoTogglePayloadSchema = z.object({
  isComplete: z.coerce.boolean().optional(),
});

const customFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const customFieldValuesSchema = z.record(customFieldValueSchema).optional().default({});

const dailyLogListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(500).optional().default(10),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  keywords: z.string().trim().optional(),
  createdBy: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  tag: z.string().trim().optional(),
  tags: z
    .union([z.string(), z.array(z.string()), z.undefined()])
    .transform((value) => {
      if (!value) {
        return [];
      }

      const values = Array.isArray(value) ? value : value.split(",");
      return normalizeUniqueStrings(values);
    }),
  sharedWith: z
    .enum(["internal", "subs_vendors", "client", "private", "estimators", "installers"])
    .optional(),
});

const dailyLogPayloadSchema = z.object({
  jobId: z.string().uuid().optional(),
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
  customFieldValues: customFieldValuesSchema,
});

const weatherQuerySchema = z
  .object({
    address: z.string().trim().min(1).max(500).optional(),
    lat: z.coerce.number().gte(-90).lte(90).optional(),
    lng: z.coerce.number().gte(-180).lte(180).optional(),
    date: optionalDate,
  })
  .refine(
    (value) =>
      typeof value.address === "string" ||
      (typeof value.lat === "number" && typeof value.lng === "number"),
    { message: "Provide either `address` or both `lat` and `lng`." },
  );

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

function requireDailyLogJobId(dailyLog: { jobId: string | null }) {
  if (!dailyLog.jobId) {
    throw new HttpError(400, "Daily log has no associated job.");
  }

  return dailyLog.jobId;
}

const requireDailyLogJobAccess = asyncHandler(async (req, _res, next) => {
  const jobId = getParam(req.params.jobId, "job id");
  await assertCanAccessJobFeature(req.auth!, jobId, "dailyLogs");
  if (req.method !== "GET") {
    await assertCanCreateDailyLog(req.auth!, jobId);
  }
  next();
});

const requireDailyLogViewAccess = asyncHandler(async (req, _res, next) => {
  const logId = getParam(req.params.id, "daily log id");
  await assertCanViewDailyLog(req.auth!, logId);
  next();
});

const requireDailyLogEditAccess = asyncHandler(async (req, _res, next) => {
  if (!isAdmin(req.auth!)) {
    throw new HttpError(403, "Only admins can update daily logs.");
  }
  const logId = getParam(req.params.id, "daily log id");
  await assertCanEditDailyLog(req.auth!, logId);
  next();
});

async function assertCanContributeToDailyLog(auth: AuthContext, logId: string) {
  const dailyLog = await getDailyLogOrThrow(logId);
  const jobId = requireDailyLogJobId(dailyLog);

  if (isAdmin(auth)) {
    return dailyLog;
  }

  if (dailyLog.createdBy !== auth.userId) {
    throw new HttpError(403, "You can only add to daily logs you created.");
  }

  await assertCanCreateDailyLog(auth, jobId);
  return dailyLog;
}

const requireDailyLogContributorAccess = asyncHandler(async (req, _res, next) => {
  const logId = getParam(req.params.id, "daily log id");
  await assertCanContributeToDailyLog(req.auth!, logId);
  next();
});

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

function normalizeCustomFieldValueRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string | number | boolean | null>;
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null
    ) {
      return [[key, entry] as const];
    }

    return [];
  });

  return Object.fromEntries(entries);
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

// Comment-attachment uploads live in their own folder (separate from the
// regular daily-log attachments folder) so the comment-attachments stream
// stays scoped: when /comments validates an incoming `fileId`, it only
// considers files that were uploaded into THIS folder, which means a user
// cannot attach an arbitrary file they happen to have access to elsewhere.
async function ensureDailyLogCommentAttachmentFolder(dailyLogId: string) {
  const title = `Daily Log ${dailyLogId} Comment Attachments`;

  const [existing] = await db
    .select()
    .from(folders)
    .where(
      and(
        isNull(folders.jobId),
        eq(folders.scope, "daily_log"),
        eq(folders.dailyLogId, dailyLogId),
        eq(folders.title, title),
        eq(folders.mediaType, "photo"),
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
      jobId: sql<string>`null`,
      scope: "daily_log",
      dailyLogId,
      title,
      mediaType: "photo",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    })
    .returning();

  return created;
}

async function ensureDailyLogAttachmentFolder(dailyLogId: string) {
  const title = `Daily Log ${dailyLogId} Attachments`;

  const [existing] = await db
    .select()
    .from(folders)
    .where(
      and(
        isNull(folders.jobId),
        eq(folders.scope, "daily_log"),
        eq(folders.dailyLogId, dailyLogId),
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
      jobId: sql<string>`null`,
      scope: "daily_log",
      dailyLogId,
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

async function loadDailyLogEngagement(logIds: string[], currentUserId: string) {
  const [likeRows, commentRows, todoRows] = await Promise.all([
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

  const likesCountByLogId = new Map<string, number>();
  const likedByCurrentUser = new Set<string>();
  const commentsCountByLogId = new Map<string, number>();
  const todosCountByLogId = new Map<string, number>();
  const completedTodosCountByLogId = new Map<string, number>();

  for (const row of likeRows) {
    const key = row.dailyLogId;
    likesCountByLogId.set(key, (likesCountByLogId.get(key) ?? 0) + 1);

    if (row.userId === currentUserId) {
      likedByCurrentUser.add(key);
    }
  }

  for (const row of commentRows) {
    commentsCountByLogId.set(row.dailyLogId, Number(row.total));
  }

  for (const row of todoRows) {
    todosCountByLogId.set(row.dailyLogId, Number(row.total));
    completedTodosCountByLogId.set(row.dailyLogId, Number(row.complete ?? 0));
  }

  return {
    likesCountByLogId,
    likedByCurrentUser,
    commentsCountByLogId,
    todosCountByLogId,
    completedTodosCountByLogId,
  };
}

type HydratedComment = {
  id: string;
  dailyLogId: string;
  parentCommentId: string | null;
  body: string;
  mentions: string[];
  // Both shapes coexist: legacy comments persisted base64 data URLs in `url`
  // (no `fileId`), while new comments persist a `fileId`/`fileUrl` pair that
  // points at a `files` row served via the authenticated /uploads/... stream.
  attachments: Array<{
    name: string;
    url: string | null;
    mimeType: string | null;
    fileId: string | null;
    fileUrl: string | null;
  }>;
  links: string[];
  reactions: Record<string, string[]>;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  };
  replies: HydratedComment[];
};

function normalizeCommentArrayValue<T>(value: unknown, guard: (item: unknown) => item is T) {
  if (!Array.isArray(value)) {
    return [] as T[];
  }

  return value.filter(guard);
}

function isStringArrayValue(value: unknown): value is string {
  return typeof value === "string";
}

function isCommentAttachmentValue(
  value: unknown,
): value is {
  name: string;
  url: string | null;
  mimeType: string | null;
  fileId: string | null;
  fileUrl: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") {
    return false;
  }

  const hasLegacyUrl = typeof record.url === "string" && record.url.length > 0;
  const hasFileRef =
    typeof record.fileId === "string" && record.fileId.length > 0;

  // Either shape is acceptable: legacy data-URL `url` (pre-task-174) or the
  // new `fileId`/`fileUrl` pair pointing at a real files row. Records that
  // carry neither identifier are unreadable and would render a broken
  // thumbnail, so they are dropped at the boundary.
  if (!hasLegacyUrl && !hasFileRef) {
    return false;
  }

  // Coerce in place so the hydrated shape always carries every field; the
  // FE's discriminator just checks for `fileUrl` presence.
  if (typeof record.url !== "string") record.url = null;
  if (typeof record.mimeType !== "string") record.mimeType = null;
  if (typeof record.fileId !== "string") record.fileId = null;
  if (typeof record.fileUrl !== "string") record.fileUrl = null;
  return true;
}

function normalizeCommentReactions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, string[]>;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([emoji, userIds]) => [
    emoji,
    normalizeCommentArrayValue(userIds, isStringArrayValue),
  ]);

  return Object.fromEntries(entries);
}

async function loadDailyLogComments(dailyLogId: string) {
  const rows = await db
    .select({
      id: dailyLogComments.id,
      dailyLogId: dailyLogComments.dailyLogId,
      parentCommentId: dailyLogComments.parentCommentId,
      body: dailyLogComments.body,
      mentions: dailyLogComments.mentions,
      attachments: dailyLogComments.attachments,
      links: dailyLogComments.links,
      reactions: dailyLogComments.reactions,
      createdBy: dailyLogComments.createdBy,
      createdAt: dailyLogComments.createdAt,
      updatedAt: dailyLogComments.updatedAt,
      authorId: users.id,
      authorName: users.fullName,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(dailyLogComments)
    .leftJoin(users, eq(dailyLogComments.createdBy, users.id))
    .where(
      and(
        eq(dailyLogComments.dailyLogId, dailyLogId),
        isNull(dailyLogComments.deletedAt),
      ),
    )
    .orderBy(asc(dailyLogComments.createdAt));

  const byId = new Map<string, HydratedComment>();
  const roots: HydratedComment[] = [];

  for (const row of rows) {
    const comment: HydratedComment = {
      id: row.id,
      dailyLogId: row.dailyLogId,
      parentCommentId: row.parentCommentId,
      body: row.body,
      mentions: normalizeCommentArrayValue(row.mentions, isStringArrayValue),
      attachments: normalizeCommentArrayValue(row.attachments, isCommentAttachmentValue),
      links: normalizeCommentArrayValue(row.links, isStringArrayValue),
      reactions: normalizeCommentReactions(row.reactions),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: {
        id: row.authorId,
        fullName: row.authorName,
        avatarUrl: row.authorAvatarUrl,
      },
      replies: [],
    };

    byId.set(comment.id, comment);
  }

  for (const comment of byId.values()) {
    if (comment.parentCommentId && byId.has(comment.parentCommentId)) {
      byId.get(comment.parentCommentId)?.replies.push(comment);
      continue;
    }

    roots.push(comment);
  }

  return roots;
}

async function loadDailyLogTodos(dailyLogId: string) {
  return db
    .select({
      id: dailyLogTodos.id,
      title: dailyLogTodos.title,
      isComplete: dailyLogTodos.isComplete,
      createdBy: dailyLogTodos.createdBy,
      createdAt: dailyLogTodos.createdAt,
      updatedAt: dailyLogTodos.updatedAt,
      createdByName: users.fullName,
    })
    .from(dailyLogTodos)
    .leftJoin(users, eq(dailyLogTodos.createdBy, users.id))
    .where(eq(dailyLogTodos.dailyLogId, dailyLogId))
    .orderBy(asc(dailyLogTodos.isComplete), asc(dailyLogTodos.createdAt));
}

async function hydrateDailyLog(id: string, currentUserId: string) {
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
      customFieldValues: dailyLogs.customFieldValues,
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
  const [engagement, todos] = await Promise.all([
    loadDailyLogEngagement([id], currentUserId),
    loadDailyLogTodos(id),
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

  const attachmentStatuses = await probeStorageStatuses(
    attachmentRows.map((att) => att.fileUrl),
  );
  const annotatedAttachments = attachmentRows.map((att) => ({
    ...att,
    storageStatus:
      att.fileUrl && attachmentStatuses.get(att.fileUrl) === "ok"
        ? ("ok" as const)
        : ("missing" as const),
  }));

  return {
    log: {
      ...row,
      weatherData: weather.weatherData,
      notifyUserIds: weather.notifyUserIds,
      notifyUsers,
      tags: tagRows.map((tag) => tag.tagName),
      customFieldValues: normalizeCustomFieldValueRecord(row.customFieldValues),
      attachments: annotatedAttachments,
      likesCount: engagement.likesCountByLogId.get(id) ?? 0,
      commentsCount: engagement.commentsCountByLogId.get(id) ?? 0,
      likedByCurrentUser: engagement.likedByCurrentUser.has(id),
      visibilityLabel: deriveVisibilityLabel(row),
      todos,
      todoCount: engagement.todosCountByLogId.get(id) ?? 0,
      completedTodoCount: engagement.completedTodosCountByLogId.get(id) ?? 0,
      status: row.publishedAt ? "published" : "draft",
    },
  };
}

router.get(
  "/jobs/:jobId/daily-logs",
  requireDailyLogJobAccess,
  asyncHandler(async (req, res) => {
    const query = dailyLogListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid daily log query.", query.error.flatten());
    }

    const jobId = getParam(req.params.jobId, "job id");
    await ensureJobExists(jobId);

    const isCursorMode = isCursorModeRequested(req.query as Record<string, unknown>);
    const cursorPayload = query.data.cursor ? decodeCursor(query.data.cursor) : null;
    const cursorLimit = query.data.limit ?? 25;

    const baseConditions = [eq(dailyLogs.jobId, jobId), isNull(dailyLogs.deletedAt)];

    if (query.data.createdBy) {
      baseConditions.push(eq(dailyLogs.createdBy, query.data.createdBy));
    }

    if (query.data.from) {
      baseConditions.push(sql`${dailyLogs.logDate} >= ${query.data.from}`);
    }

    if (query.data.to) {
      baseConditions.push(sql`${dailyLogs.logDate} <= ${query.data.to}`);
    }

    if (query.data.keywords) {
      const search = buildContainsLikePattern(query.data.keywords);
      baseConditions.push(
        sql`(${ilike(dailyLogs.title, search)} or ${ilike(dailyLogs.notes, search)} or ${ilike(dailyLogs.weatherNotes, search)})`,
      );
    }

    const requestedTags = normalizeUniqueStrings([
      ...(query.data.tag ? [query.data.tag] : []),
      ...query.data.tags,
    ]).map((tag) => tag.toLowerCase());

    type DailyLogRow = {
      id: string;
      jobId: string | null;
      logDate: string;
      title: string | null;
      notes: string;
      weatherData: unknown;
      includeWeather: boolean | null;
      includeWeatherNotes: boolean | null;
      weatherNotes: string | null;
      customFieldValues: unknown;
      shareInternalUsers: boolean | null;
      shareSubsVendors: boolean | null;
      shareClient: boolean | null;
      isPrivate: boolean | null;
      createdBy: string | null;
      createdAt: Date;
      updatedAt: Date | null;
      publishedAt: Date | null;
      createdByName: string | null;
    };

    const fetchDailyLogRows = async (
      whereParts: ReturnType<typeof and>[] | unknown[],
      options: { limit?: number; offset?: number } = {},
    ): Promise<DailyLogRow[]> => {
      const baseQuery = db
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
        .where(and(...(whereParts as Parameters<typeof and>)))
        .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt), desc(dailyLogs.id));

      if (options.limit !== undefined && options.offset !== undefined) {
        return await baseQuery.limit(options.limit).offset(options.offset);
      }
      if (options.limit !== undefined) {
        return await baseQuery.limit(options.limit);
      }
      return await baseQuery;
    };

    if (isCursorMode) {
      // Keyset pagination over (logDate desc, createdAt desc, id desc).
      // All filters (visibility, sharedWith, multi-tag) are pushed into
      // SQL so a single `limit + 1` fetch returns exact matches.
      if (cursorPayload) {
        const cursorLogDate = String(cursorPayload.k[0] ?? "");
        const cursorCreatedAtRaw = String(cursorPayload.k[1] ?? "");
        const cursorCreatedAt = new Date(cursorCreatedAtRaw);
        const cursorId = typeof cursorPayload.id === "string" ? cursorPayload.id : "";
        // Validate id is a UUID before it reaches the SQL tuple — otherwise
        // a malformed id would surface as a Postgres cast error, not a 400.
        const uuidPattern =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(cursorLogDate) ||
          Number.isNaN(cursorCreatedAt.getTime()) ||
          !uuidPattern.test(cursorId)
        ) {
          throw new HttpError(400, "Invalid cursor.", undefined, "validation");
        }
      }

      const visibilityFilter = buildDailyLogVisibilityFilter(req.auth!);
      const sharedWithFilter = (() => {
        switch (query.data.sharedWith) {
          case "internal":
            return eq(dailyLogs.shareInternalUsers, true);
          case "subs_vendors":
          case "installers":
            return eq(dailyLogs.shareSubsVendors, true);
          case "client":
          case "estimators":
            return eq(dailyLogs.shareClient, true);
          case "private":
            return eq(dailyLogs.isPrivate, true);
          default:
            return undefined;
        }
      })();

      const conditions: unknown[] = [...baseConditions];
      if (visibilityFilter) {
        conditions.push(visibilityFilter);
      }
      if (sharedWithFilter) {
        conditions.push(sharedWithFilter);
      }
      // Multi-tag "all of" filter: one EXISTS per requested tag (uses
      // the (daily_log_id, tag_name) unique index). lower() to match
      // the case-insensitive page-mode behavior.
      for (const tag of requestedTags) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM ${dailyLogTags} WHERE ${dailyLogTags.dailyLogId} = ${dailyLogs.id} AND lower(${dailyLogTags.tagName}) = ${tag})`,
        );
      }
      if (cursorPayload) {
        const anchorLogDate = String(cursorPayload.k[0]);
        const anchorCreatedAtIso = new Date(
          String(cursorPayload.k[1]),
        ).toISOString();
        const anchorId = cursorPayload.id;
        conditions.push(
          sql`(${dailyLogs.logDate}, ${dailyLogs.createdAt}, ${dailyLogs.id}) < (${anchorLogDate}::date, ${anchorCreatedAtIso}::timestamptz, ${anchorId})`,
        );
      }

      const fetched = await fetchDailyLogRows(conditions, { limit: cursorLimit + 1 });
      const hasMore = fetched.length > cursorLimit;
      const pageRows = hasMore ? fetched.slice(0, cursorLimit) : fetched;
      const pageIds = pageRows.map((row) => row.id);

      const [tagRows, attachmentRows] = await Promise.all([
        pageIds.length > 0
          ? db
              .select({
                dailyLogId: dailyLogTags.dailyLogId,
                tagName: dailyLogTags.tagName,
              })
              .from(dailyLogTags)
              .where(inArray(dailyLogTags.dailyLogId, pageIds))
          : Promise.resolve([]),
        pageIds.length > 0
          ? db
              .select({
                dailyLogId: dailyLogAttachments.dailyLogId,
                total: count(),
              })
              .from(dailyLogAttachments)
              .where(inArray(dailyLogAttachments.dailyLogId, pageIds))
              .groupBy(dailyLogAttachments.dailyLogId)
          : Promise.resolve([]),
      ]);

      const tagsByLogId = new Map<string, string[]>();
      const attachmentCountByLogId = new Map<string, number>();
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

      const engagement = await loadDailyLogEngagement(pageIds, req.auth!.userId);

      const mapped = pageRows.map((row) => {
        const weather = decodeWeatherPayload(
          row.weatherData as Record<string, unknown> | null | undefined,
        );
        return {
          ...row,
          weatherData: weather.weatherData,
          notifyUserIds: weather.notifyUserIds,
          customFieldValues: normalizeCustomFieldValueRecord(row.customFieldValues),
          tags: normalizeUniqueStrings(tagsByLogId.get(row.id) ?? []),
          attachmentCount: attachmentCountByLogId.get(row.id) ?? 0,
          likesCount: engagement.likesCountByLogId.get(row.id) ?? 0,
          commentsCount: engagement.commentsCountByLogId.get(row.id) ?? 0,
          likedByCurrentUser: engagement.likedByCurrentUser.has(row.id),
          visibilityLabel: deriveVisibilityLabel(row),
          todoCount: engagement.todosCountByLogId.get(row.id) ?? 0,
          completedTodoCount: engagement.completedTodosCountByLogId.get(row.id) ?? 0,
          status: row.publishedAt ? "published" : "draft",
        };
      });

      const last = mapped[mapped.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              v: 1,
              k: [last.logDate, last.createdAt.toISOString()],
              id: last.id,
            })
          : null;

      res.json({
        logs: mapped,
        pagination: {
          limit: cursorLimit,
          hasMore,
          nextCursor,
        },
      });
      return;
    }

    // Page mode: push visibility, sharedWith, multi-tag filters and the
    // (limit, offset) page slice into SQL so we never load more than one
    // page of rows into memory regardless of how many logs the job has.
    const visibilityFilter = buildDailyLogVisibilityFilter(req.auth!);
    const sharedWithFilter = (() => {
      switch (query.data.sharedWith) {
        case "internal":
          return eq(dailyLogs.shareInternalUsers, true);
        case "subs_vendors":
        case "installers":
          return eq(dailyLogs.shareSubsVendors, true);
        case "client":
        case "estimators":
          return eq(dailyLogs.shareClient, true);
        case "private":
          return eq(dailyLogs.isPrivate, true);
        default:
          return undefined;
      }
    })();

    const pageConditions: unknown[] = [...baseConditions];
    if (visibilityFilter) {
      pageConditions.push(visibilityFilter);
    }
    if (sharedWithFilter) {
      pageConditions.push(sharedWithFilter);
    }
    // Multi-tag "all of" filter via one EXISTS per requested tag (matches
    // the case-insensitive cursor-mode behavior and uses the
    // (daily_log_id, tag_name) unique index).
    for (const tag of requestedTags) {
      pageConditions.push(
        sql`EXISTS (SELECT 1 FROM ${dailyLogTags} WHERE ${dailyLogTags.dailyLogId} = ${dailyLogs.id} AND lower(${dailyLogTags.tagName}) = ${tag})`,
      );
    }

    const pageOffset = (query.data.page - 1) * query.data.pageSize;
    const [[totalRow], pageRows] = await Promise.all([
      db
        .select({ total: count() })
        .from(dailyLogs)
        .where(and(...(pageConditions as Parameters<typeof and>))),
      fetchDailyLogRows(pageConditions, {
        limit: query.data.pageSize,
        offset: pageOffset,
      }),
    ]);

    const totalItems = Number(totalRow?.total ?? 0);
    const pageIds = pageRows.map((row) => row.id);

    const [tagRows, attachmentRows] = await Promise.all([
      pageIds.length > 0
        ? db
            .select({
              dailyLogId: dailyLogTags.dailyLogId,
              tagName: dailyLogTags.tagName,
            })
            .from(dailyLogTags)
            .where(inArray(dailyLogTags.dailyLogId, pageIds))
        : Promise.resolve([]),
      pageIds.length > 0
        ? db
            .select({
              dailyLogId: dailyLogAttachments.dailyLogId,
              total: count(),
            })
            .from(dailyLogAttachments)
            .where(inArray(dailyLogAttachments.dailyLogId, pageIds))
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

    const engagement = await loadDailyLogEngagement(pageIds, req.auth!.userId);

    const mapped = pageRows.map((row) => {
      const weather = decodeWeatherPayload(
        row.weatherData as Record<string, unknown> | null | undefined,
      );

      return {
        ...row,
        weatherData: weather.weatherData,
        notifyUserIds: weather.notifyUserIds,
        customFieldValues: normalizeCustomFieldValueRecord(row.customFieldValues),
        tags: normalizeUniqueStrings(tagsByLogId.get(row.id) ?? []),
        attachmentCount: attachmentCountByLogId.get(row.id) ?? 0,
        likesCount: engagement.likesCountByLogId.get(row.id) ?? 0,
        commentsCount: engagement.commentsCountByLogId.get(row.id) ?? 0,
        likedByCurrentUser: engagement.likedByCurrentUser.has(row.id),
        visibilityLabel: deriveVisibilityLabel(row),
        todoCount: engagement.todosCountByLogId.get(row.id) ?? 0,
        completedTodoCount: engagement.completedTodosCountByLogId.get(row.id) ?? 0,
        status: row.publishedAt ? "published" : "draft",
      };
    });

    res.json({
      logs: mapped,
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
  requireDailyLogJobAccess,
  asyncHandler(async (req, res) => {
    const body = dailyLogPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid daily log payload.", body.error.flatten());
    }

    const jobId = body.data.jobId ?? getParam(req.params.jobId, "job id");
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
        customFieldValues: body.data.customFieldValues,
        shareInternalUsers: body.data.shareInternalUsers,
        shareSubsVendors: body.data.shareSubsVendors,
        shareClient: body.data.shareClient,
        isPrivate: body.data.isPrivate,
        createdBy: req.auth!.userId,
      })
      .returning();

    await syncDailyLogTags(log.id, body.data.tags);

    await writeActivity({
      entityType: "daily_log",
      entityId: log.id,
      action: "created",
      userId: req.auth!.userId,
      jobId,
      description: `Created daily log ${body.data.title || body.data.logDate}`,
      extra: {
        dailyLogId: log.id,
      },
    });

    const hydrated = await hydrateDailyLog(log.id, req.auth!.userId);
    res.status(201).json(hydrated);
  }),
);

const companyDailyLogFeedQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(25),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  keywords: z.string().trim().optional(),
  clientId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  hasAttachments: z.coerce.boolean().optional(),
  hasComments: z.coerce.boolean().optional(),
});

router.get(
  "/daily-logs/feed",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const query = companyDailyLogFeedQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new HttpError(400, "Invalid daily log feed query.", query.error.flatten());
    }

    const auth = req.auth!;
    const accessibleJobIds = await listAccessibleJobIds(auth);
    const isCursorMode = isCursorModeRequested(req.query as Record<string, unknown>);
    const cursorPayload = query.data.cursor ? decodeCursor(query.data.cursor) : null;
    const cursorLimit = query.data.limit ?? 25;

    if (accessibleJobIds && accessibleJobIds.length === 0) {
      res.json({
        logs: [],
        pagination: isCursorMode
          ? { limit: cursorLimit, hasMore: false, nextCursor: null }
          : {
              page: query.data.page,
              pageSize: query.data.pageSize,
              totalItems: 0,
              totalPages: 1,
            },
      });
      return;
    }

    const baseConditions: unknown[] = [
      isNull(dailyLogs.deletedAt),
      isNull(jobs.deletedAt),
    ];
    const visibilityFilter = buildDailyLogVisibilityFilter(auth);
    if (visibilityFilter) baseConditions.push(visibilityFilter);
    if (accessibleJobIds) baseConditions.push(inArray(dailyLogs.jobId, accessibleJobIds));
    if (query.data.clientId) baseConditions.push(eq(jobs.clientId, query.data.clientId));
    if (query.data.jobId) baseConditions.push(eq(dailyLogs.jobId, query.data.jobId));
    if (query.data.createdBy) baseConditions.push(eq(dailyLogs.createdBy, query.data.createdBy));
    if (query.data.from) baseConditions.push(sql`${dailyLogs.logDate} >= ${query.data.from}`);
    if (query.data.to) baseConditions.push(sql`${dailyLogs.logDate} <= ${query.data.to}`);
    if (query.data.keywords) {
      const search = buildContainsLikePattern(query.data.keywords);
      baseConditions.push(
        sql`(${ilike(dailyLogs.title, search)} or ${ilike(dailyLogs.notes, search)} or ${ilike(dailyLogs.weatherNotes, search)})`,
      );
    }
    if (query.data.hasAttachments) {
      baseConditions.push(
        sql`EXISTS (SELECT 1 FROM ${dailyLogAttachments} WHERE ${dailyLogAttachments.dailyLogId} = ${dailyLogs.id})`,
      );
    }
    if (query.data.hasComments) {
      baseConditions.push(
        sql`EXISTS (SELECT 1 FROM ${dailyLogComments} WHERE ${dailyLogComments.dailyLogId} = ${dailyLogs.id})`,
      );
    }

    type FeedRow = {
      id: string;
      jobId: string | null;
      jobTitle: string | null;
      clientId: string | null;
      clientName: string | null;
      logDate: string;
      title: string | null;
      notes: string;
      weatherData: unknown;
      includeWeather: boolean | null;
      includeWeatherNotes: boolean | null;
      weatherNotes: string | null;
      customFieldValues: unknown;
      shareInternalUsers: boolean | null;
      shareSubsVendors: boolean | null;
      shareClient: boolean | null;
      isPrivate: boolean | null;
      createdBy: string | null;
      createdAt: Date;
      updatedAt: Date | null;
      publishedAt: Date | null;
      createdByName: string | null;
    };

    const fetchFeedRows = async (
      whereParts: unknown[],
      options: { limit?: number; offset?: number } = {},
    ): Promise<FeedRow[]> => {
      const baseQuery = db
        .select({
          id: dailyLogs.id,
          jobId: dailyLogs.jobId,
          jobTitle: jobs.title,
          clientId: jobs.clientId,
          clientName: clients.companyName,
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
        .leftJoin(jobs, eq(dailyLogs.jobId, jobs.id))
        .leftJoin(clients, eq(jobs.clientId, clients.id))
        .leftJoin(users, eq(dailyLogs.createdBy, users.id))
        .where(and(...(whereParts as Parameters<typeof and>)))
        .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt), desc(dailyLogs.id));
      if (options.limit !== undefined && options.offset !== undefined) {
        return await baseQuery.limit(options.limit).offset(options.offset);
      }
      if (options.limit !== undefined) {
        return await baseQuery.limit(options.limit);
      }
      return await baseQuery;
    };

    const enrich = async (pageRows: FeedRow[]) => {
      const pageIds = pageRows.map((row) => row.id);
      const [tagRows, attachmentRows] = await Promise.all([
        pageIds.length > 0
          ? db
              .select({ dailyLogId: dailyLogTags.dailyLogId, tagName: dailyLogTags.tagName })
              .from(dailyLogTags)
              .where(inArray(dailyLogTags.dailyLogId, pageIds))
          : Promise.resolve([]),
        pageIds.length > 0
          ? db
              .select({ dailyLogId: dailyLogAttachments.dailyLogId, total: count() })
              .from(dailyLogAttachments)
              .where(inArray(dailyLogAttachments.dailyLogId, pageIds))
              .groupBy(dailyLogAttachments.dailyLogId)
          : Promise.resolve([]),
      ]);
      const tagsByLogId = new Map<string, string[]>();
      const attachmentCountByLogId = new Map<string, number>();
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
      const engagement = await loadDailyLogEngagement(pageIds, auth.userId);
      return pageRows.map((row) => {
        const weather = decodeWeatherPayload(
          row.weatherData as Record<string, unknown> | null | undefined,
        );
        return {
          ...row,
          weatherData: weather.weatherData,
          notifyUserIds: weather.notifyUserIds,
          customFieldValues: normalizeCustomFieldValueRecord(row.customFieldValues),
          tags: normalizeUniqueStrings(tagsByLogId.get(row.id) ?? []),
          attachmentCount: attachmentCountByLogId.get(row.id) ?? 0,
          likesCount: engagement.likesCountByLogId.get(row.id) ?? 0,
          commentsCount: engagement.commentsCountByLogId.get(row.id) ?? 0,
          likedByCurrentUser: engagement.likedByCurrentUser.has(row.id),
          visibilityLabel: deriveVisibilityLabel(row),
          todoCount: engagement.todosCountByLogId.get(row.id) ?? 0,
          completedTodoCount: engagement.completedTodosCountByLogId.get(row.id) ?? 0,
          status: row.publishedAt ? "published" : "draft",
        };
      });
    };

    if (isCursorMode) {
      if (cursorPayload) {
        const cursorLogDate = String(cursorPayload.k[0] ?? "");
        const cursorCreatedAtRaw = String(cursorPayload.k[1] ?? "");
        const cursorCreatedAt = new Date(cursorCreatedAtRaw);
        const cursorId = typeof cursorPayload.id === "string" ? cursorPayload.id : "";
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(cursorLogDate) ||
          Number.isNaN(cursorCreatedAt.getTime()) ||
          !uuidPattern.test(cursorId)
        ) {
          throw new HttpError(400, "Invalid cursor.", undefined, "validation");
        }
        const anchorCreatedAtIso = cursorCreatedAt.toISOString();
        baseConditions.push(
          sql`(${dailyLogs.logDate}, ${dailyLogs.createdAt}, ${dailyLogs.id}) < (${cursorLogDate}::date, ${anchorCreatedAtIso}::timestamptz, ${cursorId})`,
        );
      }
      const fetched = await fetchFeedRows(baseConditions, { limit: cursorLimit + 1 });
      const hasMore = fetched.length > cursorLimit;
      const pageRows = hasMore ? fetched.slice(0, cursorLimit) : fetched;
      const mapped = await enrich(pageRows);
      const last = mapped[mapped.length - 1];
      const nextCursor = hasMore && last
        ? encodeCursor({ v: 1, k: [last.logDate, last.createdAt.toISOString()], id: last.id })
        : null;
      res.json({
        logs: mapped,
        pagination: { limit: cursorLimit, hasMore, nextCursor },
      });
      return;
    }

    const pageOffset = (query.data.page - 1) * query.data.pageSize;
    const [[totalRow], pageRows] = await Promise.all([
      db
        .select({ total: count() })
        .from(dailyLogs)
        .leftJoin(jobs, eq(dailyLogs.jobId, jobs.id))
        .where(and(...(baseConditions as Parameters<typeof and>))),
      fetchFeedRows(baseConditions, {
        limit: query.data.pageSize,
        offset: pageOffset,
      }),
    ]);
    const totalItems = Number(totalRow?.total ?? 0);
    const mapped = await enrich(pageRows);
    res.json({
      logs: mapped,
      pagination: {
        page: query.data.page,
        pageSize: query.data.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.data.pageSize)),
      },
    });
  }),
);

router.get(
  "/daily-logs/:id",
  requireDailyLogViewAccess,
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const hydrated = await hydrateDailyLog(logId, req.auth!.userId);
    res.json(hydrated);
  }),
);

router.put(
  "/daily-logs/:id",
  requireDailyLogEditAccess,
  asyncHandler(async (req, res) => {
    const body = dailyLogPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid daily log payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const existing = await getDailyLogOrThrow(logId);
    const nextJobId = body.data.jobId ?? existing.jobId;

    if (!nextJobId) {
      throw new HttpError(400, "Daily log is missing a job.");
    }

    await ensureJobExists(nextJobId);
    await assertCanAccessJobFeature(req.auth!, nextJobId, "dailyLogs");

    await db
      .update(dailyLogs)
      .set({
        jobId: nextJobId,
        logDate: body.data.logDate,
        title: body.data.title,
        notes: body.data.notes,
        weatherData: encodeWeatherPayload(body.data.weatherData, body.data.notifyUserIds),
        includeWeather: body.data.includeWeather,
        includeWeatherNotes: body.data.includeWeatherNotes,
        weatherNotes: body.data.weatherNotes,
        customFieldValues: body.data.customFieldValues,
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
      userId: req.auth!.userId,
      jobId: nextJobId,
      description: `Updated daily log ${body.data.title || body.data.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    const hydrated = await hydrateDailyLog(logId, req.auth!.userId);
    res.json(hydrated);
  }),
);

router.delete(
  "/daily-logs/:id",
  requireDailyLogEditAccess,
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
      userId: req.auth!.userId,
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
  requireDailyLogContributorAccess,
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

    const hydrated = await hydrateDailyLog(logId, req.auth!.userId);

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
      userId: req.auth!.userId,
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
    }, hydrated.log.jobId);

    res.json(hydrated);
  }),
);

router.get(
  "/weather",
  asyncHandler(async (req, res) => {
    const query = weatherQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid weather query.", query.error.flatten());
    }

    // For "today" lookups we go through the shared 1-hour cache so repeated
    // calls (e.g. the crew Home device-geolocation fallback) don't spam
    // Open-Meteo. Date-specific lookups (used by the daily log editor when
    // backfilling weather for a past day) bypass the cache because they're
    // bounded by the user explicitly picking a date.
    const today = new Date().toISOString().slice(0, 10);
    const isToday = !query.data.date || query.data.date === today;

    let weather;
    if (typeof query.data.address === "string") {
      weather = isToday
        ? (await getCachedForecastForAddress(query.data.address)) ??
          (await fetchWeatherForAddress(query.data.address, query.data.date))
        : await fetchWeatherForAddress(query.data.address, query.data.date);
    } else {
      const coords = {
        latitude: query.data.lat as number,
        longitude: query.data.lng as number,
      };
      weather = isToday
        ? (await getCachedForecastForCoords(coords)) ??
          (await fetchWeatherForCoords(coords, query.data.date))
        : await fetchWeatherForCoords(coords, query.data.date);
    }
    res.json({ weather });
  }),
);

router.post(
  "/daily-logs/:id/like",
  requireDailyLogViewAccess,
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);
    const dailyLogJobId = requireDailyLogJobId(dailyLog);

    const { liked, likesCount } = await db.transaction(async (tx) => {
      const [existingLike] = await tx
        .select({ id: dailyLogLikes.id })
        .from(dailyLogLikes)
        .where(
          and(
            eq(dailyLogLikes.dailyLogId, logId),
            eq(dailyLogLikes.userId, req.auth!.userId),
          ),
        )
        .limit(1);

      let nextLiked = false;

      if (existingLike) {
        await tx.delete(dailyLogLikes).where(eq(dailyLogLikes.id, existingLike.id));
      } else {
        await tx.insert(dailyLogLikes).values({
          id: crypto.randomUUID(),
          dailyLogId: logId,
          userId: req.auth!.userId,
        });
        nextLiked = true;
      }

      const [totalRow] = await tx
        .select({ total: count() })
        .from(dailyLogLikes)
        .where(eq(dailyLogLikes.dailyLogId, logId));

      return {
        liked: nextLiked,
        likesCount: Number(totalRow?.total ?? 0),
      };
    });

    await writeActivity({
      entityType: "daily_log",
      entityId: logId,
      action: liked ? "liked" : "unliked",
      userId: req.auth!.userId,
      jobId: dailyLogJobId,
      description: `${liked ? "Liked" : "Unliked"} daily log ${dailyLog.title || dailyLog.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    res.json({
      liked,
      likesCount,
    });
  }),
);

router.get(
  "/daily-logs/:id/comments",
  requireDailyLogViewAccess,
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    await getDailyLogOrThrow(logId);
    const comments = await loadDailyLogComments(logId);
    res.json({ comments });
  }),
);

router.post(
  "/daily-logs/:id/comments",
  requireDailyLogViewAccess,
  asyncHandler(async (req, res) => {
    const body = commentPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid comment payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);
    const dailyLogJobId = requireDailyLogJobId(dailyLog);

    if (body.data.parentCommentId) {
      const [parent] = await db
        .select({ id: dailyLogComments.id })
        .from(dailyLogComments)
        .where(
          and(
            eq(dailyLogComments.id, body.data.parentCommentId),
            eq(dailyLogComments.dailyLogId, logId),
            isNull(dailyLogComments.deletedAt),
          ),
        )
        .limit(1);

      if (!parent) {
        throw new HttpError(404, "Parent comment not found.");
      }
    }

    // Resolve fileId references to the underlying files row, but only allow
    // attachments that this user uploaded into THIS daily log's
    // comment-attachments folder. That stops a caller from grafting an
    // arbitrary file they happen to know the id of (e.g. another job's
    // private photo) onto a comment.
    let resolvedAttachments: Array<{
      fileId: string;
      fileUrl: string;
      name: string;
      mimeType: string | null;
    }> = [];

    if (body.data.attachments.length > 0) {
      const fileIds = body.data.attachments.map((a) => a.fileId);
      const commentFolder = await ensureDailyLogCommentAttachmentFolder(logId);
      const fileRows = await db
        .select({
          id: files.id,
          fileUrl: files.fileUrl,
          originalName: files.originalName,
          mimeType: files.mimeType,
        })
        .from(files)
        .where(
          and(
            inArray(files.id, fileIds),
            eq(files.folderId, commentFolder.id),
            eq(files.uploadedBy, req.auth!.userId),
          ),
        );

      const byId = new Map(fileRows.map((f) => [f.id, f]));
      // Reject the whole comment if any fileId is unknown / not owned by the
      // caller / not in this daily log's comment folder. Silently dropping
      // would let attachments vanish without explanation; a 400 surfaces the
      // mistake to the FE.
      for (const fileId of fileIds) {
        if (!byId.has(fileId)) {
          throw new HttpError(
            400,
            "One or more comment attachments could not be resolved.",
          );
        }
      }

      resolvedAttachments = fileIds.map((fileId) => {
        const row = byId.get(fileId)!;
        // files.fileUrl is column-nullable but the comment-attachments
        // upload route always writes it, so a null here would mean a row
        // we did not author — surface as 400 rather than persist a broken
        // attachment record.
        if (!row.fileUrl) {
          throw new HttpError(
            400,
            "One or more comment attachments are missing a stored file.",
          );
        }
        return {
          fileId: row.id,
          fileUrl: row.fileUrl,
          name: row.originalName,
          mimeType: row.mimeType ?? null,
        };
      });
    }

    const [comment] = await db
      .insert(dailyLogComments)
      .values({
        id: crypto.randomUUID(),
        dailyLogId: logId,
        parentCommentId: body.data.parentCommentId,
        createdBy: req.auth!.userId,
        body: body.data.body,
        mentions: body.data.mentions,
        attachments: resolvedAttachments,
        links: body.data.links,
        reactions: {},
      })
      .returning({ id: dailyLogComments.id });

    await writeActivity({
      entityType: "daily_log_comment",
      entityId: comment.id,
      action: body.data.parentCommentId ? "replied" : "commented",
      userId: req.auth!.userId,
      jobId: dailyLogJobId,
      description: `${body.data.parentCommentId ? "Replied on" : "Commented on"} daily log ${dailyLog.title || dailyLog.logDate}`,
      extra: {
        dailyLogId: logId,
        commentId: comment.id,
      },
    });

    const comments = await loadDailyLogComments(logId);
    res.status(201).json({ comments });
  }),
);

router.post(
  "/daily-logs/:id/comments/:commentId/reactions",
  requireDailyLogViewAccess,
  asyncHandler(async (req, res) => {
    const body = commentReactionPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid reaction payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const commentId = getParam(req.params.commentId, "comment id");
    await getDailyLogOrThrow(logId);

    await db.transaction(async (tx) => {
      const [comment] = await tx
        .select({
          id: dailyLogComments.id,
          reactions: dailyLogComments.reactions,
        })
        .from(dailyLogComments)
        .where(
          and(
            eq(dailyLogComments.id, commentId),
            eq(dailyLogComments.dailyLogId, logId),
            isNull(dailyLogComments.deletedAt),
          ),
        )
        .limit(1);

      if (!comment) {
        throw new HttpError(404, "Comment not found.");
      }

      const reactions = normalizeCommentReactions(comment.reactions);
      const current = new Set(reactions[body.data.emoji] ?? []);

      if (current.has(req.auth!.userId)) {
        current.delete(req.auth!.userId);
      } else {
        current.add(req.auth!.userId);
      }

      reactions[body.data.emoji] = Array.from(current);

      if (reactions[body.data.emoji].length === 0) {
        delete reactions[body.data.emoji];
      }

      await tx
        .update(dailyLogComments)
        .set({
          reactions,
          updatedAt: new Date(),
        })
        .where(eq(dailyLogComments.id, commentId));
    });

    const comments = await loadDailyLogComments(logId);
    res.json({ comments });
  }),
);

router.post(
  "/daily-logs/:id/todos",
  requireDailyLogViewAccess,
  asyncHandler(async (req, res) => {
    const body = todoPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid to-do payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);
    const dailyLogJobId = requireDailyLogJobId(dailyLog);

    const [todo] = await db
      .insert(dailyLogTodos)
      .values({
        id: crypto.randomUUID(),
        dailyLogId: logId,
        title: body.data.title,
        isComplete: false,
        createdBy: req.auth!.userId,
      })
      .returning({ id: dailyLogTodos.id });

    await writeActivity({
      entityType: "daily_log_todo",
      entityId: todo.id,
      action: "created",
      userId: req.auth!.userId,
      jobId: dailyLogJobId,
      description: `Added to-do for daily log ${dailyLog.title || dailyLog.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    const todos = await loadDailyLogTodos(logId);
    res.status(201).json({ todos });
  }),
);

router.post(
  "/daily-logs/:id/todos/:todoId/toggle",
  requireDailyLogViewAccess,
  asyncHandler(async (req, res) => {
    const body = todoTogglePayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid to-do toggle payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const todoId = getParam(req.params.todoId, "to-do id");
    await getDailyLogOrThrow(logId);

    const [todo] = await db
      .select({
        id: dailyLogTodos.id,
        isComplete: dailyLogTodos.isComplete,
      })
      .from(dailyLogTodos)
      .where(
        and(
          eq(dailyLogTodos.id, todoId),
          eq(dailyLogTodos.dailyLogId, logId),
        ),
      )
      .limit(1);

    if (!todo) {
      throw new HttpError(404, "To-do not found.");
    }

    await db
      .update(dailyLogTodos)
      .set({
        isComplete: body.data.isComplete ?? !todo.isComplete,
        updatedAt: new Date(),
      })
      .where(eq(dailyLogTodos.id, todoId));

    const todos = await loadDailyLogTodos(logId);
    res.json({ todos });
  }),
);

router.post(
  "/daily-logs/:id/comment-attachments",
  requireDailyLogViewAccess,
  uploadRateLimit,
  // Comment-attachment uploads are gated by view access (the same level the
  // /comments POST runs under) so anyone allowed to comment can attach. The
  // per-file size cap is tighter than the daily-log attachment cap because
  // these are inline comment images, not first-class log artifacts; the
  // count cap mirrors MAX_COMMENT_ATTACHMENTS so the multer-level rejection
  // and the JSON-level rejection on /comments stay aligned.
  uploadArray("files", MAX_COMMENT_ATTACHMENTS, {
    fileSize: MAX_COMMENT_ATTACHMENT_BYTES,
    files: MAX_COMMENT_ATTACHMENTS,
  }),
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    await getDailyLogOrThrow(logId);
    const commentFolder = await ensureDailyLogCommentAttachmentFolder(logId);
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (uploadedFiles.length === 0) {
      throw new HttpError(400, "At least one attachment is required.");
    }

    const created: Array<{
      id: string;
      originalName: string;
      mimeType: string | null;
      fileSize: number | null;
      fileUrl: string | null;
      createdAt: Date | null;
    }> = [];

    for (const uploadedFile of uploadedFiles) {
      // Shared blocklist gate (executables, shell scripts, web files that
      // could run in a browser session). The magic-byte sniffer upstream
      // of this is the authoritative content-level check.
      validateUploadForMediaType("photo", uploadedFile);

      const storedFileName = buildStoredFileName(uploadedFile.originalname);
      const uploadPath = buildUploadPath({
        jobId: `daily-log-${logId}-comments`,
        mediaType: "photo",
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

      // Same upload-rollback contract as the daily-log attachments route:
      // any failure after the storage write is followed by deleting both
      // the freshly inserted files row and the just-written object so the
      // two stores can never disagree.
      const file = await persistWithStorageRollback({
        fileUrl: uploadPath.fileUrl,
        context: "daily-log-comment-attachment-upload:rollback",
        persist: async () => {
          const [createdFile] = await db
            .insert(files)
            .values({
              folderId: commentFolder.id,
              filename: storedFileName,
              originalName: uploadedFile.originalname,
              fileUrl: uploadPath.fileUrl,
              fileSize: uploadedFile.size,
              mimeType: uploadedFile.mimetype,
              uploadedBy: req.auth!.userId,
            })
            .returning();
          return createdFile;
        },
        rollback: async (createdFile) => {
          await db.delete(files).where(eq(files.id, createdFile.id));
        },
      });

      created.push({
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        fileUrl: file.fileUrl,
        createdAt: file.createdAt,
      });
    }

    res.status(201).json({ files: created });
  }),
);

router.post(
  "/daily-logs/:id/attachments",
  requireDailyLogContributorAccess,
  uploadRateLimit,
  uploadArray("files", 20),
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);
    const dailyLogJobId = requireDailyLogJobId(dailyLog);
    const attachmentFolder = await ensureDailyLogAttachmentFolder(logId);
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (uploadedFiles.length === 0) {
      throw new HttpError(400, "At least one attachment is required.");
    }

    const attachments = [];

    for (const uploadedFile of uploadedFiles) {
      // Daily logs accept docs, photos, and videos so workers can drop a
      // phone snapshot straight into the field log. Pick the right
      // mediaType per file so HEIC/MOV land under the photo/video
      // subfolder (and pass the matching allowlist) rather than getting
      // rejected by the document-only validator.
      const ext = path.extname(uploadedFile.originalname ?? "").toLowerCase();
      const mediaType: "photo" | "video" | "document" = photoExtensions.includes(ext)
        ? "photo"
        : videoExtensions.includes(ext)
          ? "video"
          : "document";
      validateUploadForMediaType(mediaType, uploadedFile);

      const storedFileName = buildStoredFileName(uploadedFile.originalname);
      const uploadPath = buildUploadPath({
        jobId: `daily-log-${logId}`,
        mediaType,
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

      // Wrap the DB inserts and the activity log write in a single
      // upload-rollback boundary. The persist step uses a transaction so
      // a half-written pair (file row without attachment) cannot
      // escape. If the activity log write fails after the transaction
      // commits, the rollback callback removes the committed rows and
      // the helper deletes the freshly uploaded object so storage and
      // database stay in sync.
      const { file, attachment } = await persistWithStorageRollback({
        fileUrl: uploadPath.fileUrl,
        context: "daily-log-attachment-upload:rollback",
        persist: async () =>
          await db.transaction(async (tx) => {
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
              .insert(dailyLogAttachments)
              .values({
                dailyLogId: logId,
                fileId: createdFile.id,
              })
              .returning({
                id: dailyLogAttachments.id,
              });

            return { file: createdFile, attachment: createdAttachment };
          }),
        postCommit: async ({ file: createdFile, attachment: createdAttachment }) => {
          await writeActivity({
            entityType: "daily_log_attachment",
            entityId: createdAttachment.id,
            action: "uploaded",
            userId: req.auth!.userId,
            jobId: dailyLogJobId,
            description: `Uploaded ${createdFile.originalName} to daily log ${dailyLog.title || dailyLog.logDate}`,
            extra: {
              dailyLogId: logId,
              fileId: createdFile.id,
            },
          });
        },
        rollback: async ({ file: createdFile, attachment: createdAttachment }) => {
          await db
            .delete(dailyLogAttachments)
            .where(eq(dailyLogAttachments.id, createdAttachment.id));
          await db.delete(files).where(eq(files.id, createdFile.id));
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
        storageStatus: "ok" as const,
      });
    }

    res.status(201).json({ attachments });
  }),
);

router.delete(
  "/daily-logs/:id/attachments/:attachmentId",
  requireDailyLogEditAccess,
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const attachmentId = getParam(req.params.attachmentId, "attachment id");
    const dailyLog = await getDailyLogOrThrow(logId);
    const dailyLogJobId = requireDailyLogJobId(dailyLog);

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
      userId: req.auth!.userId,
      jobId: dailyLogJobId,
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
