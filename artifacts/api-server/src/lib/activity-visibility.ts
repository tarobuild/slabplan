import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { dailyLogs, files, folders, scheduleItems } from "@workspace/db/schema";
import { buildFolderVisibilityCondition, isAdmin, type AuthContext } from "./authorization";
import { buildDailyLogVisibilityFilter } from "./daily-log-visibility";
import { buildScheduleListVisibilityFilter } from "./schedule-visibility";

export type ActivityRow = {
  id?: string;
  entityType: string;
  entityId: string;
  action?: string;
  metadata: unknown;
  description?: string | null;
  createdAt?: Date;
  userName?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uniqueIds(ids: Array<string | null>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function recipientBelongsToViewer(value: unknown, viewerId: string) {
  if (typeof value === "string") {
    return value === viewerId;
  }

  if (!isRecord(value)) {
    return false;
  }

  return value.id === viewerId || value.userId === viewerId;
}

function sanitizeRecipientMetadata<T extends ActivityRow>(row: T, auth: AuthContext): T {
  if (isAdmin(auth)) {
    return row;
  }

  const metadata = metadataRecord(row.metadata);
  let changed = false;

  if (Array.isArray(metadata.notifyUserIds)) {
    metadata.notifyUserIds = metadata.notifyUserIds.filter((value) => value === auth.userId);
    changed = true;
  }

  if (Array.isArray(metadata.recipients)) {
    metadata.recipients = metadata.recipients.filter((value) => recipientBelongsToViewer(value, auth.userId));
    changed = true;
  }

  return changed ? { ...row, metadata } : row;
}

function scheduleItemIdsFromMetadata(row: ActivityRow, metadata: Record<string, unknown>) {
  const ids: Array<string | null> = [
    stringValue(metadata.scheduleItemId),
    row.entityType === "schedule_item" ? row.entityId : null,
  ];

  if (Array.isArray(metadata.scheduleItems)) {
    for (const item of metadata.scheduleItems) {
      if (isRecord(item)) {
        ids.push(stringValue(item.id) ?? stringValue(item.scheduleItemId));
      } else {
        ids.push(stringValue(item));
      }
    }
  }

  return uniqueIds(ids);
}

function filterScheduleItemsMetadata(
  metadata: Record<string, unknown>,
  visibleItemIds: Set<string>,
) {
  if (!Array.isArray(metadata.scheduleItems)) {
    return metadata;
  }

  return {
    ...metadata,
    scheduleItems: metadata.scheduleItems.filter((item) => {
      if (isRecord(item)) {
        const id = stringValue(item.id) ?? stringValue(item.scheduleItemId);
        return id ? visibleItemIds.has(id) : false;
      }

      const id = stringValue(item);
      return id ? visibleItemIds.has(id) : false;
    }),
  };
}

function isScheduleItemActivity(entityType: string) {
  return entityType === "schedule_item" || entityType.startsWith("schedule_item_");
}

function isDailyLogActivity(entityType: string) {
  return entityType === "daily_log" || entityType.startsWith("daily_log_");
}

function isFolderActivity(entityType: string) {
  return entityType === "folder" || entityType === "resource_folder";
}

function isFileActivity(entityType: string) {
  return entityType === "file" || entityType === "file_annotation";
}

async function canViewFolderForActivity(auth: AuthContext, folderId: string) {
  if (isAdmin(auth)) {
    return true;
  }

  const visibility = buildFolderVisibilityCondition(auth);
  const conditions: SQL[] = [eq(folders.id, folderId)];
  if (visibility) {
    conditions.push(visibility);
  }

  const [row] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(...conditions)!)
    .limit(1);

  return Boolean(row);
}

async function canViewFileForActivity(auth: AuthContext, fileId: string) {
  if (isAdmin(auth)) {
    return true;
  }

  const visibility = buildFolderVisibilityCondition(auth);
  const conditions: SQL[] = [eq(files.id, fileId)];
  if (visibility) {
    conditions.push(visibility);
  }

  const [row] = await db
    .select({ id: files.id })
    .from(files)
    .innerJoin(folders, eq(files.folderId, folders.id))
    .where(and(...conditions)!)
    .limit(1);

  return Boolean(row);
}

async function visibleScheduleItemIds(auth: AuthContext, itemIds: string[]) {
  if (itemIds.length === 0 || isAdmin(auth)) {
    return new Set(itemIds);
  }

  const visibility = buildScheduleListVisibilityFilter(auth);
  const conditions: SQL[] = [inArray(scheduleItems.id, itemIds), isNull(scheduleItems.deletedAt)];
  if (visibility) {
    conditions.push(visibility);
  }

  const rows = await db
    .select({ id: scheduleItems.id })
    .from(scheduleItems)
    .where(and(...conditions)!);

  return new Set(rows.map((row) => row.id));
}

async function canViewDailyLogForActivity(auth: AuthContext, dailyLogId: string) {
  if (isAdmin(auth)) {
    return true;
  }

  const visibility = buildDailyLogVisibilityFilter(auth);
  const conditions: SQL[] = [eq(dailyLogs.id, dailyLogId), isNull(dailyLogs.deletedAt)];
  if (visibility) {
    conditions.push(visibility);
  }

  const [row] = await db
    .select({ id: dailyLogs.id })
    .from(dailyLogs)
    .where(and(...conditions)!)
    .limit(1);

  return Boolean(row);
}

export async function redactActivityRowForAuth<T extends ActivityRow>(
  row: T,
  auth: AuthContext,
): Promise<T | null> {
  if (isAdmin(auth)) {
    return row;
  }

  const metadata = metadataRecord(row.metadata);
  const folderId = stringValue(metadata.folderId) ?? (isFolderActivity(row.entityType) ? row.entityId : null);
  const fileId = stringValue(metadata.fileId) ?? (isFileActivity(row.entityType) ? row.entityId : null);
  const dailyLogId = stringValue(metadata.dailyLogId) ?? (isDailyLogActivity(row.entityType) ? row.entityId : null);

  if (fileId && !(await canViewFileForActivity(auth, fileId))) {
    return null;
  }

  if (!fileId && folderId && !(await canViewFolderForActivity(auth, folderId))) {
    return null;
  }

  if (isScheduleItemActivity(row.entityType) || row.entityType === "schedule_notification") {
    const itemIds = scheduleItemIdsFromMetadata(row, metadata);
    if (itemIds.length > 0) {
      const visibleIds = await visibleScheduleItemIds(auth, itemIds);
      if (visibleIds.size === 0) {
        return null;
      }

      if (visibleIds.size !== itemIds.length || Array.isArray(metadata.scheduleItems)) {
        const filteredMetadata = filterScheduleItemsMetadata(metadata, visibleIds);
        return sanitizeRecipientMetadata({ ...row, metadata: filteredMetadata }, auth);
      }
    }
  }

  if (dailyLogId && !(await canViewDailyLogForActivity(auth, dailyLogId))) {
    return null;
  }

  return sanitizeRecipientMetadata(row, auth);
}

export async function redactActivityRowsForAuth<T extends ActivityRow>(
  rows: T[],
  auth: AuthContext,
): Promise<T[]> {
  const redacted: T[] = [];

  for (const row of rows) {
    const next = await redactActivityRowForAuth(row, auth);
    if (next) {
      redacted.push(next);
    }
  }

  return redacted;
}

export async function redactRealtimePayloadForAuth(
  event: string,
  payload: unknown,
  auth: AuthContext,
): Promise<unknown | null> {
  if (event === "activity:created" && isRecord(payload)) {
    const row = payload as ActivityRow;
    if (typeof row.entityType === "string" && typeof row.entityId === "string") {
      return redactActivityRowForAuth(row, auth);
    }
  }

  if (event === "file:uploaded" && isRecord(payload)) {
    const folderId = stringValue(payload.folderId);
    const fileId = stringValue(payload.fileId);

    if (fileId) {
      return (await canViewFileForActivity(auth, fileId)) ? payload : null;
    }

    if (folderId) {
      return (await canViewFolderForActivity(auth, folderId)) ? payload : null;
    }
  }

  return payload;
}
