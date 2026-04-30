import archiver from "archiver";
import path from "node:path";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { Response } from "express";
import { db } from "@workspace/db";
import {
  activityLog,
  files,
  folders,
  jobs,
  type File,
  type Folder,
  users,
} from "@workspace/db/schema";
import { encodeCursor, type CursorPayload } from "./cursor";
import { HttpError } from "./http";
import {
  buildStoredFileName,
  buildUploadPath,
  deletePhysicalFile,
  openStoredFileReadStream,
  storedFileExists,
  writeUploadedBuffer,
  writeUploadedFromPath,
} from "./storage";
import { cleanupTempUpload } from "./uploads";
import { emitRealtimeEvent } from "./realtime";
import { logger } from "./logger";

export const documentExtensions = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
];
export const photoExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
export const videoExtensions = [".mp4", ".mov", ".avi", ".webm", ".m4v"];

const GLOBAL_SYSTEM_FOLDERS = [
  {
    mediaType: "document",
    title: "Global Documents",
    isGlobal: true,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "video",
    title: "Global Videos",
    isGlobal: true,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
] as const;

const JOB_TEMPLATE_FOLDERS: Array<{
  mediaType: "document" | "photo";
  title: string;
  isGlobal: boolean;
  viewingPermissions: Record<string, boolean>;
  uploadingPermissions: Record<string, boolean>;
}> = [
  {
    mediaType: "document",
    title: "01. PLANS",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "02. TAKE OFFS & PRICING",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "03. ESTIMATES",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "04. CONTRACT",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "05. PRELIM NOTICE",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "06. COI's",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "07. INVOICES & WAIVERS",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "08. CHANGE ORDERS",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "09. MATERIALS & EXPENSES",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "photo",
    title: "10. PICTURES",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true, crew_member: true },
  },
];

const allowedPhotoMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const allowedVideoMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-m4v",
]);

const allowedDocumentMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/csv",
]);

function lowerExtension(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

function validateAllowedUpload(
  extension: string,
  mimeType: string,
  allowedExtensions: string[],
  isAllowedMimeType: (value: string) => boolean,
  message: string,
) {
  if (!allowedExtensions.includes(extension) || !isAllowedMimeType(mimeType)) {
    throw new HttpError(400, message);
  }
}

export function validateUploadForMediaType(
  mediaType: string,
  file: {
    originalname?: string;
    mimetype?: string;
  },
) {
  const extension = lowerExtension(file.originalname ?? "");
  const mimeType = file.mimetype?.toLowerCase() ?? "";

  if (mediaType === "photo") {
    validateAllowedUpload(
      extension,
      mimeType,
      photoExtensions,
      (value) => allowedPhotoMimeTypes.has(value),
      "Photos must be image files (.jpg, .png, .gif, .webp).",
    );
    return;
  }

  if (mediaType === "video") {
    validateAllowedUpload(
      extension,
      mimeType,
      videoExtensions,
      (value) => allowedVideoMimeTypes.has(value),
      "Videos must be video files (.mp4, .mov, .avi, .webm).",
    );
    return;
  }

  if (mediaType === "document") {
    validateAllowedUpload(
      extension,
      mimeType,
      documentExtensions,
      (value) =>
        allowedDocumentMimeTypes.has(value) ||
        value.startsWith("application/vnd.openxmlformats-officedocument."),
      "Documents must be supported office, text, or PDF files.",
    );
    return;
  }

  throw new HttpError(400, "Unsupported media type.");
}

export async function ensureJobExists(jobId: string) {
  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      deletedAt: jobs.deletedAt,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!job || job.deletedAt) {
    throw new HttpError(404, "Job not found.");
  }

  return job;
}

async function findRootSystemFolder(jobId: string | null, mediaType: string, title: string) {
  const [folder] = await db
    .select()
    .from(folders)
    .where(
      and(
        jobId ? eq(folders.jobId, jobId) : isNull(folders.jobId),
        eq(folders.scope, jobId ? "job" : "resource"),
        eq(folders.mediaType, mediaType),
        eq(folders.title, title),
        isNull(folders.parentFolderId),
        isNull(folders.deletedAt),
      ),
    )
    .limit(1);

  return folder ?? null;
}

export async function ensureSystemFolders(
  jobId: string,
  options?: {
    includeJobTemplates?: boolean;
  },
) {
  await ensureJobExists(jobId);
  const values = [
    ...GLOBAL_SYSTEM_FOLDERS,
    ...(options?.includeJobTemplates ? JOB_TEMPLATE_FOLDERS : []),
  ];

  for (const value of values) {
    const existing = await findRootSystemFolder(jobId, value.mediaType, value.title);

    if (!existing) {
      await db.insert(folders).values({
        jobId,
        scope: "job",
        title: value.title,
        mediaType: value.mediaType,
        isGlobal: value.isGlobal,
        viewingPermissions: value.viewingPermissions,
        uploadingPermissions: value.uploadingPermissions,
      });
    }
  }
}

export async function getFolderOrThrow(folderId: string, includeDeleted = false) {
  const conditions = [eq(folders.id, folderId)];

  if (!includeDeleted) {
    conditions.push(isNull(folders.deletedAt));
  }

  const [folder] = await db
    .select()
    .from(folders)
    .where(and(...conditions))
    .limit(1);

  if (!folder) {
    throw new HttpError(404, "Folder not found.");
  }

  return folder;
}

