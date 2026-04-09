import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  clients,
  dailyLogAttachments,
  dailyLogs,
  files,
  folders,
  jobAssignees,
  leadAttachments,
  leadSalespeople,
  leads,
  jobs,
  scheduleItemAssignees,
  scheduleItemAttachments,
  scheduleItems,
} from "@workspace/db/schema";
import { HttpError } from "./http";

export type AppRole = "admin" | "project_manager" | "crew_member";

export type AuthContext = NonNullable<Express.Request["auth"]>;

type FolderAccessRecord = {
  id: string;
  jobId: string | null;
  mediaType: string;
  viewingPermissions: Record<string, unknown> | null;
  uploadingPermissions: Record<string, unknown> | null;
};

type FileAccessRecord = {
  id: string;
  fileUrl: string | null;
  folderId: string | null;
  folderJobId: string | null;
  folderMediaType: string | null;
  viewingPermissions: Record<string, unknown> | null;
  uploadingPermissions: Record<string, unknown> | null;
  leadId: string | null;
  dailyLogJobId: string | null;
  scheduleJobId: string | null;
};

type DailyLogAccessRecord = {
  id: string;
  jobId: string | null;
  createdBy: string | null;
  isPrivate: boolean | null;
  shareInternalUsers: boolean | null;
};

type ScheduleItemAccessRecord = {
  id: string;
  jobId: string | null;
  createdBy: string | null;
  visibleToEstimators: boolean | null;
  visibleToInstallers: boolean | null;
  visibleToOfficeStaff: boolean | null;
  isAssignedToCurrentUser: boolean;
};

function roleFromAuth(auth: AuthContext): AppRole {
  if (auth.role === "admin" || auth.role === "project_manager" || auth.role === "crew_member") {
    return auth.role;
  }

  throw new HttpError(403, "User role is not recognized.");
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter((value): value is string => typeof value === "string")));
}

function permissionEnabled(
  permissions: Record<string, unknown> | null,
  key: string,
): boolean {
  return permissions?.[key] === true;
}

export function isAdmin(auth: AuthContext) {
  return roleFromAuth(auth) === "admin";
}

export function isManagerOrAbove(auth: AuthContext) {
  const role = roleFromAuth(auth);
  return role === "admin" || role === "project_manager";
}

export async function listManagedJobIds(auth: AuthContext): Promise<string[] | null> {
  if (isAdmin(auth)) {
    return null;
  }

  if (roleFromAuth(auth) !== "project_manager") {
    return [];
  }

  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        or(eq(jobs.projectManagerId, auth.userId), eq(jobs.createdBy, auth.userId)),
      ),
    );

  return rows.map((row) => row.id);
}

