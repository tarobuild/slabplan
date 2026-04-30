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

const testUserIds = [
  adminUserId,
  otherAdminUserId,
  pmUserId,
  crewUserId,
  isolatedPmUserId,
];
const testJobIds = [managedJobId, hiddenJobId];
const testLeadIds = [pmLeadId, hiddenLeadId];
const testFolderIds = [leadFolderId, dailyLogFolderId, scheduleFolderId];
const testFileIds = [leadFileId, dailyLogFileId, scheduleFileId];

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