export async function getFileOrThrow(fileId: string, includeDeleted = false) {
  const conditions = [eq(files.id, fileId)];

  if (!includeDeleted) {
    conditions.push(isNull(files.deletedAt));
  }

  const [file] = await db
    .select()
    .from(files)
    .where(and(...conditions))
    .limit(1);

  if (!file) {
    throw new HttpError(404, "File not found.");
  }

  return file;
}

function assertFolderEditable(folder: Folder) {
  if (folder.isGlobal) {
    throw new HttpError(400, "Global folders cannot be renamed, moved, or deleted.");
  }
}

function assertNestedFolderAllowed(mediaType: string, parentFolderId: string | null) {
  if (parentFolderId && mediaType !== "document") {
    throw new HttpError(400, "Nested folders are only supported in Documents.");
  }
}

export async function getAllFoldersForJob(jobId: string | null, mediaType: string, includeDeleted = false) {
  return db
    .select()
    .from(folders)
    .where(
      and(
        jobId ? eq(folders.jobId, jobId) : isNull(folders.jobId),
        eq(folders.scope, jobId ? "job" : "resource"),
        eq(folders.mediaType, mediaType),
        ...(includeDeleted ? [] : [isNull(folders.deletedAt)]),
      ),
    )
    .orderBy(asc(folders.title));
}

export async function getAllFilesForFolderIds(folderIds: string[], includeDeleted = false) {
  if (folderIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(files)
    .where(
      and(
        inArray(files.folderId, folderIds),
        ...(includeDeleted ? [] : [isNull(files.deletedAt)]),
      ),
    )
    .orderBy(desc(files.updatedAt), asc(files.filename));
}

function buildFolderPath(folderId: string, folderMap: Map<string, Folder>) {
  const breadcrumb: Folder[] = [];
  let current: Folder | undefined = folderMap.get(folderId);

  while (current) {
    breadcrumb.unshift(current);
    current = current.parentFolderId ? folderMap.get(current.parentFolderId) : undefined;
  }

  return breadcrumb;
}

function collectDescendantFolderIds(rootFolderId: string, allFolders: Folder[]) {
  const childMap = new Map<string | null, Folder[]>();

  for (const folder of allFolders) {
    const key = folder.parentFolderId ?? null;
    const group = childMap.get(key) ?? [];
    group.push(folder);
    childMap.set(key, group);
  }

  const ids: string[] = [];
  const stack = [rootFolderId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId) {
      continue;
    }

    ids.push(currentId);

    for (const child of childMap.get(currentId) ?? []) {
      stack.push(child.id);
    }
  }

  return ids;
}

async function deletePhysicalFilesBestEffort(fileUrls: Iterable<string>, context: string) {
  for (const fileUrl of fileUrls) {
    try {
      await deletePhysicalFile(fileUrl);
    } catch (error) {
      logger.error({ err: error, fileUrl, context }, "Failed to delete physical file");
    }
  }
}

async function listExclusiveFileUrlsToDelete(fileRecords: Array<{ id: string; fileUrl: string | null }>) {
  const uniqueFileUrls = Array.from(
    new Set(
      fileRecords
        .map((file) => file.fileUrl)
        .filter((fileUrl): fileUrl is string => typeof fileUrl === "string" && fileUrl.length > 0),
    ),
  );

  if (uniqueFileUrls.length === 0) {
    return [];
  }

  const excludedIds = fileRecords.map((file) => file.id);
  const remaining = await db
    .select({
      fileUrl: files.fileUrl,
    })
    .from(files)
    .where(
      and(
        inArray(files.fileUrl, uniqueFileUrls),
        notInArray(files.id, excludedIds),
      ),
    );

  const remainingFileUrls = new Set(
    remaining
      .map((row) => row.fileUrl)
      .filter((fileUrl): fileUrl is string => typeof fileUrl === "string" && fileUrl.length > 0),
  );

  return uniqueFileUrls.filter((fileUrl) => !remainingFileUrls.has(fileUrl));
}

