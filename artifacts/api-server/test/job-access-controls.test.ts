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
const pmManagedOnlyJobId = crypto.randomUUID();
const documentsFolderId = crypto.randomUUID();
const photosFolderId = crypto.randomUUID();
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
  process.env.PRIVATE_OBJECT_DIR ??= "/test-bucket/test-prefix";

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
      fullName: "Restricted Crew",
      role: "crew_member",
    },
    {
      id: pmUserId,
      email: `pm-${runId}@job-access.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Restricted PM",
      role: "project_manager",
    },
  ]);

  await db.insert(clients).values({
    id: clientId,
    companyName: `Access Client ${runId}`,
  });

  await db.insert(jobs).values({
    id: jobId,
    title: `Access Job ${runId}`,
    clientId,
    createdBy: adminUserId,
    projectManagerId: null,
  });
  await db.insert(jobs).values({
    id: pmManagedOnlyJobId,
    title: `PM Managed Only ${runId}`,
    clientId,
    createdBy: adminUserId,
    projectManagerId: pmUserId,
  });

  await db.insert(jobAssignees).values([
    {
      jobId,
      userId: crewUserId,
      canViewFinancials: false,
      canViewDocuments: false,
      canViewPhotos: true,
      canViewVideos: true,
      canViewDailyLogs: true,
      canViewSchedule: true,
      canUseAssistant: false,
      canCreateDailyLogs: true,
      canUploadDocuments: false,
      canUploadPhotos: true,
      canUploadVideos: true,
      canCreateFolders: false,
    },
    {
      jobId,
      userId: pmUserId,
      canViewFinancials: false,
      canViewDocuments: true,
      canViewPhotos: true,
      canViewVideos: true,
      canViewDailyLogs: true,
      canViewSchedule: true,
      canUseAssistant: false,
      canCreateDailyLogs: true,
      canUploadDocuments: false,
      canUploadPhotos: true,
      canUploadVideos: true,
      canCreateFolders: false,
    },
  ]);

  await db.insert(folders).values([
    {
      id: documentsFolderId,
      title: `Access Documents ${runId}`,
      scope: "job",
      jobId,
      mediaType: "document",
      viewingPermissions: null,
      uploadingPermissions: null,
    },
    {
      id: photosFolderId,
      title: `Access Photos ${runId}`,
      scope: "job",
      jobId,
      mediaType: "photo",
      viewingPermissions: null,
      uploadingPermissions: null,
    },
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
    fullName: "Restricted Crew",
    role: "crew_member",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  pmToken = auth.signAccessToken({
    id: pmUserId,
    email: `pm-${runId}@job-access.local`,
    fullName: "Restricted PM",
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
  const { clients, jobs, users } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  await db.delete(jobs).where(inArray(jobs.id, [jobId, pmManagedOnlyJobId]));
  await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(users).where(inArray(users.id, [adminUserId, crewUserId, pmUserId]));
});

test("restricted crew can see allowed media but not financials, documents, or assistant", async () => {
  const financials = await fetch(`${baseUrl}/jobs/${jobId}/financials`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(financials.status, 403);

  const documents = await fetch(`${baseUrl}/jobs/${jobId}/folders?mediaType=document`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(documents.status, 403);

  const photos = await fetch(`${baseUrl}/jobs/${jobId}/folders?mediaType=photo`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(photos.status, 200);
  const photosBody = (await photos.json()) as { folders: Array<{ title: string }> };
  assert.ok(
    photosBody.folders.some((folder) => folder.title === "Global Photos"),
    "photo uploads should always have a visible default folder",
  );

  const deniedFolder = await fetch(`${baseUrl}/jobs/${jobId}/folders`, {
    method: "POST",
    headers: {
      ...authHeaders(crewToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      title: `Crew denied folder ${runId}`,
      mediaType: "photo",
      parentFolderId: null,
    }),
  });
  assert.equal(deniedFolder.status, 403);

  const createdLog = await fetch(`${baseUrl}/jobs/${jobId}/daily-logs`, {
    method: "POST",
    headers: {
      ...authHeaders(crewToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      jobId,
      logDate: "2026-05-13",
      title: `Crew field update ${runId}`,
      notes: "Finished templating and uploaded photos from the field.",
      weatherData: null,
      includeWeather: false,
      includeWeatherNotes: false,
      weatherNotes: null,
      shareInternalUsers: true,
      shareSubsVendors: false,
      shareClient: false,
      isPrivate: false,
      notifyUserIds: [],
      tags: ["field"],
      customFieldValues: {},
    }),
  });
  assert.equal(createdLog.status, 201);
  const createdLogBody = (await createdLog.json()) as { log: { id: string } };

  const publishedLog = await fetch(`${baseUrl}/daily-logs/${createdLogBody.log.id}/publish`, {
    method: "POST",
    headers: {
      ...authHeaders(crewToken),
      "x-requested-with": "XMLHttpRequest",
    },
  });
  assert.equal(publishedLog.status, 200);

  const assistantAccess = await fetch(`${baseUrl}/agent/access`, {
    headers: authHeaders(crewToken),
  });
  assert.deepEqual(await assistantAccess.json(), { canUseAssistant: false });

  const conversations = await fetch(`${baseUrl}/agent/conversations`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(conversations.status, 403);
});

test("admin toggles give a crew member financials, documents, and assistant access", async () => {
  const update = await fetch(`${baseUrl}/jobs/${jobId}/assignees/${crewUserId}/access`, {
    method: "PATCH",
    headers: {
      ...authHeaders(adminToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      financials: true,
      documents: true,
      photos: true,
      videos: true,
      dailyLogs: true,
      schedule: true,
      assistant: true,
      createDailyLogs: true,
      uploadDocuments: true,
      uploadPhotos: true,
      uploadVideos: true,
      createFolders: true,
    }),
  });
  assert.equal(update.status, 200);

  const financials = await fetch(`${baseUrl}/jobs/${jobId}/financials`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(financials.status, 200);

  const documents = await fetch(`${baseUrl}/jobs/${jobId}/folders?mediaType=document`, {
    headers: authHeaders(crewToken),
  });
  assert.equal(documents.status, 200);

  const assistantAccess = await fetch(`${baseUrl}/agent/access`, {
    headers: authHeaders(crewToken),
  });
  assert.deepEqual(await assistantAccess.json(), { canUseAssistant: true });

  const createdFolder = await fetch(`${baseUrl}/jobs/${jobId}/folders`, {
    method: "POST",
    headers: {
      ...authHeaders(crewToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      title: `Crew allowed folder ${runId}`,
      mediaType: "photo",
      parentFolderId: null,
    }),
  });
  assert.equal(createdFolder.status, 201);
});

test("folder-level access hides restricted folders and blocks upload actions", async () => {
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
    "explicit folder deny should hide the folder even when internal defaults allow it",
  );
  assert.ok(
    crewPhotosBody.folders.some((folder) => folder.title === `View Only Crew Photos ${runId}`),
    "explicit view allow should keep the folder visible",
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

test("project managers can also be explicitly denied financials", async () => {
  const denied = await fetch(`${baseUrl}/jobs/${jobId}/financials`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(denied.status, 403);

  const update = await fetch(`${baseUrl}/jobs/${jobId}/assignees/${pmUserId}/access`, {
    method: "PATCH",
    headers: {
      ...authHeaders(adminToken),
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      financials: true,
      documents: true,
      photos: true,
      videos: true,
      dailyLogs: true,
      schedule: true,
      assistant: false,
      createDailyLogs: true,
      uploadDocuments: false,
      uploadPhotos: true,
      uploadVideos: true,
      createFolders: false,
    }),
  });
  assert.equal(update.status, 200);

  const allowed = await fetch(`${baseUrl}/jobs/${jobId}/financials`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(allowed.status, 200);
});

test("project managers share the same field-user access model as crew", async () => {
  const clients = await fetch(`${baseUrl}/clients`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(clients.status, 403);

  const leads = await fetch(`${baseUrl}/leads`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(leads.status, 403);

  const companySchedule = await fetch(`${baseUrl}/schedule`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(companySchedule.status, 403);

  const companyDailyLogs = await fetch(`${baseUrl}/daily-logs/feed`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(companyDailyLogs.status, 403);

  const managedOnlyJob = await fetch(`${baseUrl}/jobs/${pmManagedOnlyJobId}`, {
    headers: authHeaders(pmToken),
  });
  assert.equal(managedOnlyJob.status, 403);
});
