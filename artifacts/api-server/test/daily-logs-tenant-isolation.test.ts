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
let orgAAdminToken: string;

const runId = crypto.randomUUID();
const orgAId = crypto.randomUUID();
const orgBId = crypto.randomUUID();
const orgAAdminId = crypto.randomUUID();
const orgBAdminId = crypto.randomUUID();
const orgAJobId = crypto.randomUUID();
const orgBJobId = crypto.randomUUID();
const orgBLogId = crypto.randomUUID();
const orgBSettingsId = crypto.randomUUID();
const orgBCustomFieldId = crypto.randomUUID();
const sharedCustomFieldName = `Tenant Shared Field ${runId}`;
const createdLogIds: string[] = [];
const createdCustomFieldIds: string[] = [];

function jsonHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://stub.invalid";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const {
    dailyLogCustomFields,
    dailyLogSettings,
    dailyLogs,
    jobs,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Daily Logs Tenant A ${runId}`,
      slug: `daily-logs-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Daily Logs Tenant B ${runId}`,
      slug: `daily-logs-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `daily-logs-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Daily Logs Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `daily-logs-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Daily Logs Tenant B Admin",
      role: "admin",
      defaultOrganizationId: orgBId,
    },
  ]);

  await db.insert(organizationMemberships).values([
    {
      organizationId: orgAId,
      userId: orgAAdminId,
      role: "admin",
      isDefault: true,
    },
    {
      organizationId: orgBId,
      userId: orgBAdminId,
      role: "admin",
      isDefault: true,
    },
  ]);

  await db.insert(jobs).values([
    {
      id: orgAJobId,
      organizationId: orgAId,
      title: `Daily Logs Tenant A Job ${runId}`,
      createdBy: orgAAdminId,
    },
    {
      id: orgBJobId,
      organizationId: orgBId,
      title: `Daily Logs Tenant B Job ${runId}`,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(dailyLogs).values({
    id: orgBLogId,
    organizationId: orgBId,
    jobId: orgBJobId,
    logDate: new Date().toISOString().slice(0, 10),
    title: `Daily Logs Tenant B Log ${runId}`,
    notes: "Foreign tenant log",
    createdBy: orgAAdminId,
    publishedAt: new Date(),
  });

  await db.insert(dailyLogSettings).values({
    id: orgBSettingsId,
    organizationId: orgBId,
    defaultNotes: "Foreign tenant settings",
  });

  await db.insert(dailyLogCustomFields).values({
    id: orgBCustomFieldId,
    organizationId: orgBId,
    name: sharedCustomFieldName,
    fieldType: "text",
    options: [],
    displayOrder: 0,
  });

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `daily-logs-admin-a-${runId}@tenant.local`,
    fullName: "Daily Logs Tenant A Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    defaultOrganizationId: orgAId,
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

  const { db, pool } = await import("@workspace/db");
  const {
    activityLog,
    dailyLogComments,
    dailyLogCustomFields,
    dailyLogLikes,
    dailyLogSettings,
    dailyLogTags,
    dailyLogTodos,
    dailyLogs,
    jobs,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    const allLogIds = [orgBLogId, ...createdLogIds];
    await db.delete(activityLog).where(inArray(activityLog.entityId, allLogIds));
    await db.delete(dailyLogComments).where(inArray(dailyLogComments.dailyLogId, allLogIds));
    await db.delete(dailyLogLikes).where(inArray(dailyLogLikes.dailyLogId, allLogIds));
    await db.delete(dailyLogTodos).where(inArray(dailyLogTodos.dailyLogId, allLogIds));
    await db.delete(dailyLogTags).where(inArray(dailyLogTags.dailyLogId, allLogIds));
    await db.delete(dailyLogs).where(inArray(dailyLogs.id, allLogIds));
    await db
      .delete(dailyLogCustomFields)
      .where(inArray(dailyLogCustomFields.id, [orgBCustomFieldId, ...createdCustomFieldIds]));
    await db.delete(dailyLogSettings).where(inArray(dailyLogSettings.id, [orgBSettingsId]));
    await db.delete(jobs).where(inArray(jobs.id, [orgAJobId, orgBJobId]));
    await db
      .delete(organizationMemberships)
      .where(inArray(organizationMemberships.organizationId, [orgAId, orgBId]));
    await db.delete(users).where(inArray(users.id, [orgAAdminId, orgBAdminId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  } finally {
    await pool.end();
  }
});

test("daily-log reads and child writes are scoped to the active organization", async () => {
  const foreignJobLogs = await fetch(`${baseUrl}/jobs/${orgBJobId}/daily-logs`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignJobLogs.status, 404);

  const foreignDetail = await fetch(`${baseUrl}/daily-logs/${orgBLogId}`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignDetail.status, 404);

  const feed = await fetch(`${baseUrl}/daily-logs/feed?pageSize=50`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(feed.status, 200);
  const feedBody = (await feed.json()) as { logs: Array<{ id: string }> };
  assert.equal(feedBody.logs.some((log) => log.id === orgBLogId), false);

  const mine = await fetch(`${baseUrl}/daily-logs/mine?pageSize=50`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(mine.status, 200);
  const mineBody = (await mine.json()) as { logs: Array<{ id: string }> };
  assert.equal(mineBody.logs.some((log) => log.id === orgBLogId), false);

  const createResponse = await fetch(`${baseUrl}/jobs/${orgAJobId}/daily-logs`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      logDate: new Date().toISOString().slice(0, 10),
      title: `Daily Logs Tenant A Log ${runId}`,
      notes: "Tenant A log",
      tags: [`tenant-${runId}`],
      shareInternalUsers: true,
    }),
  });
  assert.equal(createResponse.status, 201);
  const createBody = (await createResponse.json()) as {
    log: { id: string; organizationId?: string | null };
  };
  createdLogIds.push(createBody.log.id);

  const likeResponse = await fetch(`${baseUrl}/daily-logs/${createBody.log.id}/like`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
  });
  assert.equal(likeResponse.status, 200);

  const commentResponse = await fetch(`${baseUrl}/daily-logs/${createBody.log.id}/comments`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({ body: `Tenant comment ${runId}` }),
  });
  assert.equal(commentResponse.status, 201);

  const todoResponse = await fetch(`${baseUrl}/daily-logs/${createBody.log.id}/todos`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({ title: `Tenant todo ${runId}` }),
  });
  assert.equal(todoResponse.status, 201);

  const { db } = await import("@workspace/db");
  const { dailyLogComments, dailyLogLikes, dailyLogTags, dailyLogTodos, dailyLogs } =
    await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const [log] = await db
    .select({ organizationId: dailyLogs.organizationId })
    .from(dailyLogs)
    .where(eq(dailyLogs.id, createBody.log.id))
    .limit(1);
  assert.equal(log?.organizationId, orgAId);

  const [tag] = await db
    .select({ organizationId: dailyLogTags.organizationId })
    .from(dailyLogTags)
    .where(eq(dailyLogTags.dailyLogId, createBody.log.id))
    .limit(1);
  assert.equal(tag?.organizationId, orgAId);

  const [like] = await db
    .select({ organizationId: dailyLogLikes.organizationId })
    .from(dailyLogLikes)
    .where(eq(dailyLogLikes.dailyLogId, createBody.log.id))
    .limit(1);
  assert.equal(like?.organizationId, orgAId);

  const [comment] = await db
    .select({ organizationId: dailyLogComments.organizationId })
    .from(dailyLogComments)
    .where(eq(dailyLogComments.dailyLogId, createBody.log.id))
    .limit(1);
  assert.equal(comment?.organizationId, orgAId);

  const [todo] = await db
    .select({ organizationId: dailyLogTodos.organizationId })
    .from(dailyLogTodos)
    .where(eq(dailyLogTodos.dailyLogId, createBody.log.id))
    .limit(1);
  assert.equal(todo?.organizationId, orgAId);
});