export async function writeActivity(params: {
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  jobId: string | null;
  leadId?: string | null;
  mediaType?: string | null;
  folderId?: string | null;
  fileId?: string | null;
  description: string;
  extra?: Record<string, unknown>;
}) {
  const [jobRecord, userRecord] = await Promise.all([
    params.jobId
      ? db
          .select({
            title: jobs.title,
          })
          .from(jobs)
          .where(eq(jobs.id, params.jobId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const metadata = {
    description: params.description,
    jobId: params.jobId,
    jobTitle: jobRecord?.title ?? null,
    leadId: params.leadId ?? null,
    mediaType: params.mediaType ?? null,
    folderId: params.folderId ?? null,
    fileId: params.fileId ?? null,
    ...params.extra,
  };

  const [created] = await db.insert(activityLog).values({
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    userId: params.userId,
    metadata,
  }).returning({
    id: activityLog.id,
    entityType: activityLog.entityType,
    entityId: activityLog.entityId,
    action: activityLog.action,
    metadata: activityLog.metadata,
    createdAt: activityLog.createdAt,
  });

  emitRealtimeEvent("activity:created", {
    ...created,
    userName: userRecord?.fullName ?? null,
  }, params.jobId ?? null);

  return created;
}

export async function listFoldersForJob(params: {
  jobId: string;
  mediaType: string;
  parentId: string | null;
  all: boolean;
}) {
  await ensureJobExists(params.jobId);
  await ensureSystemFolders(params.jobId);
  return listFoldersForScope({
    jobId: params.jobId,
    mediaType: params.mediaType,
    parentId: params.parentId,
    all: params.all,
  });
}

export async function listResourceFolders(params: {
  parentId: string | null;
  all: boolean;
}) {
  return listFoldersForScope({
    jobId: null,
    mediaType: "document",
    parentId: params.parentId,
    all: params.all,
  });
}

async function listFoldersForScope(params: {
  jobId: string | null;
  mediaType: string;
  parentId: string | null;
  all: boolean;
}) {
  const allFolders = await getAllFoldersForJob(params.jobId, params.mediaType);
  const folderMap = new Map(allFolders.map((folder) => [folder.id, folder]));

  const currentFolder = params.parentId ? folderMap.get(params.parentId) ?? null : null;

  if (params.parentId && !currentFolder) {
    throw new HttpError(404, "Folder not found.");
  }

  const visibleFolders = params.all
    ? allFolders
    : allFolders.filter((folder) =>
        params.parentId ? folder.parentFolderId === params.parentId : folder.parentFolderId === null,
      );

  const filesForCounts = await getAllFilesForFolderIds(allFolders.map((folder) => folder.id));
  const fileCountByFolderId = new Map<string, number>();
  const childCountByFolderId = new Map<string, number>();

  for (const file of filesForCounts) {
    if (!file.folderId) {
      continue;
    }
    fileCountByFolderId.set(file.folderId, (fileCountByFolderId.get(file.folderId) ?? 0) + 1);
  }

  for (const folder of allFolders) {
    if (!folder.parentFolderId) {
      continue;
    }
    childCountByFolderId.set(
      folder.parentFolderId,
      (childCountByFolderId.get(folder.parentFolderId) ?? 0) + 1,
    );
  }

  return {
    currentFolder,
    breadcrumb: currentFolder ? buildFolderPath(currentFolder.id, folderMap) : [],
    folders: visibleFolders.map((folder) => ({
      ...folder,
      childFolderCount: childCountByFolderId.get(folder.id) ?? 0,
      fileCount: fileCountByFolderId.get(folder.id) ?? 0,
    })),
  };
}

const ALL_KNOWN_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ...photoExtensions,
  ...videoExtensions,
] as const;

function buildFileTypeCondition(fileTypes: string[]): SQL | undefined {
  if (fileTypes.length === 0) return undefined;

  const positiveExts = new Set<string>();
  let includeOther = false;

  for (const type of fileTypes) {
    switch (type) {
      case "pdf":
        positiveExts.add(".pdf");
        break;
      case "word":
        positiveExts.add(".doc");
        positiveExts.add(".docx");
        break;
      case "excel":
        positiveExts.add(".xls");
        positiveExts.add(".xlsx");
        positiveExts.add(".csv");
        break;
      case "images":
        for (const ext of photoExtensions) positiveExts.add(ext);
        break;
      case "video":
        for (const ext of videoExtensions) positiveExts.add(ext);
        break;
      case "other":
        includeOther = true;
        break;
    }
  }

  const extExpr = sql`lower(substring(coalesce(nullif(${files.originalName}, ''), ${files.filename}) from '\.[^.]*$'))`;
  const orParts: SQL[] = [];

  if (positiveExts.size > 0) {
    const list = sql.join(
      [...positiveExts].map((ext) => sql`${ext}`),
      sql`, `,
    );
    orParts.push(sql`${extExpr} in (${list})`);
  }

  if (includeOther) {
    const list = sql.join(
      ALL_KNOWN_EXTENSIONS.map((ext) => sql`${ext}`),
      sql`, `,
    );
    orParts.push(sql`(${extExpr} is null or ${extExpr} not in (${list}))`);
  }

  if (orParts.length === 0) return undefined;
  if (orParts.length === 1) return orParts[0];
  return sql`(${sql.join(orParts, sql` or `)})`;
}

export async function listFilesForFolder(params: {
  folderId: string;
  search: string | null;
  uploadedBy: string | null;
  fileTypes: string[];
  from: string | null;
  to: string | null;
  sortBy: string;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
  cursor?: CursorPayload | null;
  isCursorMode?: boolean;
}) {
  const folder = await getFolderOrThrow(params.folderId, params.includeDeleted ?? false);

  const conditions: SQL[] = [eq(files.folderId, folder.id)];

  if (!params.includeDeleted) {
    conditions.push(isNull(files.deletedAt));
  }

  if (params.search) {
    const pattern = `%${params.search}%`;
    conditions.push(
      sql`(${files.filename} ilike ${pattern} or ${files.originalName} ilike ${pattern} or ${files.mimeType} ilike ${pattern})`,
    );
  }

  if (params.uploadedBy) {
    conditions.push(eq(files.uploadedBy, params.uploadedBy));
  }

  const fileTypeCondition = buildFileTypeCondition(params.fileTypes);
  if (fileTypeCondition) {
    conditions.push(fileTypeCondition);
  }

  if (params.from) {
    const fromIso = `${params.from}T00:00:00.000Z`;
    conditions.push(sql`${files.createdAt} >= ${fromIso}::timestamptz`);
  }

  if (params.to) {
    const toIso = `${params.to}T23:59:59.999Z`;
    conditions.push(sql`${files.createdAt} <= ${toIso}::timestamptz`);
  }

  let orderBy: SQL[];
  switch (params.sortBy) {
    case "name_asc":
      orderBy = [asc(files.filename), desc(files.id)];
      break;
    case "name_desc":
      orderBy = [desc(files.filename), desc(files.id)];
      break;
    case "modified_oldest":
      orderBy = [asc(files.updatedAt), desc(files.id)];
      break;
    case "added_oldest":
      orderBy = [asc(files.createdAt), desc(files.id)];
      break;
    case "added_newest":
      orderBy = [desc(files.createdAt), desc(files.id)];
      break;
    case "modified_newest":
    default:
      orderBy = [desc(files.updatedAt), desc(files.id)];
      break;
  }

  const page = params.page ?? 1;
  const limit = params.limit ?? 100;
  const isCursorMode = params.isCursorMode === true;

  // Cursor pagination anchors on (updatedAt DESC, id DESC) so the documented
  // cursor/limit pair works regardless of sortBy. When the caller hits us
  // without a cursor (first page bootstrap) we still respond in cursor format
  // — we just skip the inequality clause.
  if (isCursorMode) {
    if (params.cursor) {
      const cursor = params.cursor;
      const cursorUpdatedAt = new Date(String(cursor.k[0] ?? ""));
      if (Number.isNaN(cursorUpdatedAt.getTime())) {
        throw new HttpError(400, "Invalid cursor.", undefined, "validation");
      }
      conditions.push(
        sql`(${files.updatedAt}, ${files.id}) < (${cursorUpdatedAt.toISOString()}::timestamptz, ${cursor.id})`,
      );
    }
    orderBy = [desc(files.updatedAt), desc(files.id)];
  }

  const offset = isCursorMode ? 0 : (page - 1) * limit;
  const fetchLimit = isCursorMode ? limit + 1 : limit;
  const whereClause = and(...conditions);

  const rowsPromise = db
    .select({
      id: files.id,
      folderId: files.folderId,
      filename: files.filename,
      originalName: files.originalName,
      fileUrl: files.fileUrl,
      fileSize: files.fileSize,
      mimeType: files.mimeType,
      note: files.note,
      uploadedBy: files.uploadedBy,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
      deletedAt: files.deletedAt,
      uploadedByName: users.fullName,
    })
    .from(files)
    .leftJoin(users, eq(files.uploadedBy, users.id))
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(fetchLimit)
    .offset(offset);

  if (isCursorMode) {
    const fetched = await rowsPromise;
    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({
          v: 1,
          k: [last.updatedAt.toISOString()],
          id: last.id,
        })
      : null;

    return {
      folder,
      files: rows,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    };
  }

  const [rows, [totalRow]] = await Promise.all([
    rowsPromise,
    db.select({ total: count() }).from(files).where(whereClause),
  ]);

  const totalItems = Number(totalRow?.total ?? 0);

  return {
    folder,
    files: rows,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };
}

export async function createFolder(params: {
  jobId: string;
  parentFolderId: string | null;
  mediaType: string;
  title: string;
  userId: string;
}) {
  await ensureJobExists(params.jobId);
  await ensureSystemFolders(params.jobId);
  assertNestedFolderAllowed(params.mediaType, params.parentFolderId);

  if (params.parentFolderId) {
    const parentFolder = await getFolderOrThrow(params.parentFolderId);
    if (parentFolder.jobId !== params.jobId || parentFolder.mediaType !== params.mediaType) {
      throw new HttpError(400, "Parent folder does not belong to this job and media type.");
    }
  }

  const [folder] = await db
    .insert(folders)
    .values({
      jobId: params.jobId,
      scope: "job",
      parentFolderId: params.parentFolderId,
      mediaType: params.mediaType,
      title: params.title,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    })
    .returning();

  await writeActivity({
    entityType: "folder",
    entityId: folder.id,
    action: "created",
    userId: params.userId,
    jobId: params.jobId,
    mediaType: params.mediaType,
    folderId: folder.id,
    description: `Created folder ${folder.title}`,
  });

  return folder;
}

export async function createResourceFolder(params: {
  parentFolderId: string | null;
  title: string;
  userId: string;
}) {
  if (params.parentFolderId) {
    const parentFolder = await getFolderOrThrow(params.parentFolderId);
    if (parentFolder.jobId !== null || parentFolder.mediaType !== "document") {
      throw new HttpError(400, "Parent folder must be a resource folder.");
    }
  }

  const [folder] = await db
    .insert(folders)
    .values({
      jobId: null,
      scope: "resource",
      parentFolderId: params.parentFolderId,
      mediaType: "document",
      title: params.title,
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true },
      isGlobal: false,
    })
    .returning();

  await writeActivity({
    entityType: "resource_folder",
    entityId: folder.id,
    action: "created",
    userId: params.userId,
    jobId: null,
    mediaType: folder.mediaType,
    folderId: folder.id,
    description: `Created resource folder ${folder.title}`,
  });

  return folder;
}

export async function renameOrUpdateFolder(params: {
  folderId: string;
  title?: string | null;
  viewingPermissions?: Record<string, unknown> | null;
  uploadingPermissions?: Record<string, unknown> | null;
  userId: string;
}) {
  const folder = await getFolderOrThrow(params.folderId);
  assertFolderEditable(folder);

  const nextTitle = params.title ? params.title : folder.title;

  const [updated] = await db
    .update(folders)
    .set({
      title: nextTitle,
      viewingPermissions: params.viewingPermissions ?? folder.viewingPermissions,
      uploadingPermissions: params.uploadingPermissions ?? folder.uploadingPermissions,
      updatedAt: new Date(),
    })
    .where(eq(folders.id, folder.id))
    .returning();

  await writeActivity({
    entityType: "folder",
    entityId: updated.id,
    action: "updated",
    userId: params.userId,
    jobId: updated.jobId ?? null,
    mediaType: updated.mediaType,
    folderId: updated.id,
    description: `Updated folder ${updated.title}`,
  });

  return updated;
}

export async function moveFolder(params: {
  folderId: string;
  destinationFolderId: string | null;
  userId: string;
}) {
  const folder = await getFolderOrThrow(params.folderId);
  assertFolderEditable(folder);
  assertNestedFolderAllowed(folder.mediaType, params.destinationFolderId);

  if (params.destinationFolderId) {
    const destination = await getFolderOrThrow(params.destinationFolderId);
    if (destination.jobId !== folder.jobId || destination.mediaType !== folder.mediaType) {
      throw new HttpError(400, "Destination folder does not match the selected job and media type.");
    }

    const allFolders = await getAllFoldersForJob(folder.jobId ?? null, folder.mediaType, true);
    const subtreeIds = new Set(collectDescendantFolderIds(folder.id, allFolders));

    if (subtreeIds.has(destination.id)) {
      throw new HttpError(400, "A folder cannot be moved into itself or one of its descendants.");
    }
  }

  const [updated] = await db
    .update(folders)
    .set({
      parentFolderId: params.destinationFolderId,
      updatedAt: new Date(),
    })
    .where(eq(folders.id, folder.id))
    .returning();

  await writeActivity({
    entityType: "folder",
    entityId: updated.id,
    action: "moved",
    userId: params.userId,
    jobId: updated.jobId ?? null,
    mediaType: updated.mediaType,
    folderId: updated.id,
    description: `Moved folder ${updated.title}`,
  });

  return updated;
}

export async function copyFolder(params: {
  folderId: string;
  userId: string;
}) {
  const folder = await getFolderOrThrow(params.folderId);
  const allFolders = await getAllFoldersForJob(folder.jobId ?? null, folder.mediaType, true);
  const subtreeIds = collectDescendantFolderIds(folder.id, allFolders);
  const subtreeFolders = allFolders.filter((candidate) => subtreeIds.includes(candidate.id));
  const subtreeFiles = await getAllFilesForFolderIds(subtreeIds, true);

  const createdMap = new Map<string, string>();

  await db.transaction(async (tx) => {
    for (const currentFolder of subtreeFolders.sort((left, right) => {
      const leftDepth = buildFolderPath(left.id, new Map(allFolders.map((item) => [item.id, item]))).length;
      const rightDepth = buildFolderPath(right.id, new Map(allFolders.map((item) => [item.id, item]))).length;
      return leftDepth - rightDepth;
    })) {
      const [created] = await tx
        .insert(folders)
        .values({
          jobId: currentFolder.jobId,
          scope: currentFolder.scope,
          leadId: currentFolder.leadId,
          dailyLogId: currentFolder.dailyLogId,
          scheduleItemId: currentFolder.scheduleItemId,
          title:
            currentFolder.id === folder.id
              ? `${currentFolder.title} Copy`
              : currentFolder.title,
          parentFolderId: currentFolder.parentFolderId
            ? createdMap.get(currentFolder.parentFolderId) ?? null
            : currentFolder.parentFolderId,
          mediaType: currentFolder.mediaType,
          viewingPermissions: currentFolder.viewingPermissions,
          uploadingPermissions: currentFolder.uploadingPermissions,
          isGlobal: false,
        })
        .returning();

      createdMap.set(currentFolder.id, created.id);
    }

    for (const currentFile of subtreeFiles) {
      const nextFolderId = createdMap.get(currentFile.folderId ?? "")

      if (!nextFolderId) {
        throw new HttpError(500, "Unable to copy folder files.")
      }

      await tx.insert(files).values({
        folderId: nextFolderId,
        filename: currentFile.filename,
        originalName: currentFile.originalName,
        fileUrl: currentFile.fileUrl,
        fileSize: currentFile.fileSize,
        mimeType: currentFile.mimeType,
        uploadedBy: currentFile.uploadedBy,
      });
    }
  });

  const copiedRootId = createdMap.get(folder.id);

  if (!copiedRootId) {
    throw new HttpError(500, "Unable to copy folder.");
  }

  await writeActivity({
    entityType: "folder",
    entityId: copiedRootId,
    action: "copied",
    userId: params.userId,
    jobId: folder.jobId ?? null,
    mediaType: folder.mediaType,
    folderId: copiedRootId,
    description: `Copied folder ${folder.title}`,
  });

  return getFolderOrThrow(copiedRootId);
}

export async function softDeleteFolder(params: {
  folderId: string;
  userId: string;
}) {
  const folder = await getFolderOrThrow(params.folderId);
  assertFolderEditable(folder);

  const allFolders = await getAllFoldersForJob(folder.jobId ?? null, folder.mediaType, true);
  const folderIds = collectDescendantFolderIds(folder.id, allFolders);
  const deletedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(folders)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(inArray(folders.id, folderIds));

    await tx
      .update(files)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(inArray(files.folderId, folderIds));
  });

  await writeActivity({
    entityType: "folder",
    entityId: folder.id,
    action: "deleted",
    userId: params.userId,
    jobId: folder.jobId ?? null,
    mediaType: folder.mediaType,
    folderId: folder.id,
    description: `Moved folder ${folder.title} to trash`,
  });
}