export async function listAccessibleJobIds(auth: AuthContext): Promise<string[] | null> {
  if (isAdmin(auth)) {
    return null;
  }

  const role = roleFromAuth(auth);
  const assignedJobRowsPromise = db
    .select({ id: jobAssignees.jobId })
    .from(jobAssignees)
    .innerJoin(jobs, eq(jobAssignees.jobId, jobs.id))
    .where(
      and(
        eq(jobAssignees.userId, auth.userId),
        isNull(jobs.deletedAt),
      ),
    );

  if (role === "project_manager") {
    const [managedJobIds, assignedJobRows] = await Promise.all([
      listManagedJobIds(auth),
      assignedJobRowsPromise,
    ]);

    return uniqueIds([
      ...(managedJobIds ?? []),
      ...assignedJobRows.map((row) => row.id),
    ]);
  }

  const [createdRows, assignedRows, dailyLogRows, uploadedRows, jobAssigneeRows] = await Promise.all([
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(isNull(jobs.deletedAt), eq(jobs.createdBy, auth.userId))),
    db
      .select({ id: scheduleItems.jobId })
      .from(scheduleItemAssignees)
      .innerJoin(scheduleItems, eq(scheduleItemAssignees.scheduleItemId, scheduleItems.id))
      .innerJoin(jobs, eq(scheduleItems.jobId, jobs.id))
      .where(
        and(
          eq(scheduleItemAssignees.userId, auth.userId),
          isNull(scheduleItems.deletedAt),
          isNull(jobs.deletedAt),
        ),
      ),
    db
      .select({ id: dailyLogs.jobId })
      .from(dailyLogs)
      .innerJoin(jobs, eq(dailyLogs.jobId, jobs.id))
      .where(
        and(
          eq(dailyLogs.createdBy, auth.userId),
          isNull(dailyLogs.deletedAt),
          isNull(jobs.deletedAt),
        ),
      ),
    db
      .select({ id: folders.jobId })
      .from(files)
      .innerJoin(folders, eq(files.folderId, folders.id))
      .innerJoin(jobs, eq(folders.jobId, jobs.id))
      .where(
        and(
          eq(files.uploadedBy, auth.userId),
          isNull(files.deletedAt),
          isNull(folders.deletedAt),
          isNull(jobs.deletedAt),
        ),
      ),
    assignedJobRowsPromise,
  ]);

  return uniqueIds([
    ...createdRows.map((row) => row.id),
    ...assignedRows.map((row) => row.id),
    ...dailyLogRows.map((row) => row.id),
    ...uploadedRows.map((row) => row.id),
    ...jobAssigneeRows.map((row) => row.id),
  ]);
}

export async function listAccessibleLeadIds(auth: AuthContext): Promise<string[] | null> {
  if (isAdmin(auth)) {
    return null;
  }

  if (roleFromAuth(auth) !== "project_manager") {
    return [];
  }

  const [createdRows, assignedRows] = await Promise.all([
    db
      .select({ id: leads.id })
      .from(leads)
      .where(and(isNull(leads.deletedAt), eq(leads.createdBy, auth.userId))),
    db
      .select({ id: leads.id })
      .from(leadSalespeople)
      .innerJoin(leads, eq(leadSalespeople.leadId, leads.id))
      .where(
        and(
          eq(leadSalespeople.userId, auth.userId),
          isNull(leads.deletedAt),
        ),
      ),
  ]);

  return uniqueIds([
    ...createdRows.map((row) => row.id),
    ...assignedRows.map((row) => row.id),
  ]);
}

export async function listAccessibleClientIds(auth: AuthContext): Promise<string[] | null> {
  if (isAdmin(auth)) {
    return null;
  }

  if (!isManagerOrAbove(auth)) {
    return [];
  }

  const managedJobIds = await listManagedJobIds(auth);
  const createdClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.createdBy, auth.userId)));

  if (!managedJobIds || managedJobIds.length === 0) {
    return uniqueIds(createdClients.map((row) => row.id));
  }

  const relatedClients = await db
    .select({ id: jobs.clientId })
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        inArray(jobs.id, managedJobIds),
        isNull(jobs.deletedAt),
      ),
    );

  return uniqueIds([
    ...createdClients.map((row) => row.id),
    ...relatedClients.map((row) => row.id),
  ]);
}

export async function assertCanAccessJob(auth: AuthContext, jobId: string) {
  if (isAdmin(auth)) {
    return;
  }

  const jobIds = await listAccessibleJobIds(auth);

  if (!jobIds?.includes(jobId)) {
    throw new HttpError(403, "You do not have access to that job.");
  }
}

export async function assertCanManageJob(auth: AuthContext, jobId: string) {
  if (isAdmin(auth)) {
    return;
  }

  if (roleFromAuth(auth) !== "project_manager") {
    throw new HttpError(403, "You do not have permission to modify that job.");
  }

  const jobIds = await listManagedJobIds(auth);

  if (!jobIds?.includes(jobId)) {
    throw new HttpError(403, "You do not have permission to modify that job.");
  }
}

