import crypto from "node:crypto";
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
import { ensureDailyLogConfigTables } from "../lib/daily-log-support";

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

const commentAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  url: z.string().trim().min(1),
  mimeType: optionalString,
});

const commentPayloadSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  parentCommentId: z.string().uuid().nullable().optional().default(null),
  mentions: z.array(z.string().uuid()).optional().default([]),
  attachments: z.array(commentAttachmentSchema).optional().default([]),
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
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
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

const weatherQuerySchema = z.object({
  address: z.string().trim().min(1).max(500),
  date: optionalDate,
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

let ensureDailyLogSupportTablesPromise: Promise<void> | null = null;

async function ensureDailyLogSupportTables() {
  if (!ensureDailyLogSupportTablesPromise) {
    ensureDailyLogSupportTablesPromise = (async () => {
      await db.execute(sql`
        create table if not exists daily_log_likes (
          id uuid primary key,
          daily_log_id uuid not null references daily_logs(id) on delete cascade,
          user_id uuid not null references users(id) on delete cascade,
          created_at timestamp not null default now(),
          unique (daily_log_id, user_id)
        )
      `);
      await db.execute(sql`
        create index if not exists daily_log_likes_log_id_idx
        on daily_log_likes (daily_log_id)
      `);
      await db.execute(sql`
        create table if not exists daily_log_comments (
          id uuid primary key,
          daily_log_id uuid not null references daily_logs(id) on delete cascade,
          parent_comment_id uuid references daily_log_comments(id) on delete cascade,
          created_by uuid references users(id),
          body text not null,
          mentions json,
          attachments json,
          links json,
          reactions json,
          created_at timestamp not null default now(),
          updated_at timestamp not null default now(),
          deleted_at timestamp
        )
      `);
      await db.execute(sql`
        create index if not exists daily_log_comments_log_id_idx
        on daily_log_comments (daily_log_id)
      `);
      await db.execute(sql`
        create index if not exists daily_log_comments_parent_comment_id_idx
        on daily_log_comments (parent_comment_id)
      `);
      await db.execute(sql`
        create table if not exists daily_log_todos (
          id uuid primary key,
          daily_log_id uuid not null references daily_logs(id) on delete cascade,
          title varchar(255) not null,
          is_complete boolean default false,
          created_by uuid references users(id),
          created_at timestamp not null default now(),
          updated_at timestamp not null default now()
        )
      `);
      await db.execute(sql`
        create index if not exists daily_log_todos_log_id_idx
        on daily_log_todos (daily_log_id)
      `);
      await ensureDailyLogConfigTables();
    })().catch((error) => {
      ensureDailyLogSupportTablesPromise = null;
      throw error;
    });
  }

  await ensureDailyLogSupportTablesPromise;
}

function sanitizeWeatherIcon(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("snow")) {
    return "snow";
  }

  if (normalized.includes("storm") || normalized.includes("thunder")) {
    return "storm";
  }

  if (
    normalized.includes("rain") ||
    normalized.includes("drizzle") ||
    normalized.includes("shower")
  ) {
    return "rain";
  }

  if (normalized.includes("cloud") || normalized.includes("overcast") || normalized.includes("fog")) {
    return "cloud";
  }

  return "sun";
}

function weatherCodeToCondition(code: number) {
  if (code === 0) return "Sunny";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code >= 45 && code <= 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "Unknown";
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
  await ensureDailyLogSupportTables();

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
  attachments: Array<{
    name: string;
    url: string;
    mimeType: string | null;
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
): value is { name: string; url: string; mimeType: string | null } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { url?: unknown }).url === "string"
  );
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
  await ensureDailyLogSupportTables();

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
  await ensureDailyLogSupportTables();

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