export async function restoreFolder(params: {
  folderId: string;
  userId: string;
}) {
  const folder = await getFolderOrThrow(params.folderId, true);

  if (!folder.deletedAt) {
    return folder;
  }

  const allFolders = await getAllFoldersForJob(folder.jobId ?? null, folder.mediaType, true);
  const folderIds = collectDescendantFolderIds(folder.id, allFolders);
  const folderMap = new Map(allFolders.map((currentFolder) => [currentFolder.id, currentFolder]));
  const ancestorIdsToRestore: string[] = [];
  let currentParentId = folder.parentFolderId;

  while (currentParentId) {
    const parent = folderMap.get(currentParentId);

    if (!parent) {
      break;
    }

    if (parent.deletedAt) {
      ancestorIdsToRestore.push(parent.id);
    }

    currentParentId = parent.parentFolderId;
  }

  const restoredAt = new Date();

  await db.transaction(async (tx) => {
    if (ancestorIdsToRestore.length > 0) {
      await tx
        .update(folders)
        .set({ deletedAt: null, updatedAt: restoredAt })
        .where(inArray(folders.id, ancestorIdsToRestore));
    }

    await tx
      .update(folders)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(inArray(folders.id, folderIds));

    await tx
      .update(files)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(inArray(files.folderId, folderIds));
  });

  await writeActivity({
    entityType: "folder",
    entityId: folder.id,
    action: "restored",
    userId: params.userId,
    jobId: folder.jobId ?? null,
    mediaType: folder.mediaType,
    folderId: folder.id,
    description: `Restored folder ${folder.title} from trash`,
  });

  return getFolderOrThrow(folder.id);
}

