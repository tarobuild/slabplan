import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import {
  DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES,
  DIRECT_UPLOAD_EDGE_LIMIT_BYTES,
  MAX_UPLOAD_FILE_BYTES,
} from "@workspace/api-zod";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminToken: string;
let pmToken: string;
let drafterToken: string;
let localStorageRoot: string;

const adminUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const drafterUserId = crypto.randomUUID();
const crewInviteEmail = `crew-invite-${crypto.randomUUID()}@anwar-platform-test.local`;
const drafterInviteEmail = `drafter-invite-${crypto.randomUUID()}@anwar-platform-test.local`;
const clientId = crypto.randomUUID();
const visibleJobId = crypto.randomUUID();
const hiddenJobId = crypto.randomUUID();
const deletedJobId = crypto.randomUUID();
const drafterScheduleJobId = crypto.randomUUID();
const drafterCreateJobId = crypto.randomUUID();
const assignedLeadId = crypto.randomUUID();
const hiddenLeadId = crypto.randomUUID();
const assignedScheduleItemId = crypto.randomUUID();
const createdScheduleItemId = crypto.randomUUID();
const hiddenScheduleItemId = crypto.randomUUID();
const drafterWorkspaceFolderIds: string[] = [];
const drafterWorkspaceFileIds: string[] = [];

function isoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const assignedScheduleDate = isoDaysFromNow(5);
const createdScheduleDate = isoDaysFromNow(6);
const hiddenScheduleDate = isoDaysFromNow(7);

