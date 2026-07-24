import archiver from "archiver";
import path from "node:path";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { Response } from "express";
import {
  DANGEROUS_UPLOAD_EXTENSIONS,
  VIDEO_UPLOAD_EXTENSIONS,
  dangerousUploadMessage,
  extensionOf,
} from "@workspace/api-zod";
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
import { assertCanManageJob, buildFolderVisibilityCondition, isAdmin, type AuthContext } from "./authorization";
import { redactActivityRowsForAuth } from "./activity-visibility";
import { encodeCursor, type CursorPayload } from "./cursor";
import { FILE_RESPONSE_CSP } from "./file-serving";
import { HttpError } from "./http";
import { getActiveOrganizationId, organizationScopeCondition } from "./tenant-scope";
import {
  buildStoredFileName,
  buildUploadPath,
  deletePhysicalFile,
  openStoredFileReadStream,
  probeStorageStatuses,
  storedFileExists,
  writeUploadedBuffer,
  writeUploadedFromPath,
  type StorageStatus,
} from "./storage";
import { cleanupTempUpload } from "./uploads";
import { emitRealtimeEvent } from "./realtime";
import { logger } from "./logger";
import { getMcpContext } from "../middleware/mcp-context";

// `photoExtensions` and `videoExtensions` are still used by
// `buildFileTypeCondition` to power the Files-tab filter chips
// ("Images", "Video"). They no longer gate uploads — that's now the
// shared blocklist in `validateUploadForMediaType`.
export const photoExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".bmp",
];
export const videoExtensions = [...VIDEO_UPLOAD_EXTENSIONS];

const GLOBAL_SYSTEM_FOLDERS = [
  {
    mediaType: "document",
    title: "Global Documents",
    isGlobal: true,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "photo",
    title: "Global Photos",
    isGlobal: true,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true, crew_member: true },
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
    mediaType: "document",
    title: "10. WARRANTY",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "11. SHOP DRAWINGS",
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
  {
    mediaType: "document",
    title: "11. FINANCIALS",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "CHECKLIST",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "MASA DESIGN BOOKLETS",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "PEDESTAL SAFETY",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
  {
    mediaType: "document",
    title: "Pre-Sale Documents",
    isGlobal: false,
    viewingPermissions: { internal: true },
    uploadingPermissions: { admin: true, project_manager: true },
  },
];

const FOLDER_LOOKUP_ALIASES: Record<string, string[]> = {
  "5 prelim notice": ["5 prelim"],
  "6 cois": ["6 coi", "6 coi s"],
  "pre sale documents": ["presale documents", "pre-sale documents"],
};

export function normalizeFolderLookupKey(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  return normalized.replace(/^0+(\d+)(?=\s)/, "$1");
}

function folderLookupKeys(title: string): Set<string> {
  const normalized = normalizeFolderLookupKey(title);
  const keys = new Set<string>([normalized]);

  for (const alias of FOLDER_LOOKUP_ALIASES[normalized] ?? []) {
    keys.add(normalizeFolderLookupKey(alias));
  }

  for (const [canonical, aliases] of Object.entries(FOLDER_LOOKUP_ALIASES)) {
    const normalizedAliases = aliases.map((alias) => normalizeFolderLookupKey(alias));
    if (normalizedAliases.includes(normalized)) {
      keys.add(canonical);
      for (const alias of normalizedAliases) {
        keys.add(alias);
      }
    }
  }

  return keys;
}

function folderNamesMatch(left: string, right: string): boolean {
  const leftKeys = folderLookupKeys(left);
  for (const key of folderLookupKeys(right)) {
    if (leftKeys.has(key)) return true;
  }
  return false;
}

function parseFolderPathSegments(params: {
  path?: string | null;
  pathSegments?: string[] | null;
}): string[] {
  const rawSegments = params.pathSegments && params.pathSegments.length > 0
    ? params.pathSegments
    : typeof params.path === "string"
      ? params.path.split("/")
      : [];

  const segments = rawSegments.map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new HttpError(
      400,
      "Folder path must include at least one segment.",
      { code: "FOLDER_PATH_REQUIRED" },
      "validation",
    );
  }

  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.includes("\0")) {
      throw new HttpError(
        400,
        "Folder path contains an invalid segment.",
        { code: "FOLDER_PATH_INVALID", segment },
        "validation",
      );
    }
  }

  return segments;
}

function lowerExtension(fileName: string) {
  return extensionOf(fileName);
}

function safeZipPathComponent(value: string | null | undefined, fallback: string) {
  const cleaned = (value ?? "")
    .normalize("NFKC")
    .replace(/[\\/:\x00-\x1f\x7f]+/g, "_")
    .replace(/\.\./g, "__")
    .trim();

  if (!cleaned || cleaned === "." || cleaned === "..") {
    return fallback;
  }

  return cleaned;
}

/**
 * Authoritative type gate for every upload route.
 *
 * Field crews need to attach whatever they get from clients, vendors,
 * or their phones — HEIC bursts, CAD drawings, scanned PDFs, ZIPs of
 * plans, voice memos, AutoCAD exports. So we operate as a *blocklist*:
 * everything is accepted except a small set of file extensions that
 * are actually dangerous (Windows/Mac executables, shell scripts,
 * HTML/JS that could run in a browser session).
 *
 * The legacy `mediaType` argument (`"photo" | "video" | "document"`)
 * is preserved on the signature so existing call sites don't need to
 * churn, but it no longer affects which file types are accepted —
 * folder organisation in the UI is independent of what users may
 * upload. Magic-byte sniffing (validateMagicBytesForFile) runs before
 * us in the pipeline and is the second, content-level gate; we are
 * the cheap extension-based gate that fires first.
 */
export function validateUploadForMediaType(
  _mediaType: string,
  file: {
    originalname?: string;
    mimetype?: string;
  },
) {
  const extension = lowerExtension(file.originalname ?? "");

  if (DANGEROUS_UPLOAD_EXTENSIONS.has(extension)) {
    throw new HttpError(
      415,
      dangerousUploadMessage(file.originalname ?? ""),
      {
        code: "UPLOAD_TYPE_BLOCKED",
        extension: extension || null,
        declaredMimeType: (file.mimetype ?? "").toLowerCase() || null,
      },
      "unsupported-media-type",
    );
  }
}

