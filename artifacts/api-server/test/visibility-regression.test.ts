import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

let adminToken: string;
let pmToken: string;
let crewToken: string;
let isolatedPmToken: string;

const adminUserId = crypto.randomUUID();
const otherAdminUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const crewUserId = crypto.randomUUID();
const isolatedPmUserId = crypto.randomUUID();

const clientId = crypto.randomUUID();
const managedJobId = crypto.randomUUID();
const hiddenJobId = crypto.randomUUID();
const pmLeadId = crypto.randomUUID();
const hiddenLeadId = crypto.randomUUID();
const pmLeadContactId = crypto.randomUUID();
const hiddenLeadContactId = crypto.randomUUID();
const privateDailyLogId = crypto.randomUUID();
const hiddenScheduleItemId = crypto.randomUUID();

const leadFolderId = crypto.randomUUID();
const dailyLogFolderId = crypto.randomUUID();
const scheduleFolderId = crypto.randomUUID();
const leadFileId = crypto.randomUUID();
const dailyLogFileId = crypto.randomUUID();
const scheduleFileId = crypto.randomUUID();
const leadAttachmentId = crypto.randomUUID();
const dailyLogAttachmentId = crypto.randomUUID();
const scheduleAttachmentId = crypto.randomUUID();

// Job-folder tree used to assert per-descendant visibility for both
// `GET /jobs/:jobId/folders` and the `streamFolderZip` ZIP path.
//
//  jobFolderRootId           viewing: { internal: true }
//   ├─ jobFolderPublicId     viewing: { internal: true }
//   │   └─ rootPublicFile, publicChildFile
//   ├─ jobFolderRestrictedId viewing: { admin: true, project_manager: true }
//   │   └─ restrictedFile
//   ├─ jobFolderDeletedId    soft-deleted (deletedAt set)
//   │   └─ deletedFolderFile
//   └─ rootDeletedFile (file lives in the visible root but is itself trashed)
const jobFolderRootId = crypto.randomUUID();
const jobFolderPublicId = crypto.randomUUID();
const jobFolderRestrictedId = crypto.randomUUID();
const jobFolderDeletedId = crypto.randomUUID();
const rootPublicFileId = crypto.randomUUID();
const rootDeletedFileId = crypto.randomUUID();
const publicChildFileId = crypto.randomUUID();
const restrictedFileId = crypto.randomUUID();
const deletedFolderFileId = crypto.randomUUID();
const jobFolderTreeIds = [
  jobFolderRootId,
  jobFolderPublicId,
  jobFolderRestrictedId,
  jobFolderDeletedId,
];
const jobFolderFileIds = [
  rootPublicFileId,
  rootDeletedFileId,
  publicChildFileId,
  restrictedFileId,
  deletedFolderFileId,
];

const testUserIds = [
  adminUserId,
  otherAdminUserId,
  pmUserId,
  crewUserId,
  isolatedPmUserId,
];
const testJobIds = [managedJobId, hiddenJobId];
const testLeadIds = [pmLeadId, hiddenLeadId];
const testFolderIds = [
  leadFolderId,
  dailyLogFolderId,
  scheduleFolderId,
  ...jobFolderTreeIds,
];
const testFileIds = [
  leadFileId,
  dailyLogFileId,
  scheduleFileId,
  ...jobFolderFileIds,
];

