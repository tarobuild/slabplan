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
const orgALeadId = crypto.randomUUID();
const orgBLeadId = crypto.randomUUID();
const orgAScheduleItemId = crypto.randomUUID();
const orgBScheduleItemId = crypto.randomUUID();
const orgADailyLogId = crypto.randomUUID();
const orgBDailyLogId = crypto.randomUUID();

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
    dailyLogs,
    jobs,
    leads,
    organizationMemberships,
    organizations,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Dashboard Tenant A ${runId}`,
      slug: `dashboard-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Dashboard Tenant B ${runId}`,
      slug: `dashboard-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `dashboard-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Dashboard Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `dashboard-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Dashboard Tenant B Admin",
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

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await db.insert(jobs).values([
    {
      id: orgAJobId,
      organizationId: orgAId,
      title: `Dashboard Tenant A Job ${runId}`,
      status: "open",
      projectedStart: today,
      projectedCompletion: tomorrow,
      createdBy: orgAAdminId,
    },
    {
      id: orgBJobId,
      organizationId: orgBId,
      title: `Dashboard Tenant B Job ${runId}`,
      status: "open",
      projectedStart: today,
      projectedCompletion: tomorrow,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(leads).values([
    {
      id: orgALeadId,
      organizationId: orgAId,
      title: `Dashboard Tenant A Lead ${runId}`,
      status: "open",
      createdBy: orgAAdminId,
    },
    {
      id: orgBLeadId,
      organizationId: orgBId,
      title: `Dashboard Tenant B Lead ${runId}`,
      status: "open",
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(scheduleItems).values([
    {
      id: orgAScheduleItemId,
      organizationId: orgAId,
      jobId: orgAJobId,
      title: `Dashboard Tenant A Schedule ${runId}`,
      startDate: today,
      endDate: tomorrow,
      workDays: 2,
      createdBy: orgAAdminId,
    },
    {
      id: orgBScheduleItemId,
      organizationId: orgBId,
      jobId: orgBJobId,
      title: `Dashboard Tenant B Schedule ${runId}`,
      startDate: today,
      endDate: tomorrow,
      workDays: 2,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(dailyLogs).values([
    {
      id: orgADailyLogId,
      organizationId: orgAId,
      jobId: orgAJobId,
      logDate: today,
      title: `Dashboard Tenant A Log ${runId}`,
      notes: "Tenant A dashboard log",
      createdBy: orgAAdminId,
      publishedAt: new Date(),
    },
    {
      id: orgBDailyLogId,
      organizationId: orgBId,
      jobId: orgBJobId,
      logDate: today,
      title: `Dashboard Tenant B Log ${runId}`,
      notes: "Tenant B dashboard log",
      createdBy: orgAAdminId,
      publishedAt: new Date(),
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `dashboard-admin-a-${runId}@tenant.local`,
    fullName: "Dashboard Tenant A Admin",
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
    dailyLogs,
    jobs,
    leads,
    organizationMemberships,
    organizations,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    await db.delete(dailyLogs).where(inArray(dailyLogs.id, [orgADailyLogId, orgBDailyLogId]));
    await db
      .delete(scheduleItems)
      .where(inArray(scheduleItems.id, [orgAScheduleItemId, orgBScheduleItemId]));
    await db.delete(leads).where(inArray(leads.id, [orgALeadId, orgBLeadId]));
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

function authHeaders() {
  return { authorization: `Bearer ${orgAAdminToken}` };
}

test("dashboard summary, agenda, and schedule are scoped to the active organization", async () => {
  const statsResponse = await fetch(`${baseUrl}/dashboard/stats`, {
    headers: authHeaders(),
  });
  assert.equal(statsResponse.status, 200);
  const statsBody = (await statsResponse.json()) as {
    stats: {
      activeJobs: number;
      openLeads: number;
      openScheduleItems: number;
      myDailyLogs: number;
    };
  };
  assert.deepEqual(statsBody.stats, {
    activeJobs: 1,
    openLeads: 1,
    openScheduleItems: 1,
    myDailyLogs: 1,
  });

  const agendaResponse = await fetch(`${baseUrl}/dashboard/agenda`, {
    headers: authHeaders(),
  });
  assert.equal(agendaResponse.status, 200);
  const agendaBody = (await agendaResponse.json()) as {
    upcomingItems: Array<{ id: string }>;
    recentLogs: Array<{ id: string }>;
    recentJobs: Array<{ id: string }>;
  };
  assert.ok(agendaBody.upcomingItems.some((item) => item.id === orgAScheduleItemId));
  assert.equal(agendaBody.upcomingItems.some((item) => item.id === orgBScheduleItemId), false);
  assert.ok(agendaBody.recentLogs.some((log) => log.id === orgADailyLogId));
  assert.equal(agendaBody.recentLogs.some((log) => log.id === orgBDailyLogId), false);
  assert.ok(agendaBody.recentJobs.some((job) => job.id === orgAJobId));
  assert.equal(agendaBody.recentJobs.some((job) => job.id === orgBJobId), false);

  const scheduleResponse = await fetch(`${baseUrl}/dashboard/schedule`, {
    headers: authHeaders(),
  });
  assert.equal(scheduleResponse.status, 200);
  const scheduleBody = (await scheduleResponse.json()) as {
    items: Array<{ id: string; jobId: string }>;
  };
  assert.ok(scheduleBody.items.some((item) => item.id === orgAScheduleItemId));
  assert.equal(scheduleBody.items.some((item) => item.id === orgBScheduleItemId), false);
  assert.ok(scheduleBody.items.some((item) => item.id === `job:${orgAJobId}`));
  assert.equal(scheduleBody.items.some((item) => item.id === `job:${orgBJobId}`), false);
});
