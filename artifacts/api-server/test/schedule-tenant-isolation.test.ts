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
const createdScheduleItemIds: string[] = [];

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
  const { jobs, organizationMemberships, organizations, users } = await import(
    "@workspace/db/schema"
  );

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Schedule Tenant A ${runId}`,
      slug: `schedule-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Schedule Tenant B ${runId}`,
      slug: `schedule-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `schedule-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Schedule Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `schedule-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Schedule Tenant B Admin",
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
      title: `Schedule Tenant A Job ${runId}`,
      createdBy: orgAAdminId,
    },
    {
      id: orgBJobId,
      organizationId: orgBId,
      title: `Schedule Tenant B Job ${runId}`,
      createdBy: orgBAdminId,
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `schedule-admin-a-${runId}@tenant.local`,
    fullName: "Schedule Tenant A Admin",
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
    jobs,
    organizationMemberships,
    organizations,
    scheduleItemAssignees,
    scheduleItemPredecessors,
    scheduleItems,
    schedulePhases,
    scheduleSettings,
    scheduleTagSettings,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    if (createdScheduleItemIds.length > 0) {
      await db.delete(activityLog).where(inArray(activityLog.entityId, createdScheduleItemIds));
      await db
        .delete(scheduleItemPredecessors)
        .where(inArray(scheduleItemPredecessors.scheduleItemId, createdScheduleItemIds));
      await db
        .delete(scheduleItemAssignees)
        .where(inArray(scheduleItemAssignees.scheduleItemId, createdScheduleItemIds));
      await db.delete(scheduleItems).where(inArray(scheduleItems.id, createdScheduleItemIds));
    }
    await db.delete(scheduleTagSettings).where(inArray(scheduleTagSettings.jobId, [orgAJobId, orgBJobId]));
    await db.delete(scheduleSettings).where(inArray(scheduleSettings.jobId, [orgAJobId, orgBJobId]));
    await db.delete(schedulePhases).where(inArray(schedulePhases.jobId, [orgAJobId, orgBJobId]));
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

test("schedule access and create-side child rows are scoped to the active organization", async () => {
  const foreignSchedule = await fetch(`${baseUrl}/jobs/${orgBJobId}/schedule`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignSchedule.status, 404);

  const startDate = new Date().toISOString().slice(0, 10);
  const createResponse = await fetch(`${baseUrl}/jobs/${orgAJobId}/schedule`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      title: `Schedule Tenant Item ${runId}`,
      startDate,
      workDays: 1,
      assigneeIds: [orgAAdminId],
      tags: [`tenant-${runId}`],
    }),
  });
  assert.equal(createResponse.status, 201);
  const createBody = (await createResponse.json()) as {
    item: { id: string; organizationId?: string | null };
  };
  createdScheduleItemIds.push(createBody.item.id);

  const { db } = await import("@workspace/db");
  const {
    scheduleItemAssignees,
    scheduleItems,
    schedulePhases,
    scheduleSettings,
    scheduleTagSettings,
  } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const [item] = await db
    .select({ organizationId: scheduleItems.organizationId })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, createBody.item.id))
    .limit(1);
  assert.equal(item?.organizationId, orgAId);

  const [assignee] = await db
    .select({ organizationId: scheduleItemAssignees.organizationId })
    .from(scheduleItemAssignees)
    .where(eq(scheduleItemAssignees.scheduleItemId, createBody.item.id))
    .limit(1);
  assert.equal(assignee?.organizationId, orgAId);

  const [phase] = await db
    .select({ organizationId: schedulePhases.organizationId })
    .from(schedulePhases)
    .where(eq(schedulePhases.jobId, orgAJobId))
    .limit(1);
  assert.equal(phase?.organizationId, orgAId);

  const [settings] = await db
    .select({ organizationId: scheduleSettings.organizationId })
    .from(scheduleSettings)
    .where(eq(scheduleSettings.jobId, orgAJobId))
    .limit(1);
  assert.equal(settings?.organizationId, orgAId);

  const [tag] = await db
    .select({ organizationId: scheduleTagSettings.organizationId })
    .from(scheduleTagSettings)
    .where(eq(scheduleTagSettings.jobId, orgAJobId))
    .limit(1);
  assert.equal(tag?.organizationId, orgAId);
});