export async function purgeFolder(params: {
  folderId: string;
  userId: string;
}) {
  const folder = await getFolderOrThrow(params.folderId, true);
  const allFolders = await getAllFoldersForJob(folder.jobId ?? null, folder.mediaType, true);
  const folderIds = collectDescendantFolderIds(folder.id, allFolders);
  const subtreeFiles = await getAllFilesForFolderIds(folderIds, true);
  const fileUrlsToDelete = await listExclusiveFileUrlsToDelete(subtreeFiles);

  await db.transaction(async (tx) => {
    await tx.delete(folders).where(inArray(folders.id, folderIds));
  });

  await deletePhysicalFilesBestEffort(fileUrlsToDelete, "purgeFolder");

  await writeActivity({
    entityType: "folder",
    entityId: folder.id,
    action: "purged",
    userId: params.userId,
    jobId: folder.jobId ?? null,
    mediaType: folder.mediaType,
    folderId: folder.id,
    description: `Permanently deleted folder ${folder.title}`,
  });
}

export async function saveUploadedFiles(params: {
  folderId: string;
  userId: string;
  uploadedFiles: Express.Multer.File[];
  note?: string | null;
}) {
  const folder = await getFolderOrThrow(params.folderId);

  if (params.uploadedFiles.length === 0) {
    throw new HttpError(400, "At least one file is required.");
  }

  const created: File[] = [];

  for (const uploadedFile of params.uploadedFiles) {
    validateUploadForMediaType(folder.mediaType, uploadedFile);

    const storedName = buildStoredFileName(uploadedFile.originalname);
    const { fileUrl } = buildUploadPath({
      jobId: folder.jobId ?? "resources",
      mediaType: folder.mediaType,
      storedFileName: storedName,
    });

    try {
      if (uploadedFile.path) {
        await writeUploadedFromPath(fileUrl, uploadedFile.path, {
          contentType: uploadedFile.mimetype,
        });
      } else {
        await writeUploadedBuffer(fileUrl, uploadedFile.buffer, {
          contentType: uploadedFile.mimetype,
        });
      }
    } finally {
      await cleanupTempUpload(uploadedFile);
    }

    let file: File;

    try {
      [file] = await db.transaction(async (tx) =>
        tx
          .insert(files)
          .values({
            folderId: folder.id,
            filename: storedName,
            originalName: uploadedFile.originalname,
            fileUrl,
            fileSize: uploadedFile.size,
            mimeType: uploadedFile.mimetype,
            note: params.note ?? null,
            uploadedBy: params.userId,
          })
          .returning(),
      );
    } catch (error) {
      await deletePhysicalFilesBestEffort([fileUrl], "saveUploadedFiles:rollback");
      throw error;
    }

    await writeActivity({
      entityType: "file",
      entityId: file.id,
      action: "uploaded",
      userId: params.userId,
      jobId: folder.jobId ?? null,
      mediaType: folder.mediaType,
      folderId: folder.id,
      fileId: file.id,
      description: `Uploaded ${file.originalName}`,
    });

    emitRealtimeEvent("file:uploaded", {
      jobId: folder.jobId,
      folderId: folder.id,
      fileId: file.id,
      mediaType: folder.mediaType,
      originalName: file.originalName,
    }, folder.jobId);

    created.push(file);
  }

  return {
    folder,
    files: created,
  };
}

