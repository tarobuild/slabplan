import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminToken: string;
let crewToken: string;
let pmToken: string;

const runId = crypto.randomUUID();
const adminUserId = crypto.randomUUID();
const crewUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const unassignedJobId = crypto.randomUUID();
const hiddenPhotoFolderId = crypto.randomUUID();
const uploadBlockedPhotoFolderId = crypto.randomUUID();

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://stub.invalid";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key";
  process.env.SUPABASE_URL ??= "https://storage.example.invalid";
  process.env.SUPABASE_STORAGE_BUCKET ??= "cadstone-files";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { clients, folders, jobAssignees, jobs, users } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values([
    {
      id: adminUserId,
      email: `admin-${runId}@job-access.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Access Admin",
      role: "admin",
    },
    {
      id: crewUserId,
      email: `crew-${runId}@job-access.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Assigned Crew",
      role: "crew_member",
    },
    {
      id: pmUserId,
      email: `pm-${runId}@job-access.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Assigned PM",
      role: "project_manager",
    },
  ]);

  await db.insert(clients).values({
    id: clientId,
    companyName: `Access Client ${runId}`,
  });

  await db.insert(jobs).values([
    {
      id: jobId,
      title: `Access Job ${runId}`,
      clientId,
      createdBy: adminUserId,
      projectManagerId: null,
    },
    {
      id: unassignedJobId,
      title: `Unassigned Job ${runId}`,
      clientId,
      createdBy: adminUserId,
      projectManagerId: null,
    },
  ]);

  await db.insert(jobAssignees).values([
    { jobId, userId: crewUserId, canViewFinancials: false },
    { jobId, userId: pmUserId, canViewFinancials: false },
  ]);

  await db.insert(folders).values([
    {
      id: hiddenPhotoFolderId,
      title: `Hidden Crew Photos ${runId}`,
      scope: "job",
      jobId,
      mediaType: "photo",
      viewingPermissions: { internal: true, users: { [crewUserId]: false } },
      uploadingPermissions: { admin: true, crew_member: true },
    },
    {
      id: uploadBlockedPhotoFolderId,
      title: `View Only Crew Photos ${runId}`,
      scope: "job",
      jobId,
      mediaType: "photo",
      viewingPermissions: { internal: true, users: { [crewUserId]: true } },
      uploadingPermissions: { admin: true, crew_member: true, users: { [crewUserId]: false } },
    },
  ]);

  adminToken = auth.signAccessToken({
    id: adminUserId,
    email: `admin-${runId}@job-access.local`,
    fullName: "Access Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  crewToken = auth.signAccessToken({
    id: crewUserId,
    email: `crew-${runId}@job-access.local`,
    fullName: "Assigned Crew",
    role: "crew_member",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  pmToken = auth.signAccessToken({
    id: pmUserId,
    email: `pm-${runId}@job-access.local`,
    fullName: "Assigned PM",
    role: "project_manager",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  const { db } = await import("@workspace/db");
  const { clients, folders, jobAssignees, jobs, users } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  await db.delete(folders).where(inArray(folders.id, [hiddenPhotoFolderId, uploadBlockedPhotoFolderId]));
  await db.delete(jobAssignees).where(eq(jobAssignees.jobId, jobId));
  await db.delete(jobs).where(inArray(jobs.id, [jobId, unassignedJobId]));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(users).where(inArray(users.id, [adminUserId, crewUserId, pmUserId]));
});

test("assigned non-admins can view job field pages", async () => {
  const job = await fetch(`${baseUrl}/jobs/${jobId}`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(job.status, 200);

  const schedule = await fetch(`${baseUrl}/jobs/${jobId}/schedule`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(schedule.status, 200);

  const dailyLogs = await fetch(`${baseUrl}/jobs/${jobId}/daily-logs`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(dailyLogs.status, 200);

  const unassignedJob = await fetch(`${baseUrl}/jobs/${unassignedJobId}`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(unassignedJob.status, 403);
});

test("non-admins cannot create, edit, delete, or assign jobs", async () => {
  const create = await fetch(`${baseUrl}/jobs`, {
    method: "POST",
    headers: {
      ...authHeaders(crewToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({ title: `Denied Job ${runId}` }),
  });
  assert.equal(create.status, 403);

  const edit = await fetch(`${baseUrl}/jobs/${jobId}`, {
    method: "PUT",
    headers: {
      ...authHeaders(crewToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({ title: `Denied Edit ${runId}` }),
  });
  assert.equal(edit.status, 403);

  const remove = await fetch(`${baseUrl}/jobs/${jobId}`, {
    method: "DELETE",
    headers: {
      ...authHeaders(crewToken),
      "x-requested-with": "XMLHttpRequest",
    },
  });
  assert.equal(remove.status, 403);

  const assign = await fetch(`${baseUrl}/jobs/${jobId}/assignees`, {
    method: "POST",
    headers: {
      ...authHeaders(crewToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({ userId: pmUserId }),
  });
  assert.equal(assign.status, 403);
});

test("financials require the per-job financials grant", async () => {
  const denied = await fetch(`${baseUrl}/jobs/${jobId}/financials`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(denied.status, 403);

  const blockedToggle = await fetch(`${baseUrl}/jobs/${jobId}/assignees/${crewUserId}/financials-access`, {
    method: "PATCH",
    headers: {
      ...authHeaders(crewToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({ canViewFinancials: true }),
  });
  assert.equal(blockedToggle.status, 403);

  const adminToggle = await fetch(`${baseUrl}/jobs/${jobId}/assignees/${crewUserId}/financials-access`, {
    method: "PATCH",
    headers: {
      ...authHeaders(adminToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({ canViewFinancials: true }),
  });
  assert.equal(adminToggle.status, 200);
  const adminToggleBody = (await adminToggle.json()) as {
    assignee: { id: string; canViewFinancials: boolean; access: { financials: boolean } };
  };
  assert.equal(adminToggleBody.assignee.id, crewUserId);
  assert.equal(adminToggleBody.assignee.canViewFinancials, true);
  assert.equal(adminToggleBody.assignee.access.financials, true);

  const allowed = await fetch(`${baseUrl}/jobs/${jobId}/financials`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(allowed.status, 200);
});

test("project managers and crew share the same field-user model", async () => {
  const financials = await fetch(`${baseUrl}/jobs/${jobId}/financials`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(financials.status, 403);

  const scheduleWrite = await fetch(`${baseUrl}/jobs/${jobId}/schedule`, {
    method: "POST",
    headers: {
      ...authHeaders(pmToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      title: `Denied schedule item ${runId}`,
      startDate: "2026-05-13",
    }),
  });
  assert.equal(scheduleWrite.status, 403);

  const clients = await fetch(`${baseUrl}/clients`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(clients.status, 403);
});

test("folder per-user overrides control what assignees can see and upload", async () => {
  const adminPhotos = await fetch(`${baseUrl}/jobs/${jobId}/folders?mediaType=photo`, {
    headers: authHeaders(adminToken),
  });
  assert.equal(adminPhotos.status, 200);
  const adminPhotosBody = (await adminPhotos.json()) as { folders: Array<{ title: string }> };
  assert.ok(
    adminPhotosBody.folders.some((folder) => folder.title === `Hidden Crew Photos ${runId}`),
  );

  const crewPhotos = await fetch(`${baseUrl}/jobs/${jobId}/folders?mediaType=photo`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(crewPhotos.status, 200);
  const crewPhotosBody = (await crewPhotos.json()) as { folders: Array<{ title: string }> };
  assert.ok(
    !crewPhotosBody.folders.some((folder) => folder.title === `Hidden Crew Photos ${runId}`),
    "explicit folder deny should hide the folder from the worker",
  );
  assert.ok(
    crewPhotosBody.folders.some((folder) => folder.title === `View Only Crew Photos ${runId}`),
    "explicit folder allow should show the folder to the worker",
  );

  const hiddenDirect = await fetch(`${baseUrl}/folders/${hiddenPhotoFolderId}`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(hiddenDirect.status, 403);

  const uploadScopedList = await fetch(
    `${baseUrl}/folders/${uploadBlockedPhotoFolderId}/files?includeDeleted=true`,
    { headers: authHeaders(crewToken) },
  );
  assert.equal(uploadScopedList.status, 403);

  const update = await fetch(`${baseUrl}/folders/${uploadBlockedPhotoFolderId}`, {
    method: "PUT",
    headers: {
      ...authHeaders(adminToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      uploadingPermissions: {
        admin: true,
        crew_member: true,
        users: { [crewUserId]: true },
      },
    }),
  });
  assert.equal(update.status, 200);

  const allowedUploadScopedList = await fetch(
    `${baseUrl}/folders/${uploadBlockedPhotoFolderId}/files?includeDeleted=true`,
    { headers: authHeaders(crewToken) },
  );
  assert.equal(allowedUploadScopedList.status, 200);
});