const testUserIds = [adminUserId, pmUserId, drafterUserId];
const testJobIds = [visibleJobId, hiddenJobId, deletedJobId, drafterScheduleJobId, drafterCreateJobId];
const testLeadIds = [assignedLeadId, hiddenLeadId];
const testScheduleItemIds = [
  assignedScheduleItemId,
  createdScheduleItemId,
  hiddenScheduleItemId,
];

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
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";
  process.env.CADSTONE_STORAGE_BACKEND = "local";
  localStorageRoot = await mkdtemp(path.join(os.tmpdir(), "cadstone-anwar-platform-"));
  process.env.CADSTONE_LOCAL_STORAGE_ROOT = localStorageRoot;

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const emailModule = await import("../src/lib/email.ts");
  const { db } = await import("@workspace/db");
  const {
    clients,
    jobAssignees,
    jobs,
    leads,
    leadSalespeople,
    scheduleItemAssignees,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  emailModule.__setEmailSenderForTests({
    async send() {
      return { id: "anwar-platform-test-email" };
    },
  });

  await db.insert(users).values([
    {
      id: adminUserId,
      email: `admin-${adminUserId}@anwar-platform-test.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Anwar Platform Admin",
      role: "admin",
    },
    {
      id: pmUserId,
      email: `pm-${pmUserId}@anwar-platform-test.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Anwar Platform PM",
      role: "project_manager",
    },
    {
      id: drafterUserId,
      email: `drafter-${drafterUserId}@anwar-platform-test.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Anwar Platform Drafter",
      role: "drafter",
    },
  ]);

  await db.insert(clients).values({
    id: clientId,
    companyName: "ZZZ Anwar Platform Client",
    createdBy: adminUserId,
  });

  await db.insert(jobs).values([
    {
      id: visibleJobId,
      title: "ZZZ Anwar Visible Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: pmUserId,
    },
    {
      id: hiddenJobId,
      title: "ZZZ Anwar Hidden Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: pmUserId,
    },
    {
      id: deletedJobId,
      title: "ZZZ Anwar Deleted Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: pmUserId,
      deletedAt: new Date(),
    },
    {
      id: drafterScheduleJobId,
      title: "ZZZ Anwar Drafter Schedule Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: pmUserId,
    },
    {
      id: drafterCreateJobId,
      title: "ZZZ Anwar Drafter Create Schedule Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: pmUserId,
    },
  ]);

  await db.insert(jobAssignees).values({
    jobId: drafterCreateJobId,
    userId: drafterUserId,
    canViewFinancials: false,
  });

  await db.insert(leads).values([
    {
      id: assignedLeadId,
      title: "ZZZ Anwar Assigned Lead",
      createdBy: adminUserId,
    },
    {
      id: hiddenLeadId,
      title: "ZZZ Anwar Hidden Lead",
      createdBy: adminUserId,
    },
  ]);

  await db.insert(leadSalespeople).values({
    leadId: assignedLeadId,
    userId: drafterUserId,
  });

  await db.insert(scheduleItems).values([
    {
      id: assignedScheduleItemId,
      jobId: visibleJobId,
      title: "ZZZ Anwar Assigned Schedule",
      startDate: assignedScheduleDate,
      workDays: 1,
      endDate: assignedScheduleDate,
      createdBy: adminUserId,
    },
    {
      id: createdScheduleItemId,
      jobId: visibleJobId,
      title: "ZZZ Anwar Created Schedule",
      startDate: createdScheduleDate,
      workDays: 1,
      endDate: createdScheduleDate,
      createdBy: drafterUserId,
    },
    {
      id: hiddenScheduleItemId,
      jobId: hiddenJobId,
      title: "ZZZ Anwar Hidden Schedule",
      startDate: hiddenScheduleDate,
      workDays: 1,
      endDate: hiddenScheduleDate,
      createdBy: adminUserId,
    },
  ]);

  await db.insert(scheduleItemAssignees).values({
    scheduleItemId: assignedScheduleItemId,
    userId: drafterUserId,
  });

  const stamp = new Date();
  adminToken = auth.signAccessToken({
    id: adminUserId,
    email: `admin-${adminUserId}@anwar-platform-test.local`,
    fullName: "ZZZ Anwar Platform Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  pmToken = auth.signAccessToken({
    id: pmUserId,
    email: `pm-${pmUserId}@anwar-platform-test.local`,
    fullName: "ZZZ Anwar Platform PM",
    role: "project_manager",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  drafterToken = auth.signAccessToken({
    id: drafterUserId,
    email: `drafter-${drafterUserId}@anwar-platform-test.local`,
    fullName: "ZZZ Anwar Platform Drafter",
    role: "drafter",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const emailModule = await import("../src/lib/email.ts");
  emailModule.__setEmailSenderForTests(null);

  const { db, pool } = await import("@workspace/db");
  const {
    activityLog,
    clients,
    dailyLogs,
    files,
    folders,
    idempotencyKeys,
    jobAssignees,
    jobs,
    leads,
    notifications,
    scheduleItemAssignees,
    scheduleItemNotes,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    await db
      .delete(notifications)
      .where(inArray(notifications.recipientUserId, testUserIds));
    await db.delete(activityLog).where(inArray(activityLog.userId, testUserIds));
    await db
      .delete(idempotencyKeys)
      .where(inArray(idempotencyKeys.userId, testUserIds));
    await db
      .delete(scheduleItemNotes)
      .where(inArray(scheduleItemNotes.scheduleItemId, testScheduleItemIds));
    await db
      .delete(scheduleItemAssignees)
      .where(inArray(scheduleItemAssignees.scheduleItemId, testScheduleItemIds));
    await db.delete(scheduleItems).where(inArray(scheduleItems.id, testScheduleItemIds));
    await db.delete(dailyLogs).where(inArray(dailyLogs.jobId, testJobIds));
    if (drafterWorkspaceFileIds.length > 0) {
      await db.delete(files).where(inArray(files.id, drafterWorkspaceFileIds));
    }
    if (drafterWorkspaceFolderIds.length > 0) {
      await db.delete(folders).where(inArray(folders.id, drafterWorkspaceFolderIds));
    }
    await db.delete(folders).where(inArray(folders.jobId, testJobIds));
    await db.delete(leads).where(inArray(leads.id, testLeadIds));
    await db.delete(jobAssignees).where(inArray(jobAssignees.jobId, testJobIds));
    await db.delete(jobs).where(inArray(jobs.id, testJobIds));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db
      .delete(users)
      .where(
        inArray(users.email, [
          crewInviteEmail,
          drafterInviteEmail,
          `admin-${adminUserId}@anwar-platform-test.local`,
          `pm-${pmUserId}@anwar-platform-test.local`,
          `drafter-${drafterUserId}@anwar-platform-test.local`,
        ]),
      );
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
    if (localStorageRoot) {
      await rm(localStorageRoot, { recursive: true, force: true });
    }
  }
});

test("new field users invited by admins start assigned to every active job", async () => {
  const res = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      email: crewInviteEmail,
      fullName: "ZZZ Anwar Invited Crew",
      role: "crew_member",
    }),
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as { user: { id: string } };

  const { db } = await import("@workspace/db");
  const { jobAssignees } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({ jobId: jobAssignees.jobId, canViewFinancials: jobAssignees.canViewFinancials })
    .from(jobAssignees)
    .where(eq(jobAssignees.userId, body.user.id));

  const assignedJobIds = new Set(rows.map((row) => row.jobId));
  for (const activeFixtureJobId of [hiddenJobId, visibleJobId, drafterScheduleJobId]) {
    assert.equal(
      assignedJobIds.has(activeFixtureJobId),
      true,
      "field-user invites should include every active fixture job",
    );
  }
  assert.equal(
    assignedJobIds.has(deletedJobId),
    false,
    "field-user invites must not include deleted jobs",
  );
  assert.equal(
    rows.every((row) => row.canViewFinancials === false),
    true,
    "default job access must not grant financials",
  );
});

test("drafter invites do not create broad job assignments", async () => {
  const res = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      email: drafterInviteEmail,
      fullName: "ZZZ Anwar Invited Drafter",
      role: "drafter",
    }),
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as { user: { id: string; role: string } };
  assert.equal(body.user.role, "drafter");

  const { db } = await import("@workspace/db");
  const { jobAssignees } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({ jobId: jobAssignees.jobId })
    .from(jobAssignees)
    .where(eq(jobAssignees.userId, body.user.id));

  assert.equal(rows.length, 0);
});

test("drafters can read shared sales leads, update notes, and upload files", async () => {
  const list = await fetch(`${baseUrl}/api/leads?pageSize=100`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(list.status, 200);
  const listBody = (await list.json()) as { leads: Array<{ id: string; title: string }> };
  assert.deepEqual(
    listBody.leads.map((lead) => lead.id).sort(),
    [assignedLeadId, hiddenLeadId].sort(),
  );

  const hidden = await fetch(`${baseUrl}/api/leads/${hiddenLeadId}`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(hidden.status, 200);

  const create = await fetch(`${baseUrl}/api/leads`, {
    method: "POST",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({ title: "ZZZ Drafter Should Not Create Lead" }),
  });
  assert.equal(create.status, 403);

  const update = await fetch(`${baseUrl}/api/leads/${assignedLeadId}`, {
    method: "PUT",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({
      title: "ZZZ Anwar Assigned Lead",
      status: "qualified",
      notes: "Drafter updated the lead notes.",
      salespeople: [pmUserId],
    }),
  });
  assert.equal(update.status, 200);
  const updateBody = (await update.json()) as {
    lead: { notes: string | null; status: string; salespeople: Array<{ id: string }> };
  };
  assert.equal(updateBody.lead.notes, "Drafter updated the lead notes.");
  assert.equal(updateBody.lead.status, "qualified");
  assert.deepEqual(
    updateBody.lead.salespeople.map((person) => person.id),
    [drafterUserId],
    "drafters must not be able to reassign salespeople through the full lead payload",
  );

  const form = new FormData();
  form.append(
    "files",
    new Blob([Buffer.from("drafter lead attachment")], { type: "text/plain" }),
    "drafter-notes.txt",
  );
  const upload = await fetch(`${baseUrl}/api/leads/${hiddenLeadId}/attachments`, {
    method: "POST",
    headers: {
      ...authHeaders(drafterToken),
      "x-requested-with": "XMLHttpRequest",
    },
    body: form,
  });
  assert.equal(upload.status, 201);
  const uploadBody = (await upload.json()) as {
    attachments: Array<{
      fileId: string;
      originalName: string;
      uploadedByName: string | null;
    }>;
  };
  assert.equal(uploadBody.attachments[0]?.originalName, "drafter-notes.txt");

  const fileId = uploadBody.attachments[0]?.fileId;
  assert.ok(fileId);
  const download = await fetch(`${baseUrl}/api/files/${fileId}/download`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/i);
  assert.equal(await download.text(), "drafter lead attachment");

  const signedDownload = await fetch(`${baseUrl}/api/files/${fileId}/signed-download`, {
    method: "POST",
    headers: {
      ...authHeaders(drafterToken),
      "x-requested-with": "XMLHttpRequest",
    },
  });
  assert.equal(signedDownload.status, 200);
  const signedDownloadBody = (await signedDownload.json()) as { url?: string };
  assert.match(
    signedDownloadBody.url ?? "",
    new RegExp(`^/api/files/${fileId}/download-signed\\?token=`),
  );

  const signedDownloadFile = await fetch(`${baseUrl}${signedDownloadBody.url}`);
  assert.equal(signedDownloadFile.status, 200);
  assert.match(signedDownloadFile.headers.get("content-disposition") ?? "", /attachment/i);
  assert.equal(await signedDownloadFile.text(), "drafter lead attachment");

  const signedRange = await fetch(`${baseUrl}${signedDownloadBody.url}`, {
    headers: { range: "bytes=0-6" },
  });
  assert.equal(signedRange.status, 206);
  assert.equal(signedRange.headers.get("accept-ranges"), "bytes");
  assert.match(signedRange.headers.get("content-range") ?? "", /^bytes 0-6\//);
  assert.equal(await signedRange.text(), "drafter");
});

test("schedule notify creates visible in-app notifications for assigned users", async () => {
  const notify = await fetch(`${baseUrl}/api/jobs/${visibleJobId}/schedule/notify-assigned-users`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
  });
  assert.equal(notify.status, 200);

  const notificationList = await fetch(`${baseUrl}/api/notifications`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(notificationList.status, 200);
  const body = (await notificationList.json()) as {
    unreadCount: number;
    notifications: Array<{ id: string; title: string; readAt: string | null; url: string | null }>;
  };
  const item = body.notifications.find((entry) => entry.title === "Schedule notification");
  assert.ok(item, "drafter should receive an in-app schedule notification");
  assert.equal(item.readAt, null);
  assert.equal(item.url, `/jobs/${visibleJobId}/schedule`);
  assert.ok(body.unreadCount >= 1);

  const read = await fetch(`${baseUrl}/api/notifications/${item.id}/read`, {
    method: "PATCH",
    headers: jsonHeaders(drafterToken),
  });
  assert.equal(read.status, 200);
});

test("daily log publish notify creates visible in-app notifications", async () => {
  const create = await fetch(`${baseUrl}/api/jobs/${visibleJobId}/daily-logs`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      logDate: "2026-07-07",
      title: "ZZZ Anwar Notify Regression",
      notes: "Verify notify users get an in-app notification.",
      notifyUserIds: [drafterUserId],
      shareInternalUsers: true,
    }),
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { log: { id: string } };

  const publish = await fetch(`${baseUrl}/api/daily-logs/${created.log.id}/publish`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
  });
  assert.equal(publish.status, 200);

  const notificationList = await fetch(`${baseUrl}/api/notifications`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(notificationList.status, 200);
  const body = (await notificationList.json()) as {
    notifications: Array<{ title: string; body: string | null; url: string | null }>;
  };
  const item = body.notifications.find((entry) =>
    entry.title.includes("ZZZ Anwar Notify Regression"),
  );
  assert.ok(item, "drafter should receive an in-app daily log notification");
  assert.match(item.body ?? "", /2026-07-07/);
  assert.equal(item.url, `/jobs/${visibleJobId}/daily-logs`);
});

test("drafters cannot access resource folders or broad job files", async () => {
  const resources = await fetch(`${baseUrl}/api/resources/folders`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(resources.status, 403);

  const jobFiles = await fetch(`${baseUrl}/api/jobs/${visibleJobId}/folders?mediaType=document`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(jobFiles.status, 403);
});

test("admins can give a drafter one schedule workspace job with folder uploads", async () => {
  const blockedBeforeAssignment = await fetch(`${baseUrl}/api/jobs/${drafterScheduleJobId}`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(blockedBeforeAssignment.status, 403);

  const assign = await fetch(`${baseUrl}/api/jobs/${drafterScheduleJobId}/assignees`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({ userId: drafterUserId }),
  });
  assert.equal(assign.status, 201);
  const assignBody = (await assign.json()) as {
    assignees: Array<{ id: string; role: string; canViewFinancials: boolean | null }>;
  };
  const assignedDrafter = assignBody.assignees.find((assignee) => assignee.id === drafterUserId);
  assert.equal(assignedDrafter?.role, "drafter");
  assert.equal(assignedDrafter?.canViewFinancials, false);

  const financialsGrant = await fetch(
    `${baseUrl}/api/jobs/${drafterScheduleJobId}/assignees/${drafterUserId}/financials-access`,
    {
      method: "PATCH",
      headers: jsonHeaders(adminToken),
      body: JSON.stringify({ canViewFinancials: true }),
    },
  );
  assert.equal(financialsGrant.status, 400);

  const job = await fetch(`${baseUrl}/api/jobs/${drafterScheduleJobId}`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(job.status, 200);

  const unrelatedJob = await fetch(`${baseUrl}/api/jobs/${hiddenJobId}`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(unrelatedJob.status, 403);

  const schedule = await fetch(`${baseUrl}/api/jobs/${drafterScheduleJobId}/schedule`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(schedule.status, 200);

  const unrelatedSchedule = await fetch(`${baseUrl}/api/jobs/${hiddenJobId}/schedule`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(unrelatedSchedule.status, 403);

  const folders = await fetch(`${baseUrl}/api/jobs/${drafterScheduleJobId}/folders?mediaType=document`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(folders.status, 200);
  const foldersBody = (await folders.json()) as { folders: Array<{ id: string; title: string }> };
  assert.ok(foldersBody.folders.length > 0, "assigned drafters should see job document folders");

  const createFolder = await fetch(`${baseUrl}/api/jobs/${drafterScheduleJobId}/folders`, {
    method: "POST",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({
      title: "ZZZ Drafter Workspace Uploads",
      mediaType: "document",
    }),
  });
  assert.equal(createFolder.status, 201);
  const createFolderBody = (await createFolder.json()) as { folder: { id: string; title: string } };
  drafterWorkspaceFolderIds.push(createFolderBody.folder.id);

  const form = new FormData();
  form.append(
    "files",
    new Blob([Buffer.from("drafter workspace upload")], { type: "text/plain" }),
    "drafter-workspace-upload.txt",
  );
  const upload = await fetch(`${baseUrl}/api/folders/${createFolderBody.folder.id}/files`, {
    method: "POST",
    headers: {
      ...authHeaders(drafterToken),
      "x-requested-with": "XMLHttpRequest",
    },
    body: form,
  });
  assert.equal(upload.status, 201);
  const uploadBody = (await upload.json()) as {
    files: Array<{ id: string; originalName: string | null; uploadedBy: string | null }>;
  };
  const uploadedFile = uploadBody.files[0];
  assert.equal(uploadedFile?.originalName, "drafter-workspace-upload.txt");
  assert.equal(uploadedFile?.uploadedBy, drafterUserId);
  if (uploadedFile?.id) {
    drafterWorkspaceFileIds.push(uploadedFile.id);
  }

  const fileList = await fetch(`${baseUrl}/api/folders/${createFolderBody.folder.id}/files`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(fileList.status, 200);
  const fileListBody = (await fileList.json()) as { files: Array<{ id: string }> };
  assert.deepEqual(fileListBody.files.map((file) => file.id), [uploadedFile?.id]);
});

test("drafters can read only assigned or created company schedule items", async () => {
  const list = await fetch(`${baseUrl}/api/schedule?limit=100`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(list.status, 200);
  const body = (await list.json()) as { data: Array<{ id: string; title: string }> };
  const visibleScheduleIds = new Set(body.data.map((item) => item.id));
  assert.equal(visibleScheduleIds.has(assignedScheduleItemId), true);
  assert.equal(visibleScheduleIds.has(createdScheduleItemId), true);
  assert.equal(visibleScheduleIds.has(hiddenScheduleItemId), false);

  const assignedDetail = await fetch(`${baseUrl}/api/schedule-items/${assignedScheduleItemId}`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(assignedDetail.status, 200);

  const hiddenDetail = await fetch(`${baseUrl}/api/schedule-items/${hiddenScheduleItemId}`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(hiddenDetail.status, 403);

  const note = await fetch(`${baseUrl}/api/schedule-items/${assignedScheduleItemId}/notes`, {
    method: "POST",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({ note: "Drafter should still need job access to collaborate." }),
  });
  assert.equal(note.status, 403);
});

test("assigned drafters can edit and delete schedule items they submit", async () => {
  const create = await fetch(`${baseUrl}/api/jobs/${drafterCreateJobId}/schedule`, {
    method: "POST",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({
      title: "ZZZ Anwar Drafter Editable Schedule Item",
      startDate: isoDaysFromNow(11),
      workDays: 1,
      assigneeIds: [drafterUserId],
    }),
  });
  const createBody = (await create.json()) as { item?: { id: string } };
  assert.equal(create.status, 201);
  assert.ok(createBody.item?.id);
  testScheduleItemIds.push(createBody.item.id);

  const patch = await fetch(`${baseUrl}/api/schedule-items/${createBody.item.id}`, {
    method: "PATCH",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({
      displayColor: "#16a34a",
      notes: "Drafter updated the schedule notes.",
      progress: 35,
    }),
  });
  assert.equal(patch.status, 200);
  const patchBody = (await patch.json()) as {
    item: { displayColor: string | null; notes: string | null; progress: number | null };
  };
  assert.equal(patchBody.item.displayColor, "#16a34a");
  assert.equal(patchBody.item.notes, "Drafter updated the schedule notes.");
  assert.equal(patchBody.item.progress, 35);

  const note = await fetch(`${baseUrl}/api/schedule-items/${createBody.item.id}/notes`, {
    method: "POST",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({ note: "Drafter can add notes after submitting." }),
  });
  assert.equal(note.status, 201);
  const noteBody = (await note.json()) as { note: { note: string; authorId: string | null } };
  assert.equal(noteBody.note.note, "Drafter can add notes after submitting.");
  assert.equal(noteBody.note.authorId, drafterUserId);

  const hiddenPatch = await fetch(`${baseUrl}/api/schedule-items/${hiddenScheduleItemId}`, {
    method: "PATCH",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({ notes: "Should stay blocked." }),
  });
  assert.equal(hiddenPatch.status, 403);

  const remove = await fetch(`${baseUrl}/api/schedule-items/${createBody.item.id}`, {
    method: "DELETE",
    headers: jsonHeaders(drafterToken),
  });
  assert.equal(remove.status, 200);
  const removeBody = (await remove.json()) as { success: boolean };
  assert.equal(removeBody.success, true);
});

test("assigned drafters can create schedule items only on assigned jobs", async () => {
  const create = await fetch(`${baseUrl}/api/jobs/${drafterCreateJobId}/schedule`, {
    method: "POST",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({
      title: "ZZZ Anwar Drafter Created Schedule Item",
      startDate: isoDaysFromNow(8),
      workDays: 1,
      assigneeIds: [drafterUserId],
    }),
  });
  const createBody = (await create.json()) as {
    item?: {
      id: string;
      jobId: string | null;
      title: string;
      createdBy: string | null;
      assigneeIds: string[];
    };
  };
  assert.equal(create.status, 201);
  assert.ok(createBody.item?.id);
  testScheduleItemIds.push(createBody.item.id);
  assert.equal(createBody.item.jobId, drafterCreateJobId);
  assert.equal(createBody.item.title, "ZZZ Anwar Drafter Created Schedule Item");
  assert.equal(createBody.item.createdBy, drafterUserId);
  assert.deepEqual(createBody.item.assigneeIds, [drafterUserId]);

  const detail = await fetch(`${baseUrl}/api/schedule-items/${createBody.item.id}`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(detail.status, 200);

  const unassignedCreate = await fetch(`${baseUrl}/api/jobs/${hiddenJobId}/schedule`, {
    method: "POST",
    headers: jsonHeaders(drafterToken),
    body: JSON.stringify({
      title: "ZZZ Anwar Drafter Unassigned Schedule Item",
      startDate: isoDaysFromNow(9),
    }),
  });
  assert.equal(unassignedCreate.status, 403);

  const pmCreate = await fetch(`${baseUrl}/api/jobs/${drafterCreateJobId}/schedule`, {
    method: "POST",
    headers: jsonHeaders(pmToken),
    body: JSON.stringify({
      title: "ZZZ Anwar PM Managed Schedule Item",
      startDate: isoDaysFromNow(10),
    }),
  });
  const pmCreateBody = (await pmCreate.json()) as { item?: { id: string; createdBy: string | null } };
  assert.equal(pmCreate.status, 201);
  assert.ok(pmCreateBody.item?.id);
  testScheduleItemIds.push(pmCreateBody.item.id);
  assert.equal(pmCreateBody.item.createdBy, pmUserId);
});

test("drafter home is scoped to shared leads and accessible schedule only", async () => {
  const home = await fetch(`${baseUrl}/api/dashboard/home`, {
    headers: authHeaders(drafterToken),
  });
  assert.equal(home.status, 200);
  const body = (await home.json()) as {
    role: string;
    summary: { openLeads: number; openScheduleItems: number };
    recentLeads: Array<{ id: string }>;
    schedule: { items: Array<{ id: string }> };
    todos?: unknown;
    latestLog?: unknown;
  };

  assert.equal(body.role, "drafter");
  assert.ok(body.summary.openLeads >= 1);
  assert.equal(
    body.recentLeads.some((lead) => lead.id === hiddenLeadId),
    true,
    "drafter home should include admin-uploaded shared leads",
  );
  const homeScheduleIds = new Set(body.schedule.items.map((item) => item.id));
  assert.equal(homeScheduleIds.has(assignedScheduleItemId), true);
  assert.equal(homeScheduleIds.has(createdScheduleItemId), true);
  assert.equal(homeScheduleIds.has(hiddenScheduleItemId), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(body, "todos"),
    false,
    "drafter home must not reuse the crew My Day todo surface",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(body, "latestLog"),
    false,
    "drafter home must not expose daily-log affordances",
  );
});

test("lead attachment ZIPs can upload through the chunked path", async () => {
  const zipBytes = Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x21, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const checksum = crypto.createHash("sha256").update(zipBytes).digest("hex");

  const startResponse = await fetch(`${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      originalName: "608 Radcliffe.zip",
      mimeType: "application/zip",
      totalSize: zipBytes.length,
      totalChunks: 2,
      contentHash: checksum,
    }),
  });

  assert.equal(startResponse.status, 201);
  const startBody = (await startResponse.json()) as { session: { uploadId: string } };
  const uploadId = startBody.session.uploadId;

  const chunks = [zipBytes.subarray(0, 10), zipBytes.subarray(10)];
  for (const [index, chunk] of chunks.entries()) {
    const useBase64Transport = index === 1;
    const chunkResponse = await fetch(
      `${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked/${uploadId}/chunks/${index}`,
      {
        method: "PUT",
        headers: {
          ...authHeaders(adminToken),
          "content-type": useBase64Transport ? "text/plain" : "application/octet-stream",
          "x-requested-with": "XMLHttpRequest",
        },
        body: useBase64Transport ? chunk.toString("base64") : chunk,
      },
    );
    assert.equal(chunkResponse.status, 200);
    const chunkBody = (await chunkResponse.json()) as { transport?: string };
    assert.equal(chunkBody.transport, useBase64Transport ? "base64" : undefined);
  }

  const completeResponse = await fetch(
    `${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked/${uploadId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(adminToken),
    },
  );

  assert.equal(completeResponse.status, 201);
  const completeBody = (await completeResponse.json()) as {
    uploadId: string;
    attachments: Array<{ originalName: string; fileSize: number | null; mimeType: string | null }>;
  };
  assert.equal(completeBody.uploadId, uploadId);
  assert.equal(completeBody.attachments[0]?.originalName, "608 Radcliffe.zip");
  assert.equal(completeBody.attachments[0]?.fileSize, zipBytes.length);
  assert.equal(completeBody.attachments[0]?.mimeType, "application/zip");

  const detailResponse = await fetch(`${baseUrl}/api/leads/${assignedLeadId}`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(detailResponse.status, 200);
  const detailBody = (await detailResponse.json()) as {
    lead: { attachments: Array<{ originalName: string; fileSize: number | null }> };
  };
  assert.ok(
    detailBody.lead.attachments.some(
      (attachment) =>
        attachment.originalName === "608 Radcliffe.zip" &&
        attachment.fileSize === zipBytes.length,
    ),
  );
});

test("lead attachment PDFs above the direct threshold finalize through the chunked path", async () => {
  const pdfBytes = Buffer.alloc(DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES + 1024, 0x20);
  pdfBytes.write("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", 0, "ascii");
  pdfBytes.write("\n%%EOF\n", pdfBytes.length - 8, "ascii");
  const checksum = crypto.createHash("sha256").update(pdfBytes).digest("hex");
  const chunkSize = 8 * 1024 * 1024;
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < pdfBytes.length; offset += chunkSize) {
    chunks.push(pdfBytes.subarray(offset, Math.min(offset + chunkSize, pdfBytes.length)));
  }

  const startResponse = await fetch(`${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      originalName: "K Bakery - Issue for Construction-260409.pdf",
      mimeType: "application/pdf",
      totalSize: pdfBytes.length,
      totalChunks: chunks.length,
      contentHash: checksum,
    }),
  });

  assert.equal(startResponse.status, 201);
  const startBody = (await startResponse.json()) as { session: { uploadId: string } };
  const uploadId = startBody.session.uploadId;

  for (const [index, chunk] of chunks.entries()) {
    const useBase64Transport = index === chunks.length - 1;
    const chunkResponse = await fetch(
      `${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked/${uploadId}/chunks/${index}`,
      {
        method: "PUT",
        headers: {
          ...authHeaders(adminToken),
          "content-type": useBase64Transport ? "text/plain" : "application/octet-stream",
          "x-requested-with": "XMLHttpRequest",
        },
        body: useBase64Transport ? chunk.toString("base64") : chunk,
      },
    );
    assert.equal(chunkResponse.status, 200);
  }

  const statusResponse = await fetch(
    `${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked/${uploadId}`,
    { headers: authHeaders(adminToken) },
  );
  assert.equal(statusResponse.status, 200);
  const statusBody = (await statusResponse.json()) as {
    status: {
      receivedBytes: number;
      missingChunks: number[];
      complete: boolean;
    };
  };
  assert.equal(statusBody.status.receivedBytes, pdfBytes.length);
  assert.deepEqual(statusBody.status.missingChunks, []);
  assert.equal(statusBody.status.complete, true);

  const completeResponse = await fetch(
    `${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked/${uploadId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(adminToken),
    },
  );

  assert.equal(completeResponse.status, 201);
  const completeBody = (await completeResponse.json()) as {
    uploadId: string;
    attachments: Array<{ originalName: string; fileSize: number | null; mimeType: string | null }>;
  };
  assert.equal(completeBody.uploadId, uploadId);
  assert.equal(completeBody.attachments[0]?.originalName, "K Bakery - Issue for Construction-260409.pdf");
  assert.equal(completeBody.attachments[0]?.fileSize, pdfBytes.length);
  assert.equal(completeBody.attachments[0]?.mimeType, "application/pdf");

  const detailResponse = await fetch(`${baseUrl}/api/leads/${assignedLeadId}`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(detailResponse.status, 200);
  const detailBody = (await detailResponse.json()) as {
    lead: { attachments: Array<{ originalName: string; fileSize: number | null }> };
  };
  assert.ok(
    detailBody.lead.attachments.some(
      (attachment) =>
        attachment.originalName === "K Bakery - Issue for Construction-260409.pdf" &&
        attachment.fileSize === pdfBytes.length,
    ),
  );
});

test("lead attachment upload policy tells API agents to chunk Anwar's large PDFs", async () => {
  const cases = [
    {
      fileSize: 81_721_383,
      fileName: "K Bakery - Issue for Construction-260409.pdf",
    },
    {
      fileSize: 77_800_000,
      fileName: "K Bakery - Issue for Construction-260409.zip",
    },
    {
      fileSize: 89_544_788,
      fileName: "20260430_TAHQ_BUBBLED Red Stamped Plans Revised For Constructiont4_2.pdf",
    },
  ];

  for (const { fileSize, fileName } of cases) {
    const policyResponse = await fetch(
      `${baseUrl}/api/leads/${assignedLeadId}/attachments/upload-policy?fileSize=${fileSize}&originalName=${encodeURIComponent(fileName)}&mimeType=application%2Fpdf`,
      {
        headers: authHeaders(adminToken),
      },
    );

    assert.equal(policyResponse.status, 200);
    const policy = (await policyResponse.json()) as {
      multipart: {
        endpoint: string;
        fieldName: string;
        maxRecommendedBytes: number;
        edgeRequestLimitBytes: number;
        maxAppFileSizeBytes: number;
      };
      chunked: {
        supported: boolean;
        maxTotalBytes: number;
        maxChunkBytes: number;
        endpoints: {
          start: string;
          chunk: string;
          complete: string;
        };
        startBody: {
          originalName: string;
          mimeType: string;
          totalSize: number;
          totalChunks: number;
        };
      };
      direct: {
        supported: boolean;
        maxTotalBytes: number;
        tusChunkBytes: number;
        endpoints: { start: string; complete: string };
      };
      file: {
        originalName: string;
        mimeType: string;
        size: number;
        recommendedUploadMode: string;
        reason: string;
      };
    };

    assert.equal(policy.multipart.fieldName, "files");
    assert.equal(policy.multipart.endpoint, `/api/leads/${assignedLeadId}/attachments`);
    assert.equal(policy.multipart.maxRecommendedBytes, DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES);
    assert.equal(policy.multipart.edgeRequestLimitBytes, DIRECT_UPLOAD_EDGE_LIMIT_BYTES);
    assert.ok(
      policy.multipart.maxRecommendedBytes < policy.multipart.edgeRequestLimitBytes,
      "direct multipart threshold must stay below Cloud Run's edge request cap",
    );
    assert.ok(
      fileSize > policy.multipart.maxRecommendedBytes,
      `${fileName} should be above the direct multipart proxy-safe threshold`,
    );
    assert.ok(
      fileSize < policy.multipart.maxAppFileSizeBytes,
      "The app can accept this file size through direct resumable upload even though multipart is not proxy-safe",
    );
    assert.equal(policy.chunked.supported, true);
    assert.equal(policy.chunked.endpoints.start, `/api/leads/${assignedLeadId}/attachments/chunked`);
    assert.equal(
      policy.chunked.endpoints.chunk,
      `/api/leads/${assignedLeadId}/attachments/chunked/{uploadId}/chunks/{chunkIndex}`,
    );
    assert.equal(
      policy.chunked.endpoints.complete,
      `/api/leads/${assignedLeadId}/attachments/chunked/{uploadId}/complete`,
    );
    assert.equal(policy.chunked.startBody.originalName, fileName);
    assert.equal(policy.chunked.startBody.mimeType, "application/pdf");
    assert.equal(policy.chunked.startBody.totalSize, fileSize);
    assert.equal(policy.chunked.startBody.totalChunks, Math.ceil(fileSize / policy.chunked.maxChunkBytes));
    assert.equal(policy.direct.supported, true);
    assert.equal(policy.direct.maxTotalBytes, MAX_UPLOAD_FILE_BYTES);
    assert.equal(policy.direct.tusChunkBytes, 6 * 1024 * 1024);
    assert.equal(policy.direct.endpoints.start, `/api/leads/${assignedLeadId}/attachments/direct`);
    assert.equal(
      policy.direct.endpoints.complete,
      `/api/leads/${assignedLeadId}/attachments/direct/complete`,
    );
    assert.equal(policy.file.recommendedUploadMode, "direct");
    assert.match(policy.file.reason, /signed direct resumable/i);
  }
});

test("lead chunked upload accepts files above the former 500 MB cap under the current app cap", async () => {
  const fileSize = 600 * 1024 * 1024;
  const fileName = "K Bakery - Issue for Construction-260409.pdf";
  const policyResponse = await fetch(
    `${baseUrl}/api/leads/${assignedLeadId}/attachments/upload-policy?fileSize=${fileSize}&originalName=${encodeURIComponent(fileName)}&mimeType=application%2Fpdf`,
    {
      headers: authHeaders(adminToken),
    },
  );

  assert.equal(policyResponse.status, 200);
  const policy = (await policyResponse.json()) as {
    multipart: {
      maxAppFileSizeBytes: number;
    };
    chunked: {
      supported: boolean;
      maxTotalBytes: number;
      maxChunkBytes: number;
    };
    file: {
      recommendedUploadMode: string;
    };
  };

  assert.equal(policy.multipart.maxAppFileSizeBytes, MAX_UPLOAD_FILE_BYTES);
  assert.equal(policy.chunked.maxTotalBytes, MAX_UPLOAD_FILE_BYTES);
  assert.equal(policy.chunked.supported, true);
  assert.ok(fileSize > 500 * 1024 * 1024);
  assert.ok(fileSize < policy.chunked.maxTotalBytes);
  assert.equal(policy.file.recommendedUploadMode, "direct");

  const totalChunks = Math.ceil(fileSize / policy.chunked.maxChunkBytes);
  const startResponse = await fetch(`${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      originalName: fileName,
      mimeType: "application/pdf",
      totalSize: fileSize,
      totalChunks,
    }),
  });

  assert.equal(startResponse.status, 201);
  const startBody = (await startResponse.json()) as {
    session: { uploadId: string; totalSize: number; totalChunks: number };
    status: { complete: boolean };
  };
  assert.equal(startBody.session.totalSize, fileSize);
  assert.equal(startBody.session.totalChunks, totalChunks);
  assert.equal(startBody.status.complete, false);

  const deleteResponse = await fetch(
    `${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked/${startBody.session.uploadId}`,
    {
      method: "DELETE",
      headers: jsonHeaders(adminToken),
    },
  );
  assert.equal(deleteResponse.status, 200);
});