test("daily-log admin settings and custom fields are scoped to the active organization", async () => {
  const settingsResponse = await fetch(`${baseUrl}/daily-logs/settings`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(settingsResponse.status, 200);
  const settingsBody = (await settingsResponse.json()) as {
    settings: { id: string; organizationId?: string | null; defaultNotes?: string | null };
  };
  assert.notEqual(settingsBody.settings.id, orgBSettingsId);
  assert.equal(settingsBody.settings.organizationId, orgAId);

  const createFieldResponse = await fetch(`${baseUrl}/daily-logs/custom-fields`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      name: sharedCustomFieldName,
      fieldType: "text",
    }),
  });
  assert.equal(createFieldResponse.status, 201);
  const createFieldBody = (await createFieldResponse.json()) as {
    field: { id: string; organizationId?: string | null };
  };
  createdCustomFieldIds.push(createFieldBody.field.id);
  assert.equal(createFieldBody.field.organizationId, orgAId);

  const fieldsResponse = await fetch(`${baseUrl}/daily-logs/custom-fields`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(fieldsResponse.status, 200);
  const fieldsBody = (await fieldsResponse.json()) as { fields: Array<{ id: string }> };
  assert.equal(fieldsBody.fields.some((field) => field.id === orgBCustomFieldId), false);
  assert.equal(fieldsBody.fields.some((field) => field.id === createFieldBody.field.id), true);

  const foreignUpdate = await fetch(`${baseUrl}/daily-logs/custom-fields/${orgBCustomFieldId}`, {
    method: "PUT",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      name: `${sharedCustomFieldName} Updated`,
      fieldType: "text",
    }),
  });
  assert.equal(foreignUpdate.status, 404);

  const foreignDelete = await fetch(`${baseUrl}/daily-logs/custom-fields/${orgBCustomFieldId}`, {
    method: "DELETE",
    headers: jsonHeaders(orgAAdminToken),
  });
  assert.equal(foreignDelete.status, 404);
});