async function fetchWeatherSnapshot(address: string, dateValue: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = dateValue ?? today;
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", address);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("language", "en");
  geoUrl.searchParams.set("format", "json");

  const geoResponse = await fetch(geoUrl);

  if (!geoResponse.ok) {
    throw new HttpError(502, "Weather geocoding failed.");
  }

  const geoPayload = (await geoResponse.json()) as {
    results?: Array<{ latitude: number; longitude: number; name?: string }>;
  };
  const match = geoPayload.results?.[0];

  if (!match) {
    throw new HttpError(404, "Unable to locate that address for weather lookup.");
  }

  const isPast = targetDate < today;
  const weatherUrl = new URL(
    isPast
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast",
  );

  weatherUrl.searchParams.set("latitude", String(match.latitude));
  weatherUrl.searchParams.set("longitude", String(match.longitude));
  weatherUrl.searchParams.set("temperature_unit", "fahrenheit");
  weatherUrl.searchParams.set("wind_speed_unit", "mph");
  weatherUrl.searchParams.set("precipitation_unit", "inch");
  weatherUrl.searchParams.set("timezone", "auto");
  weatherUrl.searchParams.set("start_date", targetDate);
  weatherUrl.searchParams.set("end_date", targetDate);
  weatherUrl.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
  );
  weatherUrl.searchParams.set("hourly", "relative_humidity_2m,wind_speed_10m");

  const weatherResponse = await fetch(weatherUrl);

  if (!weatherResponse.ok) {
    throw new HttpError(502, "Weather lookup failed.");
  }

  const payload = (await weatherResponse.json()) as {
    daily?: {
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_sum?: number[];
    };
    hourly?: {
      relative_humidity_2m?: number[];
      wind_speed_10m?: number[];
    };
  };

  if (!payload.daily) {
    throw new HttpError(404, "Weather data is unavailable for that day.");
  }

  const code = payload.daily.weather_code?.[0] ?? 0;
  const humidityValues = payload.hourly?.relative_humidity_2m ?? [];
  const windValues = payload.hourly?.wind_speed_10m ?? [];
  const humidityAverage =
    humidityValues.length > 0
      ? Math.round(humidityValues.reduce((sum, value) => sum + value, 0) / humidityValues.length)
      : null;
  const windMax =
    windValues.length > 0 ? Math.round(Math.max(...windValues)) : null;
  const condition = weatherCodeToCondition(code);

  return {
    condition,
    icon: sanitizeWeatherIcon(condition),
    temperatureHigh:
      typeof payload.daily.temperature_2m_max?.[0] === "number"
        ? Math.round(payload.daily.temperature_2m_max[0])
        : null,
    temperatureLow:
      typeof payload.daily.temperature_2m_min?.[0] === "number"
        ? Math.round(payload.daily.temperature_2m_min[0])
        : null,
    windMph: windMax,
    humidity: humidityAverage,
    precipitation:
      typeof payload.daily.precipitation_sum?.[0] === "number"
        ? Number(payload.daily.precipitation_sum[0].toFixed(2))
        : 0,
    fetchedAt: new Date().toISOString(),
  };
}