export async function renameFile(params: {
  fileId: string;
  originalName: string;
  userId: string;
}) {
  const file = await getFileOrThrow(params.fileId);

  const [updated] = await db
    .update(files)
    .set({
      originalName: params.originalName,
      updatedAt: new Date(),
    })
    .where(eq(files.id, file.id))
    .returning();

  const folder = await getFolderOrThrow(updated.folderId!);

  await writeActivity({
    entityType: "file",
    entityId: updated.id,
    action: "renamed",
    userId: params.userId,
    jobId: folder.jobId ?? null,
    mediaType: folder.mediaType,
    folderId: folder.id,
    fileId: updated.id,
    description: `Renamed file to ${updated.originalName}`,
  });

  return updated;
}

export async function softDeleteFile(params: {
  fileId: string;
  userId: string;
}) {
  const file = await getFileOrThrow(params.fileId);
  const deletedAt = new Date();

  await db
    .update(files)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(eq(files.id, file.id));

  const folder = await getFolderOrThrow(file.folderId!);

  await writeActivity({
    entityType: "file",
    entityId: file.id,
    action: "deleted",
    userId: params.userId,
    jobId: folder.jobId ?? null,
    mediaType: folder.mediaType,
    folderId: folder.id,
    fileId: file.id,
    description: `Moved ${file.originalName} to trash`,
  });
}