export async function ensureJobExists(jobId: string) {
  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      organizationId: jobs.organizationId,
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

async function findRootSystemFolder(
  jobId: string | null,
  mediaType: string,
  title: string,
  options?: {
    includeDeleted?: boolean;
    organizationId?: string | null;
  },
) {
  const rootFolders = await db
    .select()
    .from(folders)
    .where(
      and(
        jobId ? eq(folders.jobId, jobId) : isNull(folders.jobId),
        eq(folders.scope, jobId ? "job" : "resource"),
        eq(folders.mediaType, mediaType),
        options?.organizationId
          ? eq(folders.organizationId, options.organizationId)
          : options?.organizationId === null
            ? isNull(folders.organizationId)
            : undefined,
        isNull(folders.parentFolderId),
        ...(options?.includeDeleted ? [] : [isNull(folders.deletedAt)]),
      ),
    );

  return rootFolders.find((folder) => folderNamesMatch(folder.title, title)) ?? null;
}

export async function ensureSystemFolders(
  jobId: string,
  options?: {
    includeJobTemplates?: boolean;
  },
) {
  const job = await ensureJobExists(jobId);
  const values = [
    ...GLOBAL_SYSTEM_FOLDERS,
    ...(options?.includeJobTemplates ? JOB_TEMPLATE_FOLDERS : []),
  ];

  for (const value of values) {
    const existing = await findRootSystemFolder(jobId, value.mediaType, value.title, {
      includeDeleted: true,
      organizationId: job.organizationId,
    });

    if (!existing) {
      await db.insert(folders).values({
        organizationId: job.organizationId,
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

async function getFilesOrThrow(fileIds: readonly string[]) {
  const uniqueIds = Array.from(new Set(fileIds));

  if (uniqueIds.length === 0) {
    throw new HttpError(400, "At least one file is required.");
  }

  const rows = await db
    .select()
    .from(files)
    .where(and(inArray(files.id, uniqueIds), isNull(files.deletedAt)));
  const rowById = new Map(rows.map((file) => [file.id, file]));
  const missingFileId = uniqueIds.find((fileId) => !rowById.has(fileId));

  if (missingFileId) {
    throw new HttpError(404, "File not found.");
  }

  return uniqueIds.map((fileId) => rowById.get(fileId)!);
}

async function getFoldersForFilesOrThrow(fileBatch: readonly File[]) {
  const folderIds = Array.from(new Set(fileBatch.map((file) => file.folderId)));

  if (folderIds.length === 0) {
    throw new HttpError(400, "At least one source folder is required.");
  }

  const rows = await db
    .select()
    .from(folders)
    .where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)));
  const rowById = new Map(rows.map((folder) => [folder.id, folder]));
  const missingFolderId = folderIds.find((folderId) => !rowById.has(folderId));

  if (missingFolderId) {
    throw new HttpError(404, "Folder not found.");
  }

  return rowById;
}

function assertFolderEditable(folder: Folder) {
  if (folder.isGlobal) {
    throw new HttpError(400, "Global folders cannot be renamed, moved, or deleted.");
  }
}

function folderOrganizationCondition(folder: Pick<Folder, "organizationId">): SQL {
  return folder.organizationId
    ? eq(folders.organizationId, folder.organizationId)
    : isNull(folders.organizationId);
}

export async function getAllFoldersForJob(
  jobId: string | null,
  mediaType: string,
  includeDeleted = false,
  extraConditions: SQL[] = [],
) {
  return db
    .select()
    .from(folders)
    .where(
      and(
        jobId ? eq(folders.jobId, jobId) : isNull(folders.jobId),
        eq(folders.scope, jobId ? "job" : "resource"),
        eq(folders.mediaType, mediaType),
        ...(includeDeleted ? [] : [isNull(folders.deletedAt)]),
        ...extraConditions,
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

function buildFolderPathMetadata(folderId: string, folderMap: Map<string, Folder>) {
  const breadcrumb = buildFolderPath(folderId, folderMap);
  const pathSegments = breadcrumb.map((folder) => folder.title);

  return {
    pathSegments,
    path: pathSegments.join("/"),
    normalizedPath: pathSegments.map((segment) => normalizeFolderLookupKey(segment)).join("/"),
  };
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
  organizationId?: string | null;
  extra?: Record<string, unknown>;
}) {
  const [jobRecord, userRecord] = await Promise.all([
    params.jobId
      ? db
          .select({
            title: jobs.title,
            organizationId: jobs.organizationId,
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

  // If this write is happening as part of an MCP tool call, tag the
  // activity row so audit logs show the agent provenance. Falls back to
  // whatever the caller passed in `extra` when no MCP context is active.
  const mcpCtx = getMcpContext();
  const mcpTag = mcpCtx
    ? {
        actor: `agent_via_mcp(${mcpCtx.userId}, ${mcpCtx.patId}, ${mcpCtx.toolName})` as const,
        actorKind: "agent_via_mcp" as const,
        toolName: mcpCtx.toolName,
        patId: mcpCtx.patId,
      }
    : undefined;

  const metadata = {
    description: params.description,
    jobId: params.jobId,
    jobTitle: jobRecord?.title ?? null,
    leadId: params.leadId ?? null,
    mediaType: params.mediaType ?? null,
    folderId: params.folderId ?? null,
    fileId: params.fileId ?? null,
    ...params.extra,
    ...(mcpTag ?? {}),
  };

  const [created] = await db.insert(activityLog).values({
    organizationId: params.organizationId ?? jobRecord?.organizationId ?? null,
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
  auth: AuthContext;
}) {
  await ensureJobExists(params.jobId);
  await ensureSystemFolders(params.jobId, { includeJobTemplates: true });
  return listFoldersForScope({
    jobId: params.jobId,
    mediaType: params.mediaType,
    parentId: params.parentId,
    all: params.all,
    auth: params.auth,
  });
}

export async function listResourceFolders(params: {
  parentId: string | null;
  all: boolean;
  auth: AuthContext;
}) {
  if (params.auth.role === "drafter") {
    throw new HttpError(403, "Drafters do not have access to resource files.");
  }

  return listFoldersForScope({
    jobId: null,
    mediaType: "document",
    parentId: params.parentId,
    all: params.all,
    auth: params.auth,
  });
}

async function listFoldersForScope(params: {
  jobId: string | null;
  mediaType: string;
  parentId: string | null;
  all: boolean;
  auth: AuthContext;
}) {
  // Push the per-folder visibility check down into SQL so deeply nested job
  // trees stay performant — for non-admins this filters out folders with
  // restrictive `viewingPermissions` before they ever reach JS.
  const visibilityCondition = buildFolderVisibilityCondition(params.auth);
  const extraConditions: SQL[] = [
    organizationScopeCondition(params.auth, folders.organizationId),
    ...(visibilityCondition ? [visibilityCondition] : []),
  ];
  const allFolders = await getAllFoldersForJob(
    params.jobId,
    params.mediaType,
    false,
    extraConditions,
  );
  const folderMap = new Map(allFolders.map((folder) => [folder.id, folder]));

  // If the caller asked for a specific parent folder but cannot view it (or
  // it doesn't exist), we surface a 404 — same shape we use when the folder
  // is genuinely missing, so we don't leak the existence of restricted nodes.
  const currentFolder = params.parentId ? folderMap.get(params.parentId) ?? null : null;

  if (params.parentId && !currentFolder) {
    throw new HttpError(404, "Folder not found.");
  }

  const visibleFolders = params.all
    ? allFolders
    : allFolders.filter((folder) =>
        params.parentId ? folder.parentFolderId === params.parentId : folder.parentFolderId === null,
      );

  // Counts are computed off the visibility-filtered set so non-admins don't
  // see badge counts that include folders/files they can't actually open.
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
      ...buildFolderPathMetadata(folder.id, folderMap),
      normalizedTitle: normalizeFolderLookupKey(folder.title),
      childFolderCount: childCountByFolderId.get(folder.id) ?? 0,
      fileCount: fileCountByFolderId.get(folder.id) ?? 0,
    })),
  };
}

export async function listFolderTreeForJob(params: {
  jobId: string;
  mediaType: "document" | "photo" | "video" | null;
  auth: AuthContext;
}) {
  await ensureJobExists(params.jobId);
  await ensureSystemFolders(params.jobId, { includeJobTemplates: true });

  const visibilityCondition = buildFolderVisibilityCondition(params.auth);
  const mediaTypes = params.mediaType
    ? [params.mediaType]
    : (["document", "photo", "video"] as const);
  const allFolders = await db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.jobId, params.jobId),
        eq(folders.scope, "job"),
        inArray(folders.mediaType, [...mediaTypes]),
        isNull(folders.deletedAt),
        ...(visibilityCondition ? [visibilityCondition] : []),
      ),
    )
    .orderBy(asc(folders.mediaType), asc(folders.title));

  const folderMap = new Map(allFolders.map((folder) => [folder.id, folder]));
  const filesForCounts = await getAllFilesForFolderIds(allFolders.map((folder) => folder.id));
  const fileCountByFolderId = new Map<string, number>();
  const childCountByFolderId = new Map<string, number>();

  for (const file of filesForCounts) {
    if (!file.folderId) continue;
    fileCountByFolderId.set(file.folderId, (fileCountByFolderId.get(file.folderId) ?? 0) + 1);
  }

  for (const folder of allFolders) {
    if (!folder.parentFolderId) continue;
    childCountByFolderId.set(
      folder.parentFolderId,
      (childCountByFolderId.get(folder.parentFolderId) ?? 0) + 1,
    );
  }

  return {
    folders: allFolders.map((folder) => ({
      ...folder,
      ...buildFolderPathMetadata(folder.id, folderMap),
      normalizedTitle: normalizeFolderLookupKey(folder.title),
      childFolderCount: childCountByFolderId.get(folder.id) ?? 0,
      fileCount: fileCountByFolderId.get(folder.id) ?? 0,
    })),
  };
}

export async function resolveJobFolderPath(params: {
  jobId: string;
  mediaType: "document" | "photo" | "video";
  path?: string | null;
  pathSegments?: string[] | null;
  createIfMissing: boolean;
  userId: string;
}) {
  const requestedSegments = parseFolderPathSegments({
    path: params.path,
    pathSegments: params.pathSegments,
  });

  await ensureJobExists(params.jobId);
  await ensureSystemFolders(params.jobId, { includeJobTemplates: true });

  let allFolders = await getAllFoldersForJob(params.jobId, params.mediaType);
  const createdFolders: Folder[] = [];
  let parentFolderId: string | null = null;
  let matchedBy: "exact" | "normalized" | "created" = "exact";
  let currentFolder: Folder | null = null;

  for (const [index, requestedSegment] of requestedSegments.entries()) {
    const sibling = allFolders.find((folder) => {
      if ((folder.parentFolderId ?? null) !== parentFolderId) return false;
      return folderNamesMatch(folder.title, requestedSegment);
    });

    if (sibling) {
      if (sibling.title !== requestedSegment) {
        matchedBy = matchedBy === "created" ? "created" : "normalized";
      }
      currentFolder = sibling;
      parentFolderId = sibling.id;
      continue;
    }

    if (!params.createIfMissing) {
      const searchedPath = requestedSegments.slice(0, index + 1).join("/");
      throw new HttpError(
        404,
        `No CADsystems folder id for path "${searchedPath}".`,
        {
          code: "FOLDER_PATH_NOT_FOUND",
          segment: requestedSegment,
          normalizedSegment: normalizeFolderLookupKey(requestedSegment),
          path: requestedSegments.join("/"),
          mediaType: params.mediaType,
          createIfMissingSupported: true,
        },
        "not-found",
      );
    }

    const created = await createFolder({
      jobId: params.jobId,
      mediaType: params.mediaType,
      parentFolderId,
      title: requestedSegment,
      userId: params.userId,
    });
    createdFolders.push(created);
    allFolders = [...allFolders, created];
    currentFolder = created;
    parentFolderId = created.id;
    matchedBy = "created";
  }

  if (!currentFolder) {
    throw new HttpError(
      404,
      "Folder not found.",
      { code: "FOLDER_PATH_NOT_FOUND", mediaType: params.mediaType },
      "not-found",
    );
  }

  const folderMap = new Map(allFolders.map((folder) => [folder.id, folder]));
  const breadcrumb = buildFolderPath(currentFolder.id, folderMap);

  return {
    folder: {
      ...currentFolder,
      ...buildFolderPathMetadata(currentFolder.id, folderMap),
      normalizedTitle: normalizeFolderLookupKey(currentFolder.title),
    },
    breadcrumb,
    createdFolders,
    matchedBy,
    requestedPath: requestedSegments.join("/"),
    normalizedRequestedPath: requestedSegments.map((segment) => normalizeFolderLookupKey(segment)).join("/"),
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
      durationSeconds: files.durationSeconds,
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
      files: await annotateFilesWithStorageStatus(rows),
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
    files: await annotateFilesWithStorageStatus(rows),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };
}

async function annotateFilesWithStorageStatus<T extends { fileUrl: string | null }>(
  rows: T[],
): Promise<Array<T & { storageStatus: StorageStatus }>> {
  if (rows.length === 0) return [];
  const statuses = await probeStorageStatuses(rows.map((row) => row.fileUrl));
  return rows.map((row) => ({
    ...row,
    storageStatus:
      row.fileUrl && statuses.get(row.fileUrl) === "ok" ? "ok" : "missing",
  }));
}

export const duplicateActionValues = ["keep_both", "skip_exact", "fail_on_conflict"] as const;
export type DuplicateAction = (typeof duplicateActionValues)[number];
export type DuplicateDetectionStatus =
  | "none"
  | "already_exists_exact_match"
  | "name_conflict_different_content"
  | "duplicate_possible_manual_review";

function normalizeContentHash(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

function normalizeDuplicateFilename(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

type DuplicateMatch = {
  id: string;
  folderId: string;
  originalName: string;
  filename: string;
  fileSize: number | null;
  contentHash: string | null;
  mimeType: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  matchReason: "name" | "checksum" | "name_and_size" | "name_and_checksum";
};

export async function detectFileDuplicate(params: {
  folderId: string;
  originalName: string;
  fileSize: number | null | undefined;
  contentHash?: string | null;
}) {
  const normalizedName = normalizeDuplicateFilename(params.originalName);
  const normalizedHash = normalizeContentHash(params.contentHash);
  const fileSize = typeof params.fileSize === "number" && Number.isFinite(params.fileSize)
    ? params.fileSize
    : null;

  const rows = await db
    .select({
      id: files.id,
      folderId: files.folderId,
      originalName: files.originalName,
      filename: files.filename,
      fileSize: files.fileSize,
      contentHash: files.contentHash,
      mimeType: files.mimeType,
      uploadedBy: files.uploadedBy,
      uploadedByName: users.fullName,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .leftJoin(users, eq(files.uploadedBy, users.id))
    .where(
      and(
        eq(files.folderId, params.folderId),
        isNull(files.deletedAt),
        sql`(lower(trim(${files.originalName})) = ${normalizedName} or (${normalizedHash}::text is not null and ${files.contentHash} = ${normalizedHash}))`,
      ),
    )
    .orderBy(desc(files.createdAt));

  const matches = rows.map((row): DuplicateMatch => {
    const sameName = normalizeDuplicateFilename(row.originalName) === normalizedName;
    const sameSize = fileSize !== null && row.fileSize === fileSize;
    const sameHash = normalizedHash !== null && row.contentHash === normalizedHash;
    const matchReason =
      sameName && sameHash
        ? "name_and_checksum"
        : sameName && sameSize
          ? "name_and_size"
          : sameHash
            ? "checksum"
            : "name";

    return {
      ...row,
      contentHash: row.contentHash ?? null,
      matchReason,
    };
  });

  const exactMatches = matches.filter((match) => {
    if (normalizedHash && match.contentHash === normalizedHash) return true;
    return false;
  });

  const nameMatches = matches.filter(
    (match) => normalizeDuplicateFilename(match.originalName) === normalizedName,
  );
  const nameConflicts = nameMatches.filter((match) => {
    if (fileSize !== null && match.fileSize !== null && match.fileSize !== fileSize) return true;
    if (normalizedHash && match.contentHash && match.contentHash !== normalizedHash) return true;
    return false;
  });
  const possibleMatches = nameMatches.filter((match) => {
    if (exactMatches.some((exact) => exact.id === match.id)) return false;
    if (nameConflicts.some((conflict) => conflict.id === match.id)) return false;
    return fileSize === null || match.fileSize === fileSize;
  });

  const status: DuplicateDetectionStatus =
    exactMatches.length > 0
      ? "already_exists_exact_match"
      : nameConflicts.length > 0
        ? "name_conflict_different_content"
        : possibleMatches.length > 0
          ? "duplicate_possible_manual_review"
          : "none";

  return {
    status,
    matches,
    criteria: {
      filename: params.originalName,
      normalizedFilename: normalizedName,
      size: fileSize,
      checksum: normalizedHash,
      checksumAvailable: normalizedHash !== null,
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
  const job = await ensureJobExists(params.jobId);
  await ensureSystemFolders(params.jobId, { includeJobTemplates: true });

  if (params.parentFolderId) {
    const parentFolder = await getFolderOrThrow(params.parentFolderId);
    if (parentFolder.jobId !== params.jobId || parentFolder.mediaType !== params.mediaType) {
      throw new HttpError(400, "Parent folder does not belong to this job and media type.");
    }
  }

  const [folder] = await db
    .insert(folders)
    .values({
      organizationId: job.organizationId,
      jobId: params.jobId,
      scope: "job",
      parentFolderId: params.parentFolderId,
      mediaType: params.mediaType,
      title: params.title,
      viewingPermissions: { internal: true, users: { [params.userId]: true } },
      uploadingPermissions: {
        admin: true,
        project_manager: true,
        users: { [params.userId]: true },
      },
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
  auth: AuthContext;
}) {
  const organizationId = getActiveOrganizationId(params.auth);
  if (!organizationId) {
    throw new HttpError(400, "An active organization is required.", undefined, "organization-required");
  }

  if (params.parentFolderId) {
    const parentFolder = await getFolderOrThrow(params.parentFolderId);
    if (
      parentFolder.jobId !== null ||
      parentFolder.mediaType !== "document" ||
      parentFolder.organizationId !== organizationId
    ) {
      throw new HttpError(400, "Parent folder must be a resource folder.");
    }
  }

  const [folder] = await db
    .insert(folders)
    .values({
      organizationId,
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
    organizationId,
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

  // Distinguish "field omitted from payload" (undefined) from "field
  // explicitly set to null". `??` collapses both, which silently swallowed
  // requests that were trying to clear a folder's restriction. An explicit
  // `null` is now persisted so users can remove a previously-set restriction.
  const nextViewingPermissions =
    params.viewingPermissions !== undefined ? params.viewingPermissions : folder.viewingPermissions;
  const nextUploadingPermissions =
    params.uploadingPermissions !== undefined
      ? params.uploadingPermissions
      : folder.uploadingPermissions;

  const [updated] = await db
    .update(folders)
    .set({
      title: nextTitle,
      viewingPermissions: nextViewingPermissions,
      uploadingPermissions: nextUploadingPermissions,
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

  if (params.destinationFolderId) {
    const destination = await getFolderOrThrow(params.destinationFolderId);
    if (
      destination.jobId !== folder.jobId ||
      destination.mediaType !== folder.mediaType ||
      destination.organizationId !== folder.organizationId
    ) {
      throw new HttpError(400, "Destination folder does not match the selected job and media type.");
    }

    const allFolders = await getAllFoldersForJob(
      folder.jobId ?? null,
      folder.mediaType,
      true,
      [folderOrganizationCondition(folder)],
    );
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
  // Walk only live (non-deleted) descendants so a copy never resurrects rows
  // that were soft-deleted from the source tree.
  const allFolders = await getAllFoldersForJob(
    folder.jobId ?? null,
    folder.mediaType,
    false,
    [folderOrganizationCondition(folder)],
  );
  const subtreeIds = collectDescendantFolderIds(folder.id, allFolders);
  const subtreeFolders = allFolders.filter((candidate) => subtreeIds.includes(candidate.id));
  const subtreeFiles = await getAllFilesForFolderIds(subtreeIds, false);

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
          organizationId: currentFolder.organizationId,
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
        organizationId: currentFile.organizationId,
        folderId: nextFolderId,
        filename: currentFile.filename,
        originalName: currentFile.originalName,
        fileUrl: currentFile.fileUrl,
        fileSize: currentFile.fileSize,
        contentHash: currentFile.contentHash,
        mimeType: currentFile.mimeType,
        note: currentFile.note,
        uploadedBy: currentFile.uploadedBy,
        durationSeconds: currentFile.durationSeconds,
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

  const allFolders = await getAllFoldersForJob(
    folder.jobId ?? null,
    folder.mediaType,
    true,
    [folderOrganizationCondition(folder)],
  );
  const folderIds = collectDescendantFolderIds(folder.id, allFolders);
  const deletedAt = new Date();

  await db.transaction(async (tx) => {
    // Only stamp rows that are still live. Overwriting an already-deleted
    // child's deletedAt would erase the evidence that it was trashed
    // separately, which restoreFolder relies on to avoid resurrecting it.
    await tx
      .update(folders)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)));

    await tx
      .update(files)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(and(inArray(files.folderId, folderIds), isNull(files.deletedAt)));
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

  const allFolders = await getAllFoldersForJob(
    folder.jobId ?? null,
    folder.mediaType,
    true,
    [folderOrganizationCondition(folder)],
  );
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
  // Only un-delete descendants that were trashed in the same operation as the
  // folder itself. softDeleteFolder stamps every newly-deleted row with one
  // shared Date value, so equality on deletedAt distinguishes "deleted with
  // the parent" from "deleted individually beforehand". Without this filter,
  // restoring the folder would resurrect children the user had already
  // trashed on their own.
  const folderDeletedAt = folder.deletedAt;

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
      .where(and(inArray(folders.id, folderIds), eq(folders.deletedAt, folderDeletedAt)));

    await tx
      .update(files)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(and(inArray(files.folderId, folderIds), eq(files.deletedAt, folderDeletedAt)));
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
  const allFolders = await getAllFoldersForJob(
    folder.jobId ?? null,
    folder.mediaType,
    true,
    [folderOrganizationCondition(folder)],
  );
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
  duplicateAction?: DuplicateAction;
  // Per-file video durations in whole seconds, indexed in lockstep with
  // `uploadedFiles`. The client probes these via an off-DOM <video> at
  // selection time (Task #368). Entries may be null for non-video files
  // or when the probe failed; if the array is omitted entirely we just
  // store null for every file.
  videoDurationsSeconds?: ReadonlyArray<number | null> | null;
}) {
  const folder = await getFolderOrThrow(params.folderId);

  if (params.uploadedFiles.length === 0) {
    throw new HttpError(400, "At least one file is required.");
  }

  const created: File[] = [];
  const uploadResults: Array<{
    originalName: string;
    status: "uploaded" | "skipped_exact_duplicate";
    fileId: string | null;
    duplicate: Awaited<ReturnType<typeof detectFileDuplicate>>;
  }> = [];

  for (const [index, uploadedFile] of params.uploadedFiles.entries()) {
    validateUploadForMediaType(folder.mediaType, uploadedFile);
    const contentHash = normalizeContentHash(uploadedFile.contentHash ?? null);
    const duplicate = await detectFileDuplicate({
      folderId: folder.id,
      originalName: uploadedFile.originalname,
      fileSize: uploadedFile.size,
      contentHash,
    });

    if (
      params.duplicateAction === "fail_on_conflict" &&
      duplicate.status === "name_conflict_different_content"
    ) {
      await cleanupTempUpload(uploadedFile);
      throw new HttpError(
        409,
        `A different file named "${uploadedFile.originalname}" already exists in this folder.`,
        { code: "NAME_CONFLICT_DIFFERENT_CONTENT", duplicate },
        "conflict",
      );
    }

    if (
      params.duplicateAction === "skip_exact" &&
      duplicate.status === "already_exists_exact_match"
    ) {
      await cleanupTempUpload(uploadedFile);
      uploadResults.push({
        originalName: uploadedFile.originalname,
        status: "skipped_exact_duplicate",
        fileId: null,
        duplicate,
      });
      continue;
    }

    const storedName = buildStoredFileName(uploadedFile.originalname);
    const { fileUrl } = buildUploadPath({
      organizationId: folder.organizationId,
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

    // Only persist a duration when the multer-decoded mimetype actually
    // looks like a video — guards against a malicious or buggy client
    // tagging a PDF with a fake "60 seconds" reading.
    const probedDuration = params.videoDurationsSeconds?.[index] ?? null;
    const looksLikeVideo = (uploadedFile.mimetype ?? "").toLowerCase().startsWith("video/");
    const durationSeconds =
      looksLikeVideo && probedDuration != null && Number.isFinite(probedDuration) && probedDuration > 0
        ? Math.min(Math.round(probedDuration), 24 * 60 * 60)
        : null;

    try {
      [file] = await db.transaction(async (tx) =>
        tx
          .insert(files)
          .values({
            organizationId: folder.organizationId,
            folderId: folder.id,
            filename: storedName,
            originalName: uploadedFile.originalname,
            fileUrl,
            fileSize: uploadedFile.size,
            contentHash,
            mimeType: uploadedFile.mimetype,
            note: params.note ?? null,
            uploadedBy: params.userId,
            durationSeconds,
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
    uploadResults.push({
      originalName: uploadedFile.originalname,
      status: "uploaded",
      fileId: file.id,
      duplicate,
    });
  }

  return {
    folder,
    files: created,
    uploadResults,
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

function assertFileDestinationMatchesSource(
  sourceFolder: Folder,
  destination: Folder,
  options: { rejectSameFolder?: boolean } = {},
) {
  if (options.rejectSameFolder && destination.id === sourceFolder.id) {
    throw new HttpError(400, "Destination folder must be different from the source folder.");
  }

  if (
    destination.jobId !== sourceFolder.jobId ||
    destination.mediaType !== sourceFolder.mediaType
  ) {
    throw new HttpError(
      400,
      "Destination folder must belong to the same job and media type as the source folder.",
    );
  }

  if (destination.scope !== sourceFolder.scope) {
    throw new HttpError(
      400,
      "Destination folder must belong to the same scope as the source folder.",
    );
  }

  if (destination.leadId !== sourceFolder.leadId) {
    throw new HttpError(
      400,
      "Destination folder must belong to the same lead as the source folder.",
    );
  }

  if (destination.dailyLogId !== sourceFolder.dailyLogId) {
    throw new HttpError(
      400,
      "Destination folder must belong to the same daily log as the source folder.",
    );
  }

  if (destination.scheduleItemId !== sourceFolder.scheduleItemId) {
    throw new HttpError(
      400,
      "Destination folder must belong to the same schedule item as the source folder.",
    );
  }
}

function assertBatchDestinationMatchesSources(params: {
  fileBatch: readonly File[];
  sourceFoldersById: Map<string, Folder>;
  destination: Folder;
  rejectSameFolder?: boolean;
}) {
  for (const file of params.fileBatch) {
    const sourceFolder = params.sourceFoldersById.get(file.folderId);

    if (!sourceFolder) {
      throw new HttpError(404, "Folder not found.");
    }

    assertFileDestinationMatchesSource(sourceFolder, params.destination, {
      rejectSameFolder: params.rejectSameFolder,
    });
  }
}

export async function moveFile(params: {
  fileId: string;
  destinationFolderId: string;
  userId: string;
}) {
  const file = await getFileOrThrow(params.fileId);
  const sourceFolder = await getFolderOrThrow(file.folderId!);
  const destination = await getFolderOrThrow(params.destinationFolderId);

  assertFileDestinationMatchesSource(sourceFolder, destination);

  const [updated] = await db
    .update(files)
    .set({
      folderId: destination.id,
      updatedAt: new Date(),
    })
    .where(eq(files.id, file.id))
    .returning();

  await writeActivity({
    entityType: "file",
    entityId: updated.id,
    action: "moved",
    userId: params.userId,
    jobId: destination.jobId ?? null,
    mediaType: destination.mediaType,
    folderId: destination.id,
    fileId: updated.id,
    description: `Moved ${updated.originalName} to ${destination.title}`,
  });

  return updated;
}

export async function moveFiles(params: {
  fileIds: string[];
  destinationFolderId: string;
  userId: string;
}) {
  const fileBatch = await getFilesOrThrow(params.fileIds);
  const sourceFoldersById = await getFoldersForFilesOrThrow(fileBatch);
  const destination = await getFolderOrThrow(params.destinationFolderId);

  assertBatchDestinationMatchesSources({
    fileBatch,
    sourceFoldersById,
    destination,
    rejectSameFolder: true,
  });

  const movedAt = new Date();
  const updatedRows = await db.transaction(async (tx) => {
    const rows = await tx
      .update(files)
      .set({
        folderId: destination.id,
        updatedAt: movedAt,
      })
      .where(and(inArray(files.id, fileBatch.map((file) => file.id)), isNull(files.deletedAt)))
      .returning();

    if (rows.length !== fileBatch.length) {
      throw new HttpError(409, "One or more selected files changed before the batch move completed.");
    }

    return rows;
  });
  const updatedById = new Map(updatedRows.map((file) => [file.id, file]));
  const updated = fileBatch.map((file) => updatedById.get(file.id)).filter((file): file is File => !!file);

  for (const file of updated) {
    await writeActivity({
      entityType: "file",
      entityId: file.id,
      action: "moved",
      userId: params.userId,
      jobId: destination.jobId ?? null,
      mediaType: destination.mediaType,
      folderId: destination.id,
      fileId: file.id,
      description: `Moved ${file.originalName} to ${destination.title}`,
      extra: { batchAction: "move", batchSize: updated.length },
    });
  }

  return updated;
}

export async function copyFiles(params: {
  fileIds: string[];
  destinationFolderId: string;
  userId: string;
}) {
  const fileBatch = await getFilesOrThrow(params.fileIds);
  const sourceFoldersById = await getFoldersForFilesOrThrow(fileBatch);
  const destination = await getFolderOrThrow(params.destinationFolderId);

  assertBatchDestinationMatchesSources({
    fileBatch,
    sourceFoldersById,
    destination,
    rejectSameFolder: true,
  });

  const createdRows = await db.transaction(async (tx) => {
    const created: File[] = [];

    for (const file of fileBatch) {
      const [copied] = await tx
        .insert(files)
        .values({
          folderId: destination.id,
          filename: file.filename,
          originalName: file.originalName,
          fileUrl: file.fileUrl,
          fileSize: file.fileSize,
          contentHash: file.contentHash,
          mimeType: file.mimeType,
          note: file.note,
          uploadedBy: file.uploadedBy,
          durationSeconds: file.durationSeconds,
        })
        .returning();
      created.push(copied);
    }

    return created;
  });

  for (const file of createdRows) {
    await writeActivity({
      entityType: "file",
      entityId: file.id,
      action: "copied",
      userId: params.userId,
      jobId: destination.jobId ?? null,
      mediaType: destination.mediaType,
      folderId: destination.id,
      fileId: file.id,
      description: `Copied ${file.originalName} to ${destination.title}`,
      extra: { batchAction: "copy", batchSize: createdRows.length },
    });
  }

  return createdRows;
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

export async function softDeleteFiles(params: {
  fileIds: string[];
  userId: string;
}) {
  const fileBatch = await getFilesOrThrow(params.fileIds);
  const sourceFoldersById = await getFoldersForFilesOrThrow(fileBatch);
  const deletedAt = new Date();

  const updatedRows = await db.transaction(async (tx) => {
    const rows = await tx
      .update(files)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(and(inArray(files.id, fileBatch.map((file) => file.id)), isNull(files.deletedAt)))
      .returning();

    if (rows.length !== fileBatch.length) {
      throw new HttpError(409, "One or more selected files changed before the batch delete completed.");
    }

    return rows;
  });
  const deletedById = new Map(updatedRows.map((file) => [file.id, file]));
  const deleted = fileBatch.map((file) => deletedById.get(file.id)).filter((file): file is File => !!file);

  for (const file of deleted) {
    const folder = sourceFoldersById.get(file.folderId);

    await writeActivity({
      entityType: "file",
      entityId: file.id,
      action: "deleted",
      userId: params.userId,
      jobId: folder?.jobId ?? null,
      mediaType: folder?.mediaType,
      folderId: folder?.id,
      fileId: file.id,
      description: `Moved ${file.originalName} to trash`,
      extra: { batchAction: "delete", batchSize: deleted.length },
    });
  }

  return deleted;
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
  auth?: AuthContext;
}) {
  await ensureJobExists(params.jobId);
  const canManageTrash = params.auth ? await canManageTrashForJob(params.auth, params.jobId) : true;
  const visibilityCondition = params.auth && !canManageTrash
    ? buildFolderVisibilityCondition(params.auth)
    : null;
  const deletedFolderConditions: SQL[] = [
    eq(folders.jobId, params.jobId),
    eq(folders.mediaType, params.mediaType),
    isNotNull(folders.deletedAt),
  ];
  if (visibilityCondition) {
    deletedFolderConditions.push(visibilityCondition);
  }

  const deletedFolders = await db
    .select()
    .from(folders)
    .where(and(...deletedFolderConditions)!)
    .orderBy(desc(folders.deletedAt));

  const deletedFileConditions: SQL[] = [
    eq(folders.jobId, params.jobId),
    eq(folders.mediaType, params.mediaType),
    isNotNull(files.deletedAt),
  ];
  if (visibilityCondition) {
    deletedFileConditions.push(and(isNull(folders.deletedAt), visibilityCondition)!);
  }

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
    .where(and(...deletedFileConditions)!)
    .orderBy(desc(files.deletedAt));

  return {
    folders: deletedFolders,
    files: deletedFiles,
  };
}

async function canManageTrashForJob(auth: AuthContext, jobId: string) {
  if (isAdmin(auth)) {
    return true;
  }

  try {
    await assertCanManageJob(auth, jobId);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 403) {
      return false;
    }

    throw error;
  }
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
  auth: AuthContext;
  jobId?: string | null;
  mediaType?: string | null;
  folderId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  allowedJobIds?: string[] | null;
  allowedLeadIds?: string[] | null;
  page?: number;
  pageSize?: number;
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
  const orgCondition = organizationScopeCondition(params.auth, activityLog.organizationId);
  if (orgCondition) {
    conditions.push(orgCondition);
  }

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

  const cursor = params.cursor ?? null;
  const isCursorMode = params.isCursorMode === true || cursor !== null;
  const limit = isCursorMode
    ? (params.limit ?? 50)
    : (params.pageSize ?? params.limit ?? 50);
  const rawBatchLimit = Math.max(limit * 2, 100);
  type ActivityFeedRow = {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    metadata: unknown;
    description: string | null;
    createdAt: Date;
    userName: string | null;
  };
  const selectRows = (whereClause: SQL | undefined, rowLimit: number, rowOffset: number) =>
    db
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
      .limit(rowLimit)
      .offset(rowOffset);

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
    const visibleRows: ActivityFeedRow[] = [];
    let rawOffset = 0;

    while (visibleRows.length <= limit) {
      const rows = await selectRows(whereClauseCursor, rawBatchLimit, rawOffset);
      if (rows.length === 0) break;

      visibleRows.push(...(await redactActivityRowsForAuth(rows, params.auth)));
      rawOffset += rows.length;
      if (rows.length < rawBatchLimit) break;
    }

    const hasMore = visibleRows.length > limit;
    const trimmed = hasMore ? visibleRows.slice(0, limit) : visibleRows;
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
  const visibleOffset = (page - 1) * limit;
  const data: ActivityFeedRow[] = [];
  let totalItems = 0;
  let rawOffset = 0;

  while (true) {
    const rows = await selectRows(whereClause, rawBatchLimit, rawOffset);
    if (rows.length === 0) break;

    const visibleRows = await redactActivityRowsForAuth(rows, params.auth);
    for (const row of visibleRows) {
      if (totalItems >= visibleOffset && data.length < limit) {
        data.push(row);
      }
      totalItems += 1;
    }

    rawOffset += rows.length;
    if (rows.length < rawBatchLimit) break;
  }

  return {
    data,
    pagination: {
      page,
      pageSize: limit,
      limit,
      total: totalItems,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
    },
  };
}

/**
 * Resolve the set of files a caller is authorized to download as part of a
 * folder ZIP. Walks the descendant tree of `folderId` after dropping any
 * folders the caller cannot view AND any soft-deleted folders, then loads
 * non-deleted files from the surviving folder IDs.
 *
 * The returned entries already carry the in-archive zip name so callers (and
 * tests) don't have to redo the breadcrumb math. Exported so the visibility
 * + soft-delete enforcement is independently testable without standing up
 * object storage.
 */
export async function collectFolderZipEntries(params: {
  folderId: string;
  auth: AuthContext;
}): Promise<{
  rootTitle: string;
  entries: Array<{ fileId: string; fileUrl: string; zipName: string }>;
}> {
  const folder = await getFolderOrThrow(params.folderId);
  // Restrict the descendant set to folders the caller is authorized to view
  // (the route already verified the root) and drop soft-deleted folders so
  // trashed subtrees never get re-zipped behind the user's back.
  const visibilityCondition = buildFolderVisibilityCondition(params.auth);
  const extraConditions: SQL[] = [
    folderOrganizationCondition(folder),
    ...(visibilityCondition ? [visibilityCondition] : []),
  ];
  const allFolders = await getAllFoldersForJob(
    folder.jobId ?? null,
    folder.mediaType,
    false,
    extraConditions,
  );
  const folderMap = new Map(allFolders.map((item) => [item.id, item]));

  // Defense in depth: if the root folder is not in the visibility-filtered
  // set the caller must not have been authorized to view it (or it was
  // soft-deleted). Routes already call `assertCanViewFolder` before us, but
  // this helper is exported and could be called from elsewhere; refusing
  // here keeps the ZIP from leaking the root file directly.
  if (!folderMap.has(folder.id)) {
    throw new HttpError(404, "Folder not found.");
  }
  // `collectDescendantFolderIds` only follows parent links inside the input
  // set, so any restricted (or soft-deleted) subfolder we filtered above is
  // skipped along with everything beneath it.
  const folderIds = collectDescendantFolderIds(folder.id, allFolders);
  // `false` for includeDeleted — the previous `true` here meant a parent-folder
  // download would resurrect soft-deleted files for any user.
  const subtreeFiles = await getAllFilesForFolderIds(folderIds, false);

  const entries: Array<{ fileId: string; fileUrl: string; zipName: string }> = [];

  for (const file of subtreeFiles) {
    if (!file.fileUrl || !file.folderId) {
      continue;
    }

    const trail = buildFolderPath(file.folderId, folderMap);
    const relativeTrail = trail
      .slice(1)
      .map((item) => safeZipPathComponent(item.title, "folder"))
      .filter(Boolean)
      .join("/");
    const rootZipTitle = safeZipPathComponent(folder.title, "folder");
    const fileZipName = safeZipPathComponent(file.originalName, "file");
    const zipName = relativeTrail
      ? path.posix.join(rootZipTitle, relativeTrail, fileZipName)
      : path.posix.join(rootZipTitle, fileZipName);

    entries.push({ fileId: file.id, fileUrl: file.fileUrl, zipName });
  }

  return { rootTitle: safeZipPathComponent(folder.title, "folder"), entries };
}

function uniqueZipEntryName(fileName: string, seenNames: Map<string, number>) {
  const normalized = fileName.toLowerCase();
  const currentCount = seenNames.get(normalized) ?? 0;

  if (currentCount === 0) {
    seenNames.set(normalized, 1);
    return fileName;
  }

  const extension = path.posix.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  let nextCount = currentCount + 1;
  let nextName = `${baseName} (${nextCount})${extension}`;

  while (seenNames.has(nextName.toLowerCase())) {
    nextCount += 1;
    nextName = `${baseName} (${nextCount})${extension}`;
  }

  seenNames.set(normalized, nextCount);
  seenNames.set(nextName.toLowerCase(), 1);
  return nextName;
}

export async function collectSelectedFileZipEntries(params: {
  fileIds: string[];
}): Promise<{
  rootTitle: string;
  entries: Array<{ fileId: string; fileUrl: string; zipName: string }>;
}> {
  const fileBatch = await getFilesOrThrow(params.fileIds);
  const rootTitle = "Selected Files";
  const seenNames = new Map<string, number>();
  const entries: Array<{ fileId: string; fileUrl: string; zipName: string }> = [];

  for (const file of fileBatch) {
    if (!file.fileUrl) {
      continue;
    }

    const safeName = safeZipPathComponent(file.originalName, "file");
    const zipName = path.posix.join(rootTitle, uniqueZipEntryName(safeName, seenNames));
    entries.push({ fileId: file.id, fileUrl: file.fileUrl, zipName });
  }

  return { rootTitle, entries };
}

function configureArchiveResponse(params: {
  res: Response;
  filename: string;
}) {
  params.res.attachment(params.filename);
  // Same safe-header bundle that `streamStoredFileToResponse` applies to
  // single-file downloads. ZIPs are inert by themselves, but the headers
  // keep us consistent across every file-serving response and stop a
  // browser from second-guessing the type if one ever swaps the
  // content-type sniff to "look at the bytes".
  params.res.setHeader("X-Content-Type-Options", "nosniff");
  params.res.setHeader("Content-Security-Policy", FILE_RESPONSE_CSP);
}

export async function streamFolderZip(params: {
  folderId: string;
  res: Response;
  auth: AuthContext;
}) {
  const { rootTitle, entries } = await collectFolderZipEntries({
    folderId: params.folderId,
    auth: params.auth,
  });

  configureArchiveResponse({ res: params.res, filename: `${rootTitle}.zip` });

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

  if (entries.length === 0) {
    archive.append("", { name: `${rootTitle}/` });
  }

  for (const entry of entries) {
    if (!(await storedFileExists(entry.fileUrl))) {
      continue;
    }

    archive.append(await openStoredFileReadStream(entry.fileUrl), {
      name: entry.zipName,
    });
  }

  await archive.finalize();
}

export async function streamSelectedFilesZip(params: {
  fileIds: string[];
  res: Response;
}) {
  const { rootTitle, entries } = await collectSelectedFileZipEntries({
    fileIds: params.fileIds,
  });

  configureArchiveResponse({ res: params.res, filename: `${rootTitle}.zip` });

  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  archive.on("error", (error: Error) => {
    logger.error({ err: error, fileIds: params.fileIds }, "Failed to stream selected file archive");

    if (!params.res.headersSent) {
      params.res.status(500).end();
      return;
    }

    params.res.destroy(error);
  });

  archive.pipe(params.res);

  if (entries.length === 0) {
    archive.append("", { name: `${rootTitle}/` });
  }

  for (const entry of entries) {
    if (!(await storedFileExists(entry.fileUrl))) {
      continue;
    }

    archive.append(await openStoredFileReadStream(entry.fileUrl), {
      name: entry.zipName,
    });
  }

  await archive.finalize();
}