export async function assertCanAccessLead(auth: AuthContext, leadId: string) {
  if (isAdmin(auth)) {
    return;
  }

  const leadIds = await listAccessibleLeadIds(auth);

  if (!leadIds?.includes(leadId)) {
    throw new HttpError(403, "You do not have access to that lead.");
  }
}

export async function assertCanManageLead(auth: AuthContext, leadId: string) {
  if (isAdmin(auth)) {
    return;
  }

  if (roleFromAuth(auth) !== "project_manager") {
    throw new HttpError(403, "You do not have permission to modify that lead.");
  }

  const leadIds = await listAccessibleLeadIds(auth);

  if (!leadIds?.includes(leadId)) {
    throw new HttpError(403, "You do not have permission to modify that lead.");
  }
}

export async function assertCanAccessClient(auth: AuthContext, clientId: string) {
  if (isAdmin(auth)) {
    return;
  }

  const clientIds = await listAccessibleClientIds(auth);

  if (!clientIds?.includes(clientId)) {
    throw new HttpError(403, "You do not have access to that client.");
  }
}

export async function assertCanManageClient(auth: AuthContext, clientId: string) {
  if (!isManagerOrAbove(auth)) {
    throw new HttpError(403, "You do not have permission to modify that client.");
  }

  await assertCanAccessClient(auth, clientId);
}

function canViewFolderForRole(auth: AuthContext, folder: FolderAccessRecord) {
  if (isAdmin(auth)) {
    return true;
  }

  const role = roleFromAuth(auth);
  return (
    permissionEnabled(folder.viewingPermissions, role) ||
    permissionEnabled(folder.viewingPermissions, "internal") ||
    folder.viewingPermissions === null
  );
}

function canUploadToFolderForRole(auth: AuthContext, folder: FolderAccessRecord) {
  if (isAdmin(auth)) {
    return true;
  }

  const role = roleFromAuth(auth);

  if (folder.uploadingPermissions === null) {
    return isManagerOrAbove(auth);
  }

  return (
    permissionEnabled(folder.uploadingPermissions, role) ||
    permissionEnabled(folder.uploadingPermissions, "internal")
  );
}

async function getFolderAccessOrThrow(folderId: string, includeDeleted = false) {
  const conditions = [eq(folders.id, folderId)];

  if (!includeDeleted) {
    conditions.push(isNull(folders.deletedAt));
  }

  const [folder] = await db
    .select({
      id: folders.id,
      jobId: folders.jobId,
      mediaType: folders.mediaType,
      viewingPermissions: folders.viewingPermissions,
      uploadingPermissions: folders.uploadingPermissions,
    })
    .from(folders)
    .where(and(...conditions))
    .limit(1);

  if (!folder) {
    throw new HttpError(404, "Folder not found.");
  }

  return folder satisfies FolderAccessRecord;
}

export async function assertCanViewFolder(
  auth: AuthContext,
  folderId: string,
  includeDeleted = false,
) {
  const folder = await getFolderAccessOrThrow(folderId, includeDeleted);

  if (folder.jobId) {
    await assertCanAccessJob(auth, folder.jobId);
  }

  if (!canViewFolderForRole(auth, folder)) {
    throw new HttpError(403, "You do not have access to that folder.");
  }

  return folder;
}

export async function assertCanUploadToFolder(
  auth: AuthContext,
  folderId: string,
  includeDeleted = false,
) {
  const folder = await assertCanViewFolder(auth, folderId, includeDeleted);

  if (!canUploadToFolderForRole(auth, folder)) {
    throw new HttpError(403, "You do not have permission to upload to that folder.");
  }

  return folder;
}