export async function restoreFile(params: {
  fileId: string;
  userId: string;
}) {
  const file = await getFileOrThrow(params.fileId, true);

  if (!file.deletedAt) {
    return file;
  }

  const folder = await getFolderOrThrow(file.folderId!, true);
  if (folder.deletedAt) {
    await restoreFolder({ folderId: folder.id, userId: params.userId });
  }

  await db
    .update(files)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(files.id, file.id));

  const activeFolder = await getFolderOrThrow(file.folderId!);

  await writeActivity({
    entityType: "file",
    entityId: file.id,
    action: "restored",
    userId: params.userId,
    jobId: activeFolder.jobId ?? null,
    mediaType: activeFolder.mediaType,
    folderId: activeFolder.id,
    fileId: file.id,
    description: `Restored ${file.originalName} from trash`,
  });

  return getFileOrThrow(file.id);
}

export async function purgeFile(params: {
  fileId: string;
  userId: string;
}) {
  const file = await getFileOrThrow(params.fileId, true);
  const folder = await getFolderOrThrow(file.folderId!, true);
  const fileUrlsToDelete = await listExclusiveFileUrlsToDelete([file]);

  await db.transaction(async (tx) => {
    await tx.delete(files).where(eq(files.id, file.id));
  });

  await deletePhysicalFilesBestEffort(fileUrlsToDelete, "purgeFile");

  await writeActivity({
    entityType: "file",
    entityId: file.id,
    action: "purged",
    userId: params.userId,
    jobId: folder.jobId ?? null,
    mediaType: folder.mediaType,
    folderId: folder.id,
    fileId: file.id,
    description: `Permanently deleted ${file.originalName}`,
  });
}

export async function listTrash(params: {
  jobId: string;
  mediaType: string;
}) {
  await ensureJobExists(params.jobId);

  const deletedFolders = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.jobId, params.jobId),
        eq(folders.mediaType, params.mediaType),
        isNotNull(folders.deletedAt),
      ),
    )
    .orderBy(desc(folders.deletedAt));

  const deletedFiles = await db
    .select({
      id: files.id,
      folderId: files.folderId,
      filename: files.filename,
      originalName: files.originalName,
      fileUrl: files.fileUrl,
      fileSize: files.fileSize,
      mimeType: files.mimeType,
      uploadedBy: files.uploadedBy,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
      deletedAt: files.deletedAt,
      uploadedByName: users.fullName,
    })
    .from(files)
    .leftJoin(users, eq(files.uploadedBy, users.id))
    .leftJoin(folders, eq(files.folderId, folders.id))
    .where(
      and(
        eq(folders.jobId, params.jobId),
        eq(folders.mediaType, params.mediaType),
        isNotNull(files.deletedAt),
      ),
    )
    .orderBy(desc(files.deletedAt));

  return {
    folders: deletedFolders,
    files: deletedFiles,
  };
}

export async function emptyTrash(params: {
  jobId: string;
  mediaType: string;
  userId: string;
}) {
  const trash = await listTrash({
    jobId: params.jobId,
    mediaType: params.mediaType,
  });

  for (const file of trash.files) {
    await purgeFile({
      fileId: file.id,
      userId: params.userId,
    });
  }

  const rootDeletedFolders = trash.folders.filter((folder) => {
    if (!folder.parentFolderId) {
      return true;
    }

    return !trash.folders.some((candidate) => candidate.id === folder.parentFolderId);
  });

  for (const folder of rootDeletedFolders) {
    await purgeFolder({
      folderId: folder.id,
      userId: params.userId,
    });
  }
}