test("lead chunked upload rejects files above the current app cap with structured 413", async () => {
  const fileSize = MAX_UPLOAD_FILE_BYTES + 1;
  const fileName = "too-large.pdf";
  const policyResponse = await fetch(
    `${baseUrl}/api/leads/${assignedLeadId}/attachments/upload-policy?fileSize=${fileSize}&originalName=${encodeURIComponent(fileName)}&mimeType=application%2Fpdf`,
    {
      headers: authHeaders(adminToken),
    },
  );

  assert.equal(policyResponse.status, 200);
  const policy = (await policyResponse.json()) as {
    chunked: {
      maxChunkBytes: number;
    };
  };

  const response = await fetch(`${baseUrl}/api/leads/${assignedLeadId}/attachments/chunked`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      originalName: fileName,
      mimeType: "application/pdf",
      totalSize: fileSize,
      totalChunks: Math.ceil(fileSize / policy.chunked.maxChunkBytes),
    }),
  });

  assert.equal(response.status, 413);
  const body = (await response.json()) as {
    errors?: {
      code?: string;
      limit?: number;
    };
  };
  assert.equal(body.errors?.code, "FILE_TOO_LARGE");
  assert.equal(body.errors?.limit, MAX_UPLOAD_FILE_BYTES);
});

test("oversized lead multipart requests return structured direct-upload guidance when they reach the app", async () => {
  const target = new URL(`${baseUrl}/api/leads/${assignedLeadId}/attachments`);
  const contentLength = 81_721_383;

  const response = await new Promise<{
    statusCode: number;
    contentType: string | undefined;
    body: string;
  }>((resolve, reject) => {
    let settled = false;
    const req = httpRequest(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: {
          ...authHeaders(adminToken),
          "content-type": "multipart/form-data; boundary=anwar-large-lead",
          "content-length": String(contentLength),
          "x-requested-with": "XMLHttpRequest",
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          settled = true;
          resolve({
            statusCode: res.statusCode ?? 0,
            contentType: Array.isArray(res.headers["content-type"])
              ? res.headers["content-type"][0]
              : res.headers["content-type"],
            body,
          });
        });
      },
    );

    req.on("error", (error) => {
      if (!settled) {
        reject(error);
      }
    });
    req.end();
  });

  assert.equal(response.statusCode, 413);
  assert.match(response.contentType ?? "", /application\/problem\+json/);
  const body = JSON.parse(response.body) as {
    status: number;
    errors?: {
      code?: string;
      contentLength?: number;
      edgeRequestLimitBytes?: number;
      multipartFieldName?: string;
      chunkedUploadSupported?: boolean;
      uploadPolicyEndpoint?: string;
      directStartEndpoint?: string;
      directCompleteEndpoint?: string;
      chunkedStartEndpoint?: string;
    };
  };
  assert.equal(body.status, 413);
  assert.equal(body.errors?.code, "LEAD_ATTACHMENT_USE_DIRECT_UPLOAD");
  assert.equal(body.errors?.contentLength, contentLength);
  assert.equal(body.errors?.edgeRequestLimitBytes, DIRECT_UPLOAD_EDGE_LIMIT_BYTES);
  assert.equal(body.errors?.multipartFieldName, "files");
  assert.equal(body.errors?.chunkedUploadSupported, true);
  assert.equal(
    body.errors?.uploadPolicyEndpoint,
    `/api/leads/${assignedLeadId}/attachments/upload-policy`,
  );
  assert.equal(
    body.errors?.directStartEndpoint,
    `/api/leads/${assignedLeadId}/attachments/direct`,
  );
  assert.equal(
    body.errors?.directCompleteEndpoint,
    `/api/leads/${assignedLeadId}/attachments/direct/complete`,
  );
  assert.equal(
    body.errors?.chunkedStartEndpoint,
    `/api/leads/${assignedLeadId}/attachments/chunked`,
  );
});
