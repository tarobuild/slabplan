import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let orgAAdminToken: string;
let orgBAdminToken: string;
let orgADrafterToken: string;

const runId = crypto.randomUUID();
const orgAId = crypto.randomUUID();
const orgBId = crypto.randomUUID();
const orgAAdminId = crypto.randomUUID();
const orgBAdminId = crypto.randomUUID();
const orgADrafterId = crypto.randomUUID();
const orgAJobId = crypto.randomUUID();
const orgBJobId = crypto.randomUUID();
const createdScheduleItemIds: string[] = [];
const companyScheduleItemIds = Array.from({ length: 5 }, () => crypto.randomUUID());

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
  const { jobs, organizationMemberships, organizations, scheduleItems, scheduleItemAssignees, users } =
    await import("@workspace/db/schema");

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
    {
      id: orgADrafterId,
      email: `schedule-drafter-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Schedule Tenant A Drafter",
      role: "drafter",
      defaultOrganizationId: orgAId,
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
    {
      organizationId: orgAId,
      userId: orgADrafterId,
      role: "drafter",
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

  await db.insert(scheduleItems).values(companyScheduleItemIds.map((id, index) => ({
    id,
    organizationId: index === 2 ? orgBId : index === 3 ? null : orgAId,
    jobId: index === 2 ? orgBJobId : orgAJobId,
    title: `Company Schedule Fixture ${index} ${runId}`,
    startDate: `2040-01-0${index + 1}`,
    endDate: `2040-01-0${index + 1}`,
    workDays: 1,
    createdBy: index === 4 ? orgBAdminId : orgAAdminId,
    isPersonalTodo: index === 4,
  })));
  // A stale foreign assignment must not override the active-company boundary.
  await db.insert(scheduleItemAssignees).values([0, 2].map((index) => ({
    scheduleItemId: companyScheduleItemIds[index],
    organizationId: index === 2 ? orgBId : orgAId,
    userId: orgADrafterId,
  })));

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
  const { eq } = await import("drizzle-orm");
  for (const userId of [orgBAdminId, orgADrafterId]) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const token = auth.signAccessToken(user);
    if (userId === orgBAdminId) orgBAdminToken = token;
    else orgADrafterToken = token;
  }

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
    const allScheduleItemIds = [...createdScheduleItemIds, ...companyScheduleItemIds];
    if (allScheduleItemIds.length > 0) {
      await db
        .delete(activityLog)
        .where(inArray(activityLog.entityId, allScheduleItemIds));
      await db
        .delete(scheduleItemPredecessors)
        .where(
          inArray(
            scheduleItemPredecessors.scheduleItemId,
            allScheduleItemIds,
          ),
        );
      await db
        .delete(scheduleItemAssignees)
        .where(
          inArray(scheduleItemAssignees.scheduleItemId, allScheduleItemIds),
        );
      await db
        .delete(scheduleItems)
        .where(inArray(scheduleItems.id, allScheduleItemIds));
    }
    await db
      .delete(scheduleTagSettings)
      .where(inArray(scheduleTagSettings.jobId, [orgAJobId, orgBJobId]));
    await db
      .delete(scheduleSettings)
      .where(inArray(scheduleSettings.jobId, [orgAJobId, orgBJobId]));
    await db
      .delete(schedulePhases)
      .where(inArray(schedulePhases.jobId, [orgAJobId, orgBJobId]));
    await db.delete(jobs).where(inArray(jobs.id, [orgAJobId, orgBJobId]));
    await db
      .delete(organizationMemberships)
      .where(inArray(organizationMemberships.organizationId, [orgAId, orgBId]));
    await db.delete(users).where(inArray(users.id, [orgAAdminId, orgBAdminId, orgADrafterId]));
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [orgAId, orgBId]));
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

test("both custom phase creation routes preserve the tenant and support task assignment", async () => {
  const { db } = await import("@workspace/db");
  const { schedulePhases } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  for (const path of ["schedule/phases", "schedule/settings/phases"]) {
    const foreignResponse = await fetch(
      `${baseUrl}/jobs/${orgBJobId}/${path}`,
      {
        method: "POST",
        headers: jsonHeaders(orgAAdminToken),
        body: JSON.stringify({ name: `Forbidden ${path}` }),
      },
    );
    assert.equal(foreignResponse.status, 404);

    const response = await fetch(`${baseUrl}/jobs/${orgAJobId}/${path}`, {
      method: "POST",
      headers: jsonHeaders(orgAAdminToken),
      body: JSON.stringify({ name: `Custom ${path}`, color: "#0f766e" }),
    });
    assert.equal(response.status, 201);
    const { phase } = (await response.json()) as { phase: { id: string } };
    const [stored] = await db
      .select()
      .from(schedulePhases)
      .where(eq(schedulePhases.id, phase.id));
    assert.equal(stored.organizationId, orgAId);

    const patch = await fetch(
      `${baseUrl}/schedule-items/${createdScheduleItemIds[0]}`,
      {
        method: "PATCH",
        headers: jsonHeaders(orgAAdminToken),
        body: JSON.stringify({ phaseId: phase.id, progress: 60 }),
      },
    );
    assert.equal(patch.status, 200, await patch.text());
  }
});

test("legacy phases reject cleanly until the idempotent tenant repair is applied", async () => {
  const { db } = await import("@workspace/db");
  const { schedulePhases } = await import("@workspace/db/schema");
  const [phase] = await db
    .insert(schedulePhases)
    .values({
      organizationId: null,
      jobId: orgAJobId,
      name: `Legacy unscoped ${runId}`,
      color: "#0f766e",
    })
    .returning();
  const response = await fetch(
    `${baseUrl}/schedule-items/${createdScheduleItemIds[0]}`,
    {
      method: "PATCH",
      headers: jsonHeaders(orgAAdminToken),
      body: JSON.stringify({ phaseId: phase.id }),
    },
  );
  assert.equal(response.status, 400);

  const { sql } = await import("drizzle-orm");
  const migration = readFileSync(
    new URL(
      "../../../lib/db/migrations/0041_schedule_phase_organization.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.execute(sql.raw(migration));
  await db.execute(sql.raw(migration));
  const repaired = await fetch(
    `${baseUrl}/schedule-items/${createdScheduleItemIds[0]}`,
    {
      method: "PATCH",
      headers: jsonHeaders(orgAAdminToken),
      body: JSON.stringify({ phaseId: phase.id }),
    },
  );
  assert.equal(repaired.status, 200, await repaired.text());
});

const companyRange = "from=2040-01-01&to=2040-01-10";

test("company schedule pages, totals, cursors and foreign filters stay within the active organization", async () => {
  const first = await fetch(`${baseUrl}/schedule?${companyRange}&limit=1`, {
    headers: jsonHeaders(orgAAdminToken),
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.pagination.totalItems, 2);
  assert.equal(firstBody.pagination.totalPages, 2);
  assert.deepEqual(firstBody.data.map((item: { id: string }) => item.id), [companyScheduleItemIds[0]]);
  assert.equal(firstBody.data[0].jobId, orgAJobId);
  assert.equal(firstBody.data[0].jobTitle, `Schedule Tenant A Job ${runId}`);

  const second = await fetch(`${baseUrl}/schedule?${companyRange}&limit=1&page=2`, {
    headers: jsonHeaders(orgAAdminToken),
  });
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).data.map((item: { id: string }) => item.id), [companyScheduleItemIds[1]]);

  let cursor = "";
  const ids: string[] = [];
  for (let page = 0; page < 3; page++) {
    const response = await fetch(`${baseUrl}/schedule?${companyRange}&limit=1&cursor=${encodeURIComponent(cursor)}`, {
      headers: jsonHeaders(orgAAdminToken),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    ids.push(...body.data.map((item: { id: string }) => item.id));
    if (!body.pagination.hasMore) break;
    assert.equal(typeof body.pagination.nextCursor, "string");
    cursor = body.pagination.nextCursor;
  }
  assert.deepEqual(ids, companyScheduleItemIds.slice(0, 2));

  for (const cursorMode of [false, true]) {
    const response = await fetch(`${baseUrl}/schedule?${companyRange}&jobId=${orgBJobId}${cursorMode ? "&cursor=" : ""}`, {
      headers: jsonHeaders(orgAAdminToken),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, []);
    if (cursorMode) assert.equal(body.pagination.hasMore, false);
    else assert.equal(body.pagination.totalItems, 0);
  }

  const otherCompany = await fetch(`${baseUrl}/schedule?${companyRange}`, {
    headers: jsonHeaders(orgBAdminToken),
  });
  assert.equal(otherCompany.status, 200);
  const otherBody = await otherCompany.json();
  assert.equal(otherBody.pagination.totalItems, 1);
  assert.deepEqual(otherBody.data.map((item: { id: string }) => item.id), [companyScheduleItemIds[2]]);
});

test("drafter company schedule preserves assignment visibility without leaking foreign assignments", async () => {
  for (const cursorMode of [false, true]) {
    const response = await fetch(`${baseUrl}/schedule?${companyRange}${cursorMode ? "&cursor=" : ""}`, {
      headers: jsonHeaders(orgADrafterToken),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.map((item: { id: string }) => item.id), [companyScheduleItemIds[0]]);
    if (cursorMode) assert.equal(body.pagination.hasMore, false);
    else assert.equal(body.pagination.totalItems, 1);
  }
});