function makePublicUser(id: string, role: string, email: string, fullName: string) {
  return {
    id,
    email,
    fullName,
    role,
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return {
    ...authHeaders(token),
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // The shared db client (lib/db) prefers SUPABASE_DATABASE_URL when set, but
  // that points at the production pooler with a 15-client cap that the test
  // suites blow through immediately. Force tests to use the local DATABASE_URL.
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const {
    clientContacts,
    clients,
    dailyLogAttachments,
    dailyLogs,
    files,
    folders,
    jobAssignees,
    jobs,
    leadAttachments,
    leadContacts,
    leads,
    scheduleItemAttachments,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  const passwordHash = "test-not-a-real-hash";
  const adminEmail = `admin-${adminUserId}@visibility-test.local`;
  const otherAdminEmail = `other-admin-${otherAdminUserId}@visibility-test.local`;
  const pmEmail = `pm-${pmUserId}@visibility-test.local`;
  const crewEmail = `crew-${crewUserId}@visibility-test.local`;
  const isolatedPmEmail = `isolated-pm-${isolatedPmUserId}@visibility-test.local`;

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash,
      fullName: "ZZZ Visibility Admin",
      role: "admin",
    },
    {
      id: otherAdminUserId,
      email: otherAdminEmail,
      passwordHash,
      fullName: "ZZZ Visibility Other Admin",
      role: "admin",
    },
    {
      id: pmUserId,
      email: pmEmail,
      passwordHash,
      fullName: "ZZZ Visibility PM",
      role: "project_manager",
    },
    {
      id: crewUserId,
      email: crewEmail,
      passwordHash,
      fullName: "ZZZ Visibility Crew",
      role: "crew_member",
    },
    {
      id: isolatedPmUserId,
      email: isolatedPmEmail,
      passwordHash,
      fullName: "ZZZ Visibility Isolated PM",
      role: "project_manager",
    },
  ]);

  await db.insert(clients).values({
    id: clientId,
    companyName: "ZZZ Visibility Client",
    createdBy: otherAdminUserId,
  });

  await db.insert(jobs).values([
    {
      id: managedJobId,
      title: "ZZZ Visibility Managed Job",
      clientId,
      createdBy: pmUserId,
      projectManagerId: pmUserId,
    },
    {
      id: hiddenJobId,
      title: "ZZZ Visibility Hidden Job",
      clientId,
      createdBy: otherAdminUserId,
      projectManagerId: otherAdminUserId,
    },
  ]);

  await db.insert(jobAssignees).values({
    jobId: managedJobId,
    userId: crewUserId,
  });

  await db.insert(leads).values([
    {
      id: pmLeadId,
      title: "ZZZ Visibility PM Lead",
      createdBy: pmUserId,
    },
    {
      id: hiddenLeadId,
      title: "ZZZ Visibility Hidden Lead",
      createdBy: otherAdminUserId,
    },
  ]);

  await db.insert(leadContacts).values([
    {
      id: pmLeadContactId,
      leadId: pmLeadId,
      displayName: "ZZZ Visible Lead Contact",
      email: "visible-contact@example.com",
    },
    {
      id: hiddenLeadContactId,
      leadId: hiddenLeadId,
      displayName: "ZZZ Hidden Lead Contact",
      email: "hidden-contact@example.com",
    },
  ]);

  await db.insert(clientContacts).values({
    id: crypto.randomUUID(),
    clientId,
    firstName: "Visible",
    lastName: "Client",
  });

  await db.insert(dailyLogs).values({
    id: privateDailyLogId,
    jobId: managedJobId,
    logDate: "2999-01-01",
    title: "ZZZ Visibility Private Daily Log",
    notes: "private dashboard regression",
    createdBy: adminUserId,
    isPrivate: true,
    shareInternalUsers: false,
    createdAt: new Date("2999-01-01T00:00:00Z"),
  });

  await db.insert(scheduleItems).values({
    id: hiddenScheduleItemId,
    jobId: managedJobId,
    title: "ZZZ Visibility Hidden Schedule Item",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    workDays: 1,
    createdBy: otherAdminUserId,
    visibleToEstimators: false,
    visibleToInstallers: false,
    visibleToOfficeStaff: false,
  });

  await db.insert(folders).values([
    {
      id: leadFolderId,
      title: `Lead ${hiddenLeadId} Attachments`,
      scope: "lead",
      leadId: hiddenLeadId,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    },
    {
      id: dailyLogFolderId,
      title: `Daily Log ${privateDailyLogId} Attachments`,
      scope: "daily_log",
      dailyLogId: privateDailyLogId,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    },
    {
      id: scheduleFolderId,
      title: `Schedule Item ${hiddenScheduleItemId} Attachments`,
      scope: "schedule_item",
      jobId: managedJobId,
      scheduleItemId: hiddenScheduleItemId,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    },
    {
      id: jobFolderRootId,
      title: "ZZZ Visibility Folder Root",
      scope: "job",
      jobId: managedJobId,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    },
    {
      id: jobFolderPublicId,
      title: "ZZZ Visibility Public Sub",
      scope: "job",
      jobId: managedJobId,
      parentFolderId: jobFolderRootId,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
    },
    {
      id: jobFolderRestrictedId,
      title: "ZZZ Visibility Restricted Sub",
      scope: "job",
      jobId: managedJobId,
      parentFolderId: jobFolderRootId,
      mediaType: "document",
      // Only admins / project managers can view; crew is locked out.
      viewingPermissions: { admin: true, project_manager: true },
      uploadingPermissions: { admin: true, project_manager: true },
    },
    {
      id: jobFolderDeletedId,
      title: "ZZZ Visibility Deleted Sub",
      scope: "job",
      jobId: managedJobId,
      parentFolderId: jobFolderRootId,
      mediaType: "document",
      viewingPermissions: { internal: true },
      uploadingPermissions: { admin: true, project_manager: true },
      deletedAt: new Date("2999-02-01T00:00:00Z"),
      updatedAt: new Date("2999-02-01T00:00:00Z"),
    },
  ]);

  await db.insert(files).values([
    {
      id: leadFileId,
      folderId: leadFolderId,
      filename: "hidden-lead.pdf",
      originalName: "hidden-lead.pdf",
      mimeType: "application/pdf",
      uploadedBy: otherAdminUserId,
    },
    {
      id: dailyLogFileId,
      folderId: dailyLogFolderId,
      filename: "private-daily-log.pdf",
      originalName: "private-daily-log.pdf",
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
    },
    {
      id: scheduleFileId,
      folderId: scheduleFolderId,
      filename: "hidden-schedule.pdf",
      originalName: "hidden-schedule.pdf",
      mimeType: "application/pdf",
      uploadedBy: otherAdminUserId,
    },
    {
      id: rootPublicFileId,
      folderId: jobFolderRootId,
      filename: "root-public.pdf",
      originalName: "root-public.pdf",
      fileUrl: `/uploads/test/${rootPublicFileId}.pdf`,
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
    },
    {
      id: rootDeletedFileId,
      folderId: jobFolderRootId,
      filename: "root-deleted.pdf",
      originalName: "root-deleted.pdf",
      fileUrl: `/uploads/test/${rootDeletedFileId}.pdf`,
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
      deletedAt: new Date("2999-02-02T00:00:00Z"),
      updatedAt: new Date("2999-02-02T00:00:00Z"),
    },
    {
      id: publicChildFileId,
      folderId: jobFolderPublicId,
      filename: "public-child.pdf",
      originalName: "public-child.pdf",
      fileUrl: `/uploads/test/${publicChildFileId}.pdf`,
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
    },
    {
      id: restrictedFileId,
      folderId: jobFolderRestrictedId,
      filename: "restricted.pdf",
      originalName: "restricted.pdf",
      fileUrl: `/uploads/test/${restrictedFileId}.pdf`,
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
    },
    {
      id: deletedFolderFileId,
      folderId: jobFolderDeletedId,
      filename: "in-deleted-folder.pdf",
      originalName: "in-deleted-folder.pdf",
      fileUrl: `/uploads/test/${deletedFolderFileId}.pdf`,
      mimeType: "application/pdf",
      uploadedBy: adminUserId,
    },
  ]);

  await db.insert(leadAttachments).values({
    id: leadAttachmentId,
    leadId: hiddenLeadId,
    fileId: leadFileId,
  });

  await db.insert(dailyLogAttachments).values({
    id: dailyLogAttachmentId,
    dailyLogId: privateDailyLogId,
    fileId: dailyLogFileId,
  });

  await db.insert(scheduleItemAttachments).values({
    id: scheduleAttachmentId,
    scheduleItemId: hiddenScheduleItemId,
    fileId: scheduleFileId,
  });

  adminToken = auth.signAccessToken(
    makePublicUser(adminUserId, "admin", adminEmail, "ZZZ Visibility Admin"),
  );
  pmToken = auth.signAccessToken(
    makePublicUser(pmUserId, "project_manager", pmEmail, "ZZZ Visibility PM"),
  );
  crewToken = auth.signAccessToken(
    makePublicUser(crewUserId, "crew_member", crewEmail, "ZZZ Visibility Crew"),
  );
  isolatedPmToken = auth.signAccessToken(
    makePublicUser(
      isolatedPmUserId,
      "project_manager",
      isolatedPmEmail,
      "ZZZ Visibility Isolated PM",
    ),
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const {
    clientContacts,
    clients,
    dailyLogAttachments,
    dailyLogs,
    files,
    folders,
    jobAssignees,
    jobs,
    leadAttachments,
    leadContacts,
    leads,
    scheduleItemAttachments,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");
  const { inArray, eq } = await import("drizzle-orm");

  try {
    await db.delete(scheduleItemAttachments).where(inArray(scheduleItemAttachments.id, [scheduleAttachmentId]));
    await db.delete(dailyLogAttachments).where(inArray(dailyLogAttachments.id, [dailyLogAttachmentId]));
    await db.delete(leadAttachments).where(inArray(leadAttachments.id, [leadAttachmentId]));
    await db.delete(files).where(inArray(files.id, testFileIds));
    await db.delete(folders).where(inArray(folders.id, testFolderIds));
    await db.delete(scheduleItems).where(eq(scheduleItems.id, hiddenScheduleItemId));
    await db.delete(dailyLogs).where(eq(dailyLogs.id, privateDailyLogId));
    await db.delete(leadContacts).where(inArray(leadContacts.id, [pmLeadContactId, hiddenLeadContactId]));
    await db.delete(leads).where(inArray(leads.id, testLeadIds));
    await db.delete(clientContacts).where(eq(clientContacts.clientId, clientId));
    await db.delete(jobAssignees).where(eq(jobAssignees.jobId, managedJobId));
    await db.delete(jobs).where(inArray(jobs.id, testJobIds));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(users).where(inArray(users.id, testUserIds));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

test("scoped attachment files enforce lead, daily-log, and schedule-item visibility", async () => {
  const cases = [
    { label: "admin", token: adminToken, expected: 200 },
    { label: "project manager", token: pmToken, expected: 403 },
    { label: "crew", token: crewToken, expected: 403 },
    { label: "non-member", token: isolatedPmToken, expected: 403 },
  ];

  for (const fileId of [leadFileId, dailyLogFileId, scheduleFileId]) {
    for (const scenario of cases) {
      const response = await fetch(`${baseUrl}/api/files/${fileId}/annotations`, {
        headers: authHeaders(scenario.token),
      });
      assert.equal(
        response.status,
        scenario.expected,
        `${scenario.label} expected ${scenario.expected} for file ${fileId}`,
      );
    }
  }
});

test("resource folders exclude scoped lead and schedule attachment folders", async () => {
  const response = await fetch(`${baseUrl}/api/resources/folders?all=true`, {
    headers: authHeaders(pmToken),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { folders: Array<{ id: string }> };
  const ids = new Set(body.folders.map((folder) => folder.id));

  for (const folderId of testFolderIds) {
    assert.equal(ids.has(folderId), false);
  }
});

test("dashboard applies schedule and daily-log visibility filters", async () => {
  const pmAgenda = await fetch(`${baseUrl}/api/dashboard/agenda`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(pmAgenda.status, 200);
  const pmAgendaBody = (await pmAgenda.json()) as {
    recentLogs: Array<{ id: string }>;
    upcomingItems: Array<{ id: string }>;
  };
  assert.equal(pmAgendaBody.recentLogs.some((log) => log.id === privateDailyLogId), false);
  assert.equal(pmAgendaBody.upcomingItems.some((item) => item.id === hiddenScheduleItemId), false);

  const adminSchedule = await fetch(`${baseUrl}/api/dashboard/schedule`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(adminSchedule.status, 200);
  const adminScheduleBody = (await adminSchedule.json()) as { items: Array<{ id: string }> };
  assert.equal(adminScheduleBody.items.some((item) => item.id === hiddenScheduleItemId), true);

  const pmSchedule = await fetch(`${baseUrl}/api/dashboard/schedule`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(pmSchedule.status, 200);
  const pmScheduleBody = (await pmSchedule.json()) as { items: Array<{ id: string }> };
  assert.equal(pmScheduleBody.items.some((item) => item.id === hiddenScheduleItemId), false);
});

test("client job lists are intersected with job visibility", async () => {
  const adminResponse = await fetch(`${baseUrl}/api/clients/${clientId}/jobs`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(adminResponse.status, 200);
  const adminBody = (await adminResponse.json()) as { jobs: Array<{ id: string }> };
  assert.equal(adminBody.jobs.some((job) => job.id === managedJobId), true);
  assert.equal(adminBody.jobs.some((job) => job.id === hiddenJobId), true);

  const pmResponse = await fetch(`${baseUrl}/api/clients/${clientId}/jobs`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(pmResponse.status, 200);
  const pmBody = (await pmResponse.json()) as { jobs: Array<{ id: string }> };
  assert.equal(pmBody.jobs.some((job) => job.id === managedJobId), true);
  assert.equal(pmBody.jobs.some((job) => job.id === hiddenJobId), false);

  const crewResponse = await fetch(`${baseUrl}/api/clients/${clientId}/jobs`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(crewResponse.status, 403);

  const isolatedResponse = await fetch(`${baseUrl}/api/clients/${clientId}/jobs`, {
    headers: authHeaders(isolatedPmToken),
  });
  assert.equal(isolatedResponse.status, 403);
});

test("job folder list excludes non-viewable and soft-deleted descendants", async () => {
  type FolderListItem = {
    id: string;
    title: string;
    childFolderCount: number;
    fileCount: number;
  };
  type FolderListResponse = { folders: FolderListItem[] };

  // Admin: sees both visible immediate subfolders, soft-deleted folder is gone.
  const adminResponse = await fetch(
    `${baseUrl}/api/jobs/${managedJobId}/folders?mediaType=document&parentId=${jobFolderRootId}`,
    { headers: authHeaders(adminToken) },
  );
  assert.equal(adminResponse.status, 200);
  const adminBody = (await adminResponse.json()) as FolderListResponse;
  const adminIds = new Set(adminBody.folders.map((folder) => folder.id));
  assert.equal(adminIds.has(jobFolderPublicId), true);
  assert.equal(adminIds.has(jobFolderRestrictedId), true);
  assert.equal(
    adminIds.has(jobFolderDeletedId),
    false,
    "soft-deleted subfolder must not appear",
  );

  // PM: same visibility as admin for these folders (admin+pm only restricted folder is visible to PM too).
  const pmResponse = await fetch(
    `${baseUrl}/api/jobs/${managedJobId}/folders?mediaType=document&parentId=${jobFolderRootId}`,
    { headers: authHeaders(pmToken) },
  );
  assert.equal(pmResponse.status, 200);
  const pmBody = (await pmResponse.json()) as FolderListResponse;
  const pmIds = new Set(pmBody.folders.map((folder) => folder.id));
  assert.equal(pmIds.has(jobFolderPublicId), true);
  assert.equal(pmIds.has(jobFolderRestrictedId), true);

  // Crew: restricted subfolder must be hidden, public still visible.
  const crewResponse = await fetch(
    `${baseUrl}/api/jobs/${managedJobId}/folders?mediaType=document&parentId=${jobFolderRootId}`,
    { headers: authHeaders(crewToken) },
  );
  assert.equal(crewResponse.status, 200);
  const crewBody = (await crewResponse.json()) as FolderListResponse;
  const crewIds = new Set(crewBody.folders.map((folder) => folder.id));
  assert.equal(crewIds.has(jobFolderPublicId), true);
  assert.equal(
    crewIds.has(jobFolderRestrictedId),
    false,
    "crew must not see admin/pm-only folder in list",
  );
  assert.equal(crewIds.has(jobFolderDeletedId), false);

  // Counts on the public sibling reflect only visible+non-deleted descendants.
  const publicForCrew = crewBody.folders.find((folder) => folder.id === jobFolderPublicId);
  assert.ok(publicForCrew);
  assert.equal(publicForCrew!.childFolderCount, 0);
  assert.equal(publicForCrew!.fileCount, 1);

  // Listing the parent of jobFolderRootId returns counts for the root that
  // exclude the restricted subtree for crew but include it for admins.
  const adminParentResponse = await fetch(
    `${baseUrl}/api/jobs/${managedJobId}/folders?mediaType=document`,
    { headers: authHeaders(adminToken) },
  );
  assert.equal(adminParentResponse.status, 200);
  const adminParentBody = (await adminParentResponse.json()) as FolderListResponse;
  const adminRoot = adminParentBody.folders.find((folder) => folder.id === jobFolderRootId);
  assert.ok(adminRoot, "admin should see root folder at job scope");
  // Two visible immediate children (public + restricted); deleted is excluded.
  assert.equal(adminRoot!.childFolderCount, 2);
  // Direct (not subtree) files in the root: 1 non-deleted, soft-deleted excluded.
  assert.equal(adminRoot!.fileCount, 1);

  const crewParentResponse = await fetch(
    `${baseUrl}/api/jobs/${managedJobId}/folders?mediaType=document`,
    { headers: authHeaders(crewToken) },
  );
  assert.equal(crewParentResponse.status, 200);
  const crewParentBody = (await crewParentResponse.json()) as FolderListResponse;
  const crewRoot = crewParentBody.folders.find((folder) => folder.id === jobFolderRootId);
  assert.ok(crewRoot, "crew should see root folder via internal:true permission");
  // Only public child is visible (restricted folder hidden, deleted folder gone).
  assert.equal(crewRoot!.childFolderCount, 1);
  // Direct files only — root non-deleted file (1). Restricted/deleted files
  // are not direct children of the root.
  assert.equal(crewRoot!.fileCount, 1);
});

test("folder ZIP entries respect viewing permissions and skip soft-deleted files", async () => {
  const { collectFolderZipEntries } = await import("../src/lib/file-manager.ts");
  type Auth = Parameters<typeof collectFolderZipEntries>[0]["auth"];

  const adminAuth = { userId: adminUserId, role: "admin" } as Auth;
  const pmAuth = { userId: pmUserId, role: "project_manager" } as Auth;
  const crewAuth = { userId: crewUserId, role: "crew_member" } as Auth;

  const adminResult = await collectFolderZipEntries({
    folderId: jobFolderRootId,
    auth: adminAuth,
  });
  const adminFileIds = new Set(adminResult.entries.map((entry) => entry.fileId));
  assert.equal(adminFileIds.has(rootPublicFileId), true);
  assert.equal(adminFileIds.has(publicChildFileId), true);
  assert.equal(adminFileIds.has(restrictedFileId), true);
  assert.equal(adminFileIds.has(rootDeletedFileId), false, "soft-deleted file must be excluded");
  assert.equal(
    adminFileIds.has(deletedFolderFileId),
    false,
    "files inside soft-deleted folders must be excluded",
  );

  const pmResult = await collectFolderZipEntries({
    folderId: jobFolderRootId,
    auth: pmAuth,
  });
  const pmFileIds = new Set(pmResult.entries.map((entry) => entry.fileId));
  assert.equal(pmFileIds.has(rootPublicFileId), true);
  assert.equal(pmFileIds.has(publicChildFileId), true);
  assert.equal(pmFileIds.has(restrictedFileId), true);
  assert.equal(pmFileIds.has(rootDeletedFileId), false);
  assert.equal(pmFileIds.has(deletedFolderFileId), false);

  const crewResult = await collectFolderZipEntries({
    folderId: jobFolderRootId,
    auth: crewAuth,
  });
  const crewFileIds = new Set(crewResult.entries.map((entry) => entry.fileId));
  assert.equal(crewFileIds.has(rootPublicFileId), true);
  assert.equal(crewFileIds.has(publicChildFileId), true);
  assert.equal(
    crewFileIds.has(restrictedFileId),
    false,
    "crew must not be able to download files from admin/pm-only folder",
  );
  assert.equal(crewFileIds.has(rootDeletedFileId), false);
  assert.equal(crewFileIds.has(deletedFolderFileId), false);

  // ZIP entry names are anchored under the root folder title and preserve the
  // visible breadcrumb path so the archive layout matches the visible tree.
  const publicChildEntry = adminResult.entries.find((entry) => entry.fileId === publicChildFileId);
  assert.ok(publicChildEntry);
  assert.equal(
    publicChildEntry!.zipName,
    "ZZZ Visibility Folder Root/ZZZ Visibility Public Sub/public-child.pdf",
  );

  // Defense-in-depth: calling collectFolderZipEntries for a root the caller
  // cannot view (here: the admin/PM-only restricted subfolder, asked for as
  // crew) must refuse rather than silently leak its files.
  await assert.rejects(
    () =>
      collectFolderZipEntries({
        folderId: jobFolderRestrictedId,
        auth: crewAuth,
      }),
    (err: unknown) => {
      const statusCode = (err as { statusCode?: number }).statusCode;
      return statusCode === 404;
    },
  );
});

test("lead detail and contact-copy source are scoped to accessible leads", async () => {
  const adminResponse = await fetch(`${baseUrl}/api/leads/${pmLeadId}`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(adminResponse.status, 200);
  const adminBody = (await adminResponse.json()) as {
    lead: { availableContacts: Array<{ id: string }> };
  };
  assert.equal(adminBody.lead.availableContacts.some((contact) => contact.id === hiddenLeadContactId), true);

  const pmResponse = await fetch(`${baseUrl}/api/leads/${pmLeadId}`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(pmResponse.status, 200);
  const pmBody = (await pmResponse.json()) as {
    lead: { availableContacts: Array<{ id: string }> };
  };
  assert.equal(pmBody.lead.availableContacts.some((contact) => contact.id === pmLeadContactId), true);
  assert.equal(pmBody.lead.availableContacts.some((contact) => contact.id === hiddenLeadContactId), false);

  const crewResponse = await fetch(`${baseUrl}/api/leads/${pmLeadId}`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(crewResponse.status, 403);

  const copyResponse = await fetch(`${baseUrl}/api/leads/${pmLeadId}/contacts`, {
    method: "POST",
    headers: jsonHeaders(pmToken),
    body: JSON.stringify({ sourceContactId: hiddenLeadContactId }),
  });
  assert.equal(copyResponse.status, 403);
});