async function getFileAccessRecord(params: { fileId?: string; fileUrl?: string; includeDeleted?: boolean }) {
  const conditions = params.fileId
    ? [eq(files.id, params.fileId)]
    : params.fileUrl
      ? [eq(files.fileUrl, params.fileUrl)]
      : [];

  if (conditions.length === 0) {
    throw new HttpError(500, "File access lookup is missing a target.");
  }

  if (!params.includeDeleted) {
    conditions.push(isNull(files.deletedAt));
  }

  const [record] = await db
    .select({
      id: files.id,
      fileUrl: files.fileUrl,
      folderId: folders.id,
      folderJobId: folders.jobId,
      folderMediaType: folders.mediaType,
      viewingPermissions: folders.viewingPermissions,
      uploadingPermissions: folders.uploadingPermissions,
      leadId: leadAttachments.leadId,
      dailyLogJobId: dailyLogs.jobId,
      scheduleJobId: scheduleItems.jobId,
    })
    .from(files)
    .leftJoin(folders, eq(files.folderId, folders.id))
    .leftJoin(leadAttachments, eq(leadAttachments.fileId, files.id))
    .leftJoin(dailyLogAttachments, eq(dailyLogAttachments.fileId, files.id))
    .leftJoin(dailyLogs, eq(dailyLogAttachments.dailyLogId, dailyLogs.id))
    .leftJoin(scheduleItemAttachments, eq(scheduleItemAttachments.fileId, files.id))
    .leftJoin(scheduleItems, eq(scheduleItemAttachments.scheduleItemId, scheduleItems.id))
    .where(and(...conditions))
    .limit(1);

  if (!record) {
    throw new HttpError(404, "File not found.");
  }

  return record satisfies FileAccessRecord;
}

async function assertFileAccess(auth: AuthContext, record: FileAccessRecord, mode: "view" | "manage") {
  if (record.folderId) {
    const folderLike: FolderAccessRecord = {
      id: record.folderId,
      jobId: record.folderJobId,
      mediaType: record.folderMediaType ?? "document",
      viewingPermissions: record.viewingPermissions,
      uploadingPermissions: record.uploadingPermissions,
    };

    if (record.folderJobId) {
      await assertCanAccessJob(auth, record.folderJobId);
    }

    if (mode === "view" && !canViewFolderForRole(auth, folderLike)) {
      throw new HttpError(403, "You do not have access to that file.");
    }

    if (mode === "manage" && !canUploadToFolderForRole(auth, folderLike)) {
      throw new HttpError(403, "You do not have permission to modify that file.");
    }

    return;
  }

  if (record.dailyLogJobId) {
    if (mode === "view") {
      await assertCanAccessJob(auth, record.dailyLogJobId);
      return;
    }

    await assertCanManageJob(auth, record.dailyLogJobId);
    return;
  }

  if (record.scheduleJobId) {
    if (mode === "view") {
      await assertCanAccessJob(auth, record.scheduleJobId);
      return;
    }

    await assertCanManageJob(auth, record.scheduleJobId);
    return;
  }

  if (record.leadId) {
    if (mode === "view") {
      await assertCanAccessLead(auth, record.leadId);
      return;
    }

    await assertCanManageLead(auth, record.leadId);
    return;
  }

  throw new HttpError(403, "You do not have access to that file.");
}

export async function assertCanViewFile(auth: AuthContext, fileId: string, includeDeleted = false) {
  const record = await getFileAccessRecord({ fileId, includeDeleted });
  await assertFileAccess(auth, record, "view");
  return record;
}

export async function assertCanManageFile(auth: AuthContext, fileId: string) {
  const record = await getFileAccessRecord({ fileId });
  await assertFileAccess(auth, record, "manage");
  return record;
}

export async function assertCanAccessUploadPath(auth: AuthContext, fileUrl: string) {
  const record = await getFileAccessRecord({ fileUrl });
  await assertFileAccess(auth, record, "view");
  return record;
}