async function hydrateDailyLog(id: string, currentUserId: string) {
  await ensureDailyLogSupportTables();

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

  return {
    log: {
      ...row,
      weatherData: weather.weatherData,
      notifyUserIds: weather.notifyUserIds,
      notifyUsers,
      tags: tagRows.map((tag) => tag.tagName),
      customFieldValues: normalizeCustomFieldValueRecord(row.customFieldValues),
      attachments: attachmentRows,
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
  asyncHandler(async (req, res) => {
    await ensureDailyLogSupportTables();

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

    const engagement = await loadDailyLogEngagement(logIds, req.auth.userId);

    let filtered = rows.map((row) => {
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

    const requestedTags = normalizeUniqueStrings([
      ...(query.data.tag ? [query.data.tag] : []),
      ...query.data.tags,
    ]).map((tag) => tag.toLowerCase());

    if (requestedTags.length > 0) {
      filtered = filtered.filter((row) =>
        requestedTags.every((expectedTag) =>
          row.tags.some((tag) => tag.toLowerCase() === expectedTag),
        ),
      );
    }

    if (query.data.sharedWith) {
      filtered = filtered.filter((row) => {
        if (query.data.sharedWith === "internal") {
          return !!row.shareInternalUsers;
        }

        if (query.data.sharedWith === "subs_vendors" || query.data.sharedWith === "installers") {
          return !!row.shareSubsVendors;
        }

        if (query.data.sharedWith === "client" || query.data.sharedWith === "estimators") {
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
    await ensureDailyLogSupportTables();

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

    const hydrated = await hydrateDailyLog(log.id, req.auth.userId);
    res.status(201).json(hydrated);
  }),
);

router.get(
  "/daily-logs/:id",
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    const hydrated = await hydrateDailyLog(logId, req.auth.userId);
    res.json(hydrated);
  }),
);

router.put(
  "/daily-logs/:id",
  asyncHandler(async (req, res) => {
    await ensureDailyLogSupportTables();

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
      userId: req.auth.userId,
      jobId: nextJobId,
      description: `Updated daily log ${body.data.title || body.data.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    const hydrated = await hydrateDailyLog(logId, req.auth.userId);
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

    const hydrated = await hydrateDailyLog(logId, req.auth.userId);

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

router.get(
  "/weather",
  asyncHandler(async (req, res) => {
    const query = weatherQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid weather query.", query.error.flatten());
    }

    const weather = await fetchWeatherSnapshot(query.data.address, query.data.date);
    res.json({ weather });
  }),
);

router.post(
  "/daily-logs/:id/like",
  asyncHandler(async (req, res) => {
    await ensureDailyLogSupportTables();

    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);

    const [existingLike] = await db
      .select({ id: dailyLogLikes.id })
      .from(dailyLogLikes)
      .where(
        and(
          eq(dailyLogLikes.dailyLogId, logId),
          eq(dailyLogLikes.userId, req.auth.userId),
        ),
      )
      .limit(1);

    let liked = false;

    if (existingLike) {
      await db.delete(dailyLogLikes).where(eq(dailyLogLikes.id, existingLike.id));
    } else {
      await db.insert(dailyLogLikes).values({
        id: crypto.randomUUID(),
        dailyLogId: logId,
        userId: req.auth.userId,
      });
      liked = true;
    }

    const [totalRow] = await db
      .select({ total: count() })
      .from(dailyLogLikes)
      .where(eq(dailyLogLikes.dailyLogId, logId));

    await writeActivity({
      entityType: "daily_log",
      entityId: logId,
      action: liked ? "liked" : "unliked",
      userId: req.auth.userId,
      jobId: dailyLog.jobId!,
      description: `${liked ? "Liked" : "Unliked"} daily log ${dailyLog.title || dailyLog.logDate}`,
      extra: {
        dailyLogId: logId,
      },
    });

    res.json({
      liked,
      likesCount: Number(totalRow?.total ?? 0),
    });
  }),
);

router.get(
  "/daily-logs/:id/comments",
  asyncHandler(async (req, res) => {
    const logId = getParam(req.params.id, "daily log id");
    await getDailyLogOrThrow(logId);
    const comments = await loadDailyLogComments(logId);
    res.json({ comments });
  }),
);

router.post(
  "/daily-logs/:id/comments",
  asyncHandler(async (req, res) => {
    await ensureDailyLogSupportTables();

    const body = commentPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid comment payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);

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

    const [comment] = await db
      .insert(dailyLogComments)
      .values({
        id: crypto.randomUUID(),
        dailyLogId: logId,
        parentCommentId: body.data.parentCommentId,
        createdBy: req.auth.userId,
        body: body.data.body,
        mentions: body.data.mentions,
        attachments: body.data.attachments,
        links: body.data.links,
        reactions: {},
      })
      .returning({ id: dailyLogComments.id });

    await writeActivity({
      entityType: "daily_log_comment",
      entityId: comment.id,
      action: body.data.parentCommentId ? "replied" : "commented",
      userId: req.auth.userId,
      jobId: dailyLog.jobId!,
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
  asyncHandler(async (req, res) => {
    await ensureDailyLogSupportTables();

    const body = commentReactionPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid reaction payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const commentId = getParam(req.params.commentId, "comment id");
    await getDailyLogOrThrow(logId);

    const [comment] = await db
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

    if (current.has(req.auth.userId)) {
      current.delete(req.auth.userId);
    } else {
      current.add(req.auth.userId);
    }

    reactions[body.data.emoji] = Array.from(current);

    if (reactions[body.data.emoji].length === 0) {
      delete reactions[body.data.emoji];
    }

    await db
      .update(dailyLogComments)
      .set({
        reactions,
        updatedAt: new Date(),
      })
      .where(eq(dailyLogComments.id, commentId));

    const comments = await loadDailyLogComments(logId);
    res.json({ comments });
  }),
);

router.post(
  "/daily-logs/:id/todos",
  asyncHandler(async (req, res) => {
    await ensureDailyLogSupportTables();

    const body = todoPayloadSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid to-do payload.", body.error.flatten());
    }

    const logId = getParam(req.params.id, "daily log id");
    const dailyLog = await getDailyLogOrThrow(logId);

    const [todo] = await db
      .insert(dailyLogTodos)
      .values({
        id: crypto.randomUUID(),
        dailyLogId: logId,
        title: body.data.title,
        isComplete: false,
        createdBy: req.auth.userId,
      })
      .returning({ id: dailyLogTodos.id });

    await writeActivity({
      entityType: "daily_log_todo",
      entityId: todo.id,
      action: "created",
      userId: req.auth.userId,
      jobId: dailyLog.jobId!,
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
  asyncHandler(async (req, res) => {
    await ensureDailyLogSupportTables();

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