export async function getActivityEntries(params: {
  jobId?: string | null;
  mediaType?: string | null;
  folderId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  allowedJobIds?: string[] | null;
  allowedLeadIds?: string[] | null;
  page?: number;
  limit?: number;
  cursor?: { createdAt: string; id: string } | null;
  isCursorMode?: boolean;
}) {
  const metadataJobId = sql<string | null>`${activityLog.metadata} ->> 'jobId'`;
  const metadataLeadId = sql<string | null>`${activityLog.metadata} ->> 'leadId'`;
  const metadataMediaType = sql<string | null>`${activityLog.metadata} ->> 'mediaType'`;
  const metadataFolderId = sql<string | null>`${activityLog.metadata} ->> 'folderId'`;
  const metadataDescription = sql<string | null>`${activityLog.metadata} ->> 'description'`;
  const conditions: SQL[] = [];

  if (params.entityType) {
    conditions.push(eq(activityLog.entityType, params.entityType));
  }

  if (params.entityId) {
    conditions.push(eq(activityLog.entityId, params.entityId));
  }

  if (params.jobId) {
    conditions.push(eq(metadataJobId, params.jobId));
  }

  if (params.mediaType) {
    conditions.push(eq(metadataMediaType, params.mediaType));
  }

  if (params.folderId) {
    conditions.push(eq(metadataFolderId, params.folderId));
  }

  // Visibility filter: admins receive `null` for both arrays and skip the
  // filter entirely. Any non-null array means the caller is non-admin and
  // a row is admitted only when it can be tied to at least one accessible
  // job or lead.
  const allowedJobIds = params.allowedJobIds ?? null;
  const allowedLeadIds = params.allowedLeadIds ?? null;
  if (allowedJobIds !== null || allowedLeadIds !== null) {
    const visibilityClauses: SQL[] = [];

    if (allowedJobIds !== null && allowedJobIds.length > 0) {
      visibilityClauses.push(inArray(metadataJobId, allowedJobIds));
      visibilityClauses.push(
        and(
          eq(activityLog.entityType, "job"),
          inArray(activityLog.entityId, allowedJobIds),
        )!,
      );
    }

    if (allowedLeadIds !== null && allowedLeadIds.length > 0) {
      visibilityClauses.push(inArray(metadataLeadId, allowedLeadIds));
      visibilityClauses.push(
        and(
          eq(activityLog.entityType, "lead"),
          inArray(activityLog.entityId, allowedLeadIds),
        )!,
      );
    }

    if (visibilityClauses.length === 0) {
      // Caller has neither job nor lead access. Force an empty result set.
      conditions.push(sql`false`);
    } else {
      conditions.push(sql`(${sql.join(visibilityClauses, sql` OR `)})`);
    }
  }

  const limit = params.limit ?? 50;
  const cursor = params.cursor ?? null;
  const isCursorMode = params.isCursorMode === true || cursor !== null;

  if (isCursorMode) {
    // Cursor mode: skip the costly COUNT and fetch limit+1 to detect the next
    // page. When `cursor` is provided we add the stable
    // `(createdAt, id) < (cursorCreatedAt, cursorId)` comparison; without one
    // we just return the first page so callers can bootstrap with
    // `?cursor=&limit=N` (or `?limit=N`) and follow `nextCursor` from there.
    if (cursor) {
      const cursorCreatedAt = new Date(cursor.createdAt);
      if (Number.isNaN(cursorCreatedAt.getTime())) {
        throw new HttpError(400, "Invalid cursor.", undefined, "validation");
      }
      conditions.push(
        sql`(${activityLog.createdAt}, ${activityLog.id}) < (${cursorCreatedAt.toISOString()}::timestamptz, ${cursor.id})`,
      );
    }

    const whereClauseCursor = and(...conditions);
    const fetchLimit = limit + 1;

    const rows = await db
      .select({
        id: activityLog.id,
        entityType: activityLog.entityType,
        entityId: activityLog.entityId,
        action: activityLog.action,
        metadata: activityLog.metadata,
        description: metadataDescription,
        createdAt: activityLog.createdAt,
        userName: users.fullName,
      })
      .from(activityLog)
      .leftJoin(users, eq(activityLog.userId, users.id))
      .where(whereClauseCursor)
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(fetchLimit);

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const last = trimmed[trimmed.length - 1];
    const nextCursorPayload = hasMore && last
      ? { createdAt: last.createdAt.toISOString(), id: last.id }
      : null;

    return {
      data: trimmed,
      pagination: {
        limit,
        hasMore,
        nextCursor: nextCursorPayload,
      },
    };
  }

  const whereClause = and(...conditions);
  const page = params.page ?? 1;
  const offset = (page - 1) * limit;

  const [totalRow] = await db
    .select({
      total: count(),
    })
    .from(activityLog)
    .where(whereClause);

  const rows = await db
    .select({
      id: activityLog.id,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      action: activityLog.action,
      metadata: activityLog.metadata,
      description: metadataDescription,
      createdAt: activityLog.createdAt,
      userName: users.fullName,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.userId, users.id))
    .where(whereClause)
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(limit)
    .offset(offset);

  const totalItems = totalRow?.total ?? 0;

  return {
    data: rows,
    pagination: {
      page,
      limit,
      total: totalItems,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };
}

export async function streamFolderZip(params: {
  folderId: string;
  res: Response;
}) {
  const folder = await getFolderOrThrow(params.folderId);
  const allFolders = await getAllFoldersForJob(folder.jobId ?? null, folder.mediaType, true);
  const folderMap = new Map(allFolders.map((item) => [item.id, item]));
  const folderIds = collectDescendantFolderIds(folder.id, allFolders);
  const subtreeFiles = await getAllFilesForFolderIds(folderIds, true);

  params.res.attachment(`${folder.title}.zip`);

  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  archive.on("error", (error: Error) => {
    logger.error({ err: error, folderId: params.folderId }, "Failed to stream folder archive");

    if (!params.res.headersSent) {
      params.res.status(500).end();
      return;
    }

    params.res.destroy(error);
  });

  archive.pipe(params.res);

  if (subtreeFiles.length === 0) {
    archive.append("", { name: `${folder.title}/` });
  }

  for (const file of subtreeFiles) {
    if (!file.fileUrl) {
      continue;
    }

    if (!(await storedFileExists(file.fileUrl))) {
      continue;
    }

    const trail = buildFolderPath(file.folderId!, folderMap);
    const relativeTrail = trail
      .slice(1)
      .map((item) => item.title)
      .filter(Boolean)
      .join("/");
    const zipName = relativeTrail
      ? path.posix.join(folder.title, relativeTrail, file.originalName)
      : path.posix.join(folder.title, file.originalName);

    archive.append(openStoredFileReadStream(file.fileUrl), { name: zipName });
  }

  await archive.finalize();
}