async function getDailyLogAccessOrThrow(logId: string) {
  const [log] = await db
    .select({
      id: dailyLogs.id,
      jobId: dailyLogs.jobId,
      createdBy: dailyLogs.createdBy,
      isPrivate: dailyLogs.isPrivate,
      shareInternalUsers: dailyLogs.shareInternalUsers,
    })
    .from(dailyLogs)
    .where(and(eq(dailyLogs.id, logId), isNull(dailyLogs.deletedAt)))
    .limit(1);

  if (!log) {
    throw new HttpError(404, "Daily log not found.");
  }

  return log satisfies DailyLogAccessRecord;
}

export async function assertCanViewDailyLog(auth: AuthContext, logId: string) {
  const log = await getDailyLogAccessOrThrow(logId);

  if (!log.jobId) {
    throw new HttpError(403, "You do not have access to that daily log.");
  }

  await assertCanAccessJob(auth, log.jobId);

  if (isAdmin(auth) || log.createdBy === auth.userId) {
    return log;
  }

  if (log.isPrivate || log.shareInternalUsers === false) {
    throw new HttpError(403, "You do not have access to that daily log.");
  }

  return log;
}

export async function assertCanEditDailyLog(auth: AuthContext, logId: string) {
  const log = await getDailyLogAccessOrThrow(logId);

  if (isAdmin(auth) || log.createdBy === auth.userId) {
    return log;
  }

  if (log.jobId && roleFromAuth(auth) === "project_manager") {
    await assertCanManageJob(auth, log.jobId);
    return log;
  }

  throw new HttpError(403, "You do not have permission to modify that daily log.");
}

async function getScheduleItemAccessOrThrow(auth: AuthContext, itemId: string) {
  const [item] = await db
    .select({
      id: scheduleItems.id,
      jobId: scheduleItems.jobId,
      createdBy: scheduleItems.createdBy,
      visibleToEstimators: scheduleItems.visibleToEstimators,
      visibleToInstallers: scheduleItems.visibleToInstallers,
      visibleToOfficeStaff: scheduleItems.visibleToOfficeStaff,
      isAssignedToCurrentUser: scheduleItemAssignees.userId,
    })
    .from(scheduleItems)
    .leftJoin(
      scheduleItemAssignees,
      and(
        eq(scheduleItemAssignees.scheduleItemId, scheduleItems.id),
        eq(scheduleItemAssignees.userId, auth.userId),
      ),
    )
    .where(and(eq(scheduleItems.id, itemId), isNull(scheduleItems.deletedAt)))
    .limit(1);

  if (!item) {
    throw new HttpError(404, "Schedule item not found.");
  }

  return {
    ...item,
    isAssignedToCurrentUser: typeof item.isAssignedToCurrentUser === "string",
  } satisfies ScheduleItemAccessRecord;
}

function canViewScheduleItem(auth: AuthContext, item: ScheduleItemAccessRecord) {
  if (isAdmin(auth) || item.createdBy === auth.userId || item.isAssignedToCurrentUser) {
    return true;
  }

  const role = roleFromAuth(auth);

  if (role === "project_manager") {
    return item.visibleToOfficeStaff !== false || item.visibleToEstimators !== false;
  }

  return item.visibleToInstallers !== false;
}

export async function assertCanViewScheduleItem(auth: AuthContext, itemId: string) {
  const item = await getScheduleItemAccessOrThrow(auth, itemId);

  if (!item.jobId) {
    throw new HttpError(403, "You do not have access to that schedule item.");
  }

  await assertCanAccessJob(auth, item.jobId);

  if (!canViewScheduleItem(auth, item)) {
    throw new HttpError(403, "You do not have access to that schedule item.");
  }

  return item;
}

export async function assertCanManageScheduleItem(auth: AuthContext, itemId: string) {
  const item = await assertCanViewScheduleItem(auth, itemId);

  if (isAdmin(auth)) {
    return item;
  }

  if (roleFromAuth(auth) === "project_manager" && item.jobId) {
    await assertCanManageJob(auth, item.jobId);
    return item;
  }

  throw new HttpError(403, "You do not have permission to modify that schedule item.");
}
