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
let isolatedToken: string;

const adminUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const crewUserId = crypto.randomUUID();
const otherAdminId = crypto.randomUUID();
const isolatedUserId = crypto.randomUUID();

const accessibleJobId = crypto.randomUUID();
const inaccessibleJobId = crypto.randomUUID();
const adminOnlyJobIds = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];

const accessibleActivityIds = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const inaccessibleActivityIds = [crypto.randomUUID(), crypto.randomUUID()];
const crewDailyLogIds = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];

// Schedule items seeded into `accessibleJobId` to exercise the SQL-side
// visibility filter on `GET /jobs/:jobId/schedule`. Each item has a unique
// startDate so ordering is deterministic across pages.
const scheduleVisibleAllId = crypto.randomUUID(); // default flags, createdBy PM
const scheduleHiddenFromCrewId = crypto.randomUUID(); // installers=false, createdBy PM
const scheduleHiddenFromPmId = crypto.randomUUID(); // office/estimators=false, createdBy other admin
const scheduleAssignedCrewId = crypto.randomUUID(); // installers=false, but crew is assigned
const scheduleCrewCreatedHiddenId = crypto.randomUUID(); // all flags false, createdBy crew
const schedulePmPersonalTodoId = crypto.randomUUID(); // personal to-do owned by PM
const scheduleAdminPersonalTodoId = crypto.randomUUID(); // personal to-do owned by admin

const scheduleItemIds = [
  scheduleVisibleAllId,
  scheduleHiddenFromCrewId,
  scheduleHiddenFromPmId,
  scheduleAssignedCrewId,
  scheduleCrewCreatedHiddenId,
  schedulePmPersonalTodoId,
  scheduleAdminPersonalTodoId,
];

const pmOwnedLeadId = crypto.randomUUID();
const pmAssignedLeadId = crypto.randomUUID();
const otherAdminLeadIds = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const allLeadIds = [pmOwnedLeadId, pmAssignedLeadId, ...otherAdminLeadIds];

const pmCreatedClientId = crypto.randomUUID();
const pmRelatedClientId = crypto.randomUUID();
const adminOnlyClientIds = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const pmAccessibleClientIds = [pmCreatedClientId, pmRelatedClientId];
const allClientIds = [...pmAccessibleClientIds, ...adminOnlyClientIds];

const testUserIds = [
  adminUserId,
  pmUserId,
  crewUserId,
  otherAdminId,
  isolatedUserId,
];
const testJobIds = [accessibleJobId, inaccessibleJobId, ...adminOnlyJobIds];
const testActivityIds = [...accessibleActivityIds, ...inaccessibleActivityIds];

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
    users,
    jobs,
    activityLog,
    dailyLogs,
    leads,
    leadSalespeople,
    clients,
    scheduleItems,
    scheduleItemAssignees,
  } = await import("@workspace/db/schema");
  const { eq: eqOp } = await import("drizzle-orm");

  await prepareApp();

  const passwordHash = "test-not-a-real-hash";
  const adminEmail = `admin-${adminUserId}@pagination-test.local`;
  const pmEmail = `pm-${pmUserId}@pagination-test.local`;
  const crewEmail = `crew-${crewUserId}@pagination-test.local`;
  const otherAdminEmail = `admin2-${otherAdminId}@pagination-test.local`;
  const isolatedEmail = `isolated-${isolatedUserId}@pagination-test.local`;

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash,
      fullName: "ZZZ Pagination Admin",
      role: "admin",
    },
    {
      id: pmUserId,
      email: pmEmail,
      passwordHash,
      fullName: "ZZZ Pagination PM",
      role: "project_manager",
    },
    {
      id: crewUserId,
      email: crewEmail,
      passwordHash,
      fullName: "ZZZ Pagination Crew",
      role: "crew_member",
    },
    {
      id: otherAdminId,
      email: otherAdminEmail,
      passwordHash,
      fullName: "ZZZ Pagination Other Admin",
      role: "admin",
    },
    {
      id: isolatedUserId,
      email: isolatedEmail,
      passwordHash,
      fullName: "ZZZ Pagination Isolated Crew",
      role: "crew_member",
    },
  ]);

  await db.insert(jobs).values([
    {
      id: accessibleJobId,
      title: "ZZZ Pagination Accessible Job",
      createdBy: pmUserId,
      projectManagerId: pmUserId,
    },
    {
      id: inaccessibleJobId,
      title: "ZZZ Pagination Inaccessible Job",
      createdBy: otherAdminId,
      projectManagerId: otherAdminId,
    },
    ...adminOnlyJobIds.map((id, i) => ({
      id,
      title: `ZZZ Pagination Admin Only Job ${i}`,
      createdBy: otherAdminId,
      projectManagerId: otherAdminId,
    })),
  ]);

  await db.insert(leads).values([
    {
      id: pmOwnedLeadId,
      title: "ZZZ Pagination PM Owned Lead",
      createdBy: pmUserId,
    },
    {
      id: pmAssignedLeadId,
      title: "ZZZ Pagination PM Assigned Lead",
      createdBy: otherAdminId,
    },
    ...otherAdminLeadIds.map((id, i) => ({
      id,
      title: `ZZZ Pagination Admin Only Lead ${i}`,
      createdBy: otherAdminId,
    })),
  ]);

  await db.insert(leadSalespeople).values([
    {
      leadId: pmAssignedLeadId,
      userId: pmUserId,
    },
  ]);

  await db.insert(clients).values([
    {
      id: pmCreatedClientId,
      companyName: "ZZZ Pagination PM Created Client",
      createdBy: pmUserId,
    },
    {
      id: pmRelatedClientId,
      companyName: "ZZZ Pagination PM Related Client",
      createdBy: otherAdminId,
    },
    ...adminOnlyClientIds.map((id, i) => ({
      id,
      companyName: `ZZZ Pagination Admin Only Client ${i}`,
      createdBy: otherAdminId,
    })),
  ]);

  await db
    .update(jobs)
    .set({ clientId: pmRelatedClientId })
    .where(eqOp(jobs.id, accessibleJobId));

  const baseTime = Date.now();

  await db.insert(activityLog).values([
    ...accessibleActivityIds.map((id, i) => ({
      id,
      entityType: "file",
      entityId: crypto.randomUUID(),
      action: "created",
      userId: pmUserId,
      metadata: { jobId: accessibleJobId, description: `accessible-${i}` },
      createdAt: new Date(baseTime + i * 1000),
    })),
    ...inaccessibleActivityIds.map((id, i) => ({
      id,
      entityType: "file",
      entityId: crypto.randomUUID(),
      action: "created",
      userId: otherAdminId,
      metadata: { jobId: inaccessibleJobId, description: `inaccessible-${i}` },
      createdAt: new Date(baseTime + 100_000 + i * 1000),
    })),
  ]);

  await db.insert(dailyLogs).values(
    crewDailyLogIds.map((id, i) => {
      const day = String(i + 1).padStart(2, "0");
      return {
        id,
        jobId: accessibleJobId,
        logDate: `2025-02-${day}`,
        title: `ZZZ Pagination Daily Log ${i}`,
        notes: `Notes ${i}`,
        createdBy: crewUserId,
      };
    }),
  );

  // Seven schedule items in `accessibleJobId` covering each visibility branch
  // exercised by `buildScheduleListVisibilityFilter`. Distinct startDates
  // guarantee a deterministic order in the SQL `ORDER BY startDate, id` clause.
  await db.insert(scheduleItems).values([
    {
      id: scheduleVisibleAllId,
      jobId: accessibleJobId,
      title: "ZZZ Pagination Schedule Visible To All",
      startDate: "2025-03-01",
      workDays: 1,
      endDate: "2025-03-01",
      createdBy: pmUserId,
    },
    {
      id: scheduleHiddenFromCrewId,
      jobId: accessibleJobId,
      title: "ZZZ Pagination Schedule Hidden From Crew",
      startDate: "2025-03-02",
      workDays: 1,
      endDate: "2025-03-02",
      visibleToInstallers: false,
      createdBy: pmUserId,
    },
    {
      id: scheduleHiddenFromPmId,
      jobId: accessibleJobId,
      title: "ZZZ Pagination Schedule Hidden From PM",
      startDate: "2025-03-03",
      workDays: 1,
      endDate: "2025-03-03",
      visibleToOfficeStaff: false,
      visibleToEstimators: false,
      createdBy: otherAdminId,
    },
    {
      id: scheduleAssignedCrewId,
      jobId: accessibleJobId,
      title: "ZZZ Pagination Schedule Assigned To Crew",
      startDate: "2025-03-04",
      workDays: 1,
      endDate: "2025-03-04",
      visibleToInstallers: false,
      createdBy: otherAdminId,
    },
    {
      id: scheduleCrewCreatedHiddenId,
      jobId: accessibleJobId,
      title: "ZZZ Pagination Schedule Crew Created Hidden",
      startDate: "2025-03-05",
      workDays: 1,
      endDate: "2025-03-05",
      visibleToOfficeStaff: false,
      visibleToEstimators: false,
      visibleToInstallers: false,
      createdBy: crewUserId,
    },
    {
      id: schedulePmPersonalTodoId,
      jobId: accessibleJobId,
      title: "ZZZ Pagination Schedule PM Personal Todo",
      startDate: "2025-03-06",
      workDays: 1,
      endDate: "2025-03-06",
      isPersonalTodo: true,
      createdBy: pmUserId,
    },
    {
      id: scheduleAdminPersonalTodoId,
      jobId: accessibleJobId,
      title: "ZZZ Pagination Schedule Admin Personal Todo",
      startDate: "2025-03-07",
      workDays: 1,
      endDate: "2025-03-07",
      isPersonalTodo: true,
      createdBy: adminUserId,
    },
  ]);

  await db.insert(scheduleItemAssignees).values({
    scheduleItemId: scheduleAssignedCrewId,
    userId: crewUserId,
  });

  adminToken = auth.signAccessToken(
    makePublicUser(adminUserId, "admin", adminEmail, "ZZZ Pagination Admin"),
  );
  pmToken = auth.signAccessToken(
    makePublicUser(pmUserId, "project_manager", pmEmail, "ZZZ Pagination PM"),
  );
  crewToken = auth.signAccessToken(
    makePublicUser(crewUserId, "crew_member", crewEmail, "ZZZ Pagination Crew"),
  );
  isolatedToken = auth.signAccessToken(
    makePublicUser(
      isolatedUserId,
      "crew_member",
      isolatedEmail,
      "ZZZ Pagination Isolated Crew",
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
    activityLog,
    clients,
    dailyLogs,
    jobAssignees,
    jobs,
    leadSalespeople,
    leadSources,
    leadTags,
    leads,
    scheduleItemAssignees,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    await db
      .delete(activityLog)
      .where(inArray(activityLog.id, testActivityIds));
    await db.delete(dailyLogs).where(inArray(dailyLogs.id, crewDailyLogIds));
    await db
      .delete(scheduleItemAssignees)
      .where(inArray(scheduleItemAssignees.scheduleItemId, scheduleItemIds));
    await db
      .delete(scheduleItems)
      .where(inArray(scheduleItems.id, scheduleItemIds));
    await db.delete(jobAssignees).where(inArray(jobAssignees.jobId, testJobIds));
    await db
      .delete(leadSalespeople)
      .where(inArray(leadSalespeople.leadId, allLeadIds));
    await db.delete(leadTags).where(inArray(leadTags.leadId, allLeadIds));
    await db.delete(leadSources).where(inArray(leadSources.leadId, allLeadIds));
    await db.delete(leads).where(inArray(leads.id, allLeadIds));
    await db.delete(jobs).where(inArray(jobs.id, testJobIds));
    await db.delete(clients).where(inArray(clients.id, allClientIds));
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

test("GET /activity returns the {data, pagination} envelope", async () => {
  const response = await fetch(`${baseUrl}/api/activity?limit=5`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: unknown[];
    pagination: Record<string, number>;
  };

  assert.ok(Array.isArray(body.data));
  assert.equal(typeof body.pagination, "object");
  assert.equal(typeof body.pagination.page, "number");
  assert.equal(typeof body.pagination.limit, "number");
  assert.equal(typeof body.pagination.total, "number");
  assert.equal(typeof body.pagination.totalItems, "number");
  assert.equal(typeof body.pagination.totalPages, "number");
});

test("GET /activity honors page and limit when scoped to a job", async () => {
  const firstPage = await fetch(
    `${baseUrl}/api/activity?jobId=${accessibleJobId}&limit=2&page=1`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(firstPage.status, 200);
  const firstBody = (await firstPage.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(firstBody.data.length, 2);
  assert.equal(firstBody.pagination.page, 1);
  assert.equal(firstBody.pagination.limit, 2);
  assert.equal(firstBody.pagination.total, 3);
  assert.equal(firstBody.pagination.totalItems, 3);
  assert.equal(firstBody.pagination.totalPages, 2);

  const secondPage = await fetch(
    `${baseUrl}/api/activity?jobId=${accessibleJobId}&limit=2&page=2`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(secondPage.status, 200);
  const secondBody = (await secondPage.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(secondBody.data.length, 1);
  assert.equal(secondBody.pagination.page, 2);

  const firstIds = new Set(firstBody.data.map((row) => row.id));
  for (const row of secondBody.data) {
    assert.equal(firstIds.has(row.id), false, "page 2 must not repeat page 1 ids");
  }

  const allReturnedIds = new Set([
    ...firstBody.data.map((row) => row.id),
    ...secondBody.data.map((row) => row.id),
  ]);
  for (const id of accessibleActivityIds) {
    assert.equal(allReturnedIds.has(id), true);
  }
});

test("GET /activity rejects requests for jobs the caller cannot see", async () => {
  const response = await fetch(
    `${baseUrl}/api/activity?jobId=${inaccessibleJobId}`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 403);
});

test("GET /activity never returns rows from inaccessible jobs", async () => {
  const response = await fetch(`${baseUrl}/api/activity?limit=100`, {
    headers: { authorization: `Bearer ${pmToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string }>;
  };

  const returnedIds = new Set(body.data.map((row) => row.id));
  for (const id of inaccessibleActivityIds) {
    assert.equal(
      returnedIds.has(id),
      false,
      `inaccessible activity row ${id} must not be returned`,
    );
  }
});

test("GET /activity returns an empty page when the caller has no scope", async () => {
  const response = await fetch(`${baseUrl}/api/activity`, {
    headers: { authorization: `Bearer ${isolatedToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: unknown[];
    pagination: Record<string, number>;
  };

  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, 0);
  assert.equal(body.pagination.totalItems, 0);
  assert.equal(body.pagination.totalPages, 1);
});

test("GET /users defaults to limit 100 and reports totalItems/totalPages", async () => {
  const response = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: unknown[];
    pagination: Record<string, number>;
  };

  assert.equal(body.pagination.limit, 100);
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.offset, 0);
  assert.equal(body.pagination.total, body.pagination.totalItems);
  assert.equal(
    body.pagination.totalPages,
    Math.max(1, Math.ceil(body.pagination.totalItems / 100)),
  );
  assert.ok(
    body.pagination.totalItems >= testUserIds.length,
    "totalItems should at least include our seeded users",
  );
  assert.ok(body.data.length <= 100, "default limit must be capped at 100");
});

test("GET /users honors the page parameter", async () => {
  const response = await fetch(`${baseUrl}/api/users?limit=2&page=2`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: unknown[];
    pagination: Record<string, number>;
  };

  assert.ok(body.data.length <= 2, "limit must be honored at the SQL layer");
  assert.equal(body.pagination.page, 2);
  assert.equal(body.pagination.limit, 2);
  assert.equal(body.pagination.offset, 2);
  assert.equal(
    body.pagination.totalPages,
    Math.max(1, Math.ceil(body.pagination.totalItems / 2)),
  );
});

test("GET /users honors the offset parameter", async () => {
  const response = await fetch(`${baseUrl}/api/users?limit=2&offset=4`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: unknown[];
    pagination: Record<string, number>;
  };

  assert.ok(body.data.length <= 2);
  assert.equal(body.pagination.offset, 4);
  assert.equal(body.pagination.limit, 2);
  assert.equal(body.pagination.page, 3);
});

test("GET /users rejects passing both page and offset", async () => {
  const response = await fetch(`${baseUrl}/api/users?page=1&offset=0`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 400);
});

test("GET /users limits returned rows in SQL", async () => {
  const response = await fetch(`${baseUrl}/api/users?limit=1`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: unknown[];
    pagination: Record<string, number>;
  };

  assert.equal(body.data.length, 1, "limit=1 must return exactly one row");
  assert.ok(body.pagination.totalItems >= testUserIds.length);
});

test("GET /daily-logs/mine paginates in SQL when many rows exist", async () => {
  const response = await fetch(`${baseUrl}/api/daily-logs/mine?pageSize=1`, {
    headers: { authorization: `Bearer ${crewToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(
    body.data.length,
    1,
    "pageSize=1 must return exactly one row even with many existing logs",
  );
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.pageSize, 1);
  assert.equal(body.pagination.limit, 1);
  assert.equal(body.pagination.totalItems, crewDailyLogIds.length);
  assert.equal(body.pagination.total, crewDailyLogIds.length);
  assert.equal(body.pagination.totalPages, crewDailyLogIds.length);
});

test("GET /daily-logs/mine returns subsequent pages without duplicates", async () => {
  const firstResponse = await fetch(
    `${baseUrl}/api/daily-logs/mine?pageSize=2&page=1`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );
  const firstBody = (await firstResponse.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(firstBody.data.length, 2);
  assert.equal(firstBody.pagination.totalPages, 3);

  const lastResponse = await fetch(
    `${baseUrl}/api/daily-logs/mine?pageSize=2&page=3`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );
  const lastBody = (await lastResponse.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(lastBody.data.length, 1);

  const firstIds = new Set(firstBody.data.map((row) => row.id));
  for (const row of lastBody.data) {
    assert.equal(
      firstIds.has(row.id),
      false,
      "subsequent pages must not repeat earlier rows",
    );
  }
});

test("GET /daily-logs/mine never returns logs created by other users", async () => {
  const response = await fetch(
    `${baseUrl}/api/daily-logs/mine?pageSize=100`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  const returnedIds = new Set(body.data.map((row) => row.id));
  for (const id of crewDailyLogIds) {
    assert.equal(
      returnedIds.has(id),
      false,
      "PM must not see daily logs the crew member created",
    );
  }
});

test("GET /jobs returns the {jobs, pagination} envelope with admin scope", async () => {
  const response = await fetch(`${baseUrl}/api/jobs?pageSize=100`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    jobs: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.ok(Array.isArray(body.jobs));
  assert.equal(typeof body.pagination, "object");
  assert.equal(typeof body.pagination.page, "number");
  assert.equal(typeof body.pagination.pageSize, "number");
  assert.equal(typeof body.pagination.totalItems, "number");
  assert.equal(typeof body.pagination.totalPages, "number");

  const returnedIds = new Set(body.jobs.map((row) => row.id));
  for (const id of testJobIds) {
    assert.equal(
      returnedIds.has(id),
      true,
      `admin should see seeded job ${id}`,
    );
  }
});

test("GET /jobs limits returned rows in SQL via pageSize", async () => {
  const response = await fetch(`${baseUrl}/api/jobs?pageSize=1`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    jobs: unknown[];
    pagination: Record<string, number>;
  };

  assert.equal(body.jobs.length, 1, "pageSize=1 must return exactly one row");
  assert.equal(body.pagination.pageSize, 1);
  assert.equal(body.pagination.page, 1);
  assert.ok(
    body.pagination.totalItems >= testJobIds.length,
    "totalItems should at least include our seeded jobs",
  );
  assert.equal(
    body.pagination.totalPages,
    Math.max(1, Math.ceil(body.pagination.totalItems / 1)),
  );
});

test("GET /jobs paginates without duplicates across pages", async () => {
  const firstPage = await fetch(
    `${baseUrl}/api/jobs?pageSize=2&page=1&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  assert.equal(firstPage.status, 200);
  const firstBody = (await firstPage.json()) as {
    jobs: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(firstBody.jobs.length, 2);
  assert.equal(firstBody.pagination.page, 1);
  assert.equal(firstBody.pagination.pageSize, 2);
  assert.ok(firstBody.pagination.totalItems >= testJobIds.length);

  const secondPage = await fetch(
    `${baseUrl}/api/jobs?pageSize=2&page=2&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  assert.equal(secondPage.status, 200);
  const secondBody = (await secondPage.json()) as {
    jobs: Array<{ id: string }>;
  };

  assert.ok(secondBody.jobs.length > 0);

  const firstIds = new Set(firstBody.jobs.map((row) => row.id));
  for (const row of secondBody.jobs) {
    assert.equal(
      firstIds.has(row.id),
      false,
      "page 2 must not repeat page 1 ids",
    );
  }
});

test("GET /jobs hides jobs the project manager cannot see", async () => {
  const response = await fetch(`${baseUrl}/api/jobs?pageSize=100`, {
    headers: { authorization: `Bearer ${pmToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    jobs: Array<{ id: string }>;
  };

  const returnedIds = new Set(body.jobs.map((row) => row.id));
  assert.equal(
    returnedIds.has(accessibleJobId),
    true,
    "PM should see jobs they manage",
  );
  for (const id of [inaccessibleJobId, ...adminOnlyJobIds]) {
    assert.equal(
      returnedIds.has(id),
      false,
      `PM must not see jobs they do not manage (${id})`,
    );
  }
});

test("GET /jobs returns an empty page when the caller has no scope", async () => {
  const response = await fetch(`${baseUrl}/api/jobs`, {
    headers: { authorization: `Bearer ${isolatedToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    jobs: unknown[];
    pagination: Record<string, number>;
  };

  assert.deepEqual(body.jobs, []);
  assert.equal(body.pagination.totalItems, 0);
  assert.equal(body.pagination.totalPages, 1);
});

test("GET /jobs rejects pageSize above the configured cap", async () => {
  const response = await fetch(`${baseUrl}/api/jobs?pageSize=500`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 400);
});

test("GET /leads returns the {leads, pagination, summary} envelope", async () => {
  const response = await fetch(`${baseUrl}/api/leads?pageSize=100`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    leads: Array<{ id: string }>;
    pagination: Record<string, number>;
    summary: Record<string, string>;
  };

  assert.ok(Array.isArray(body.leads));
  assert.equal(typeof body.pagination, "object");
  assert.equal(typeof body.pagination.page, "number");
  assert.equal(typeof body.pagination.pageSize, "number");
  assert.equal(typeof body.pagination.totalItems, "number");
  assert.equal(typeof body.pagination.totalPages, "number");
  assert.equal(typeof body.summary, "object");

  const returnedIds = new Set(body.leads.map((row) => row.id));
  for (const id of allLeadIds) {
    assert.equal(returnedIds.has(id), true, `admin should see lead ${id}`);
  }
});

test("GET /leads limits returned rows in SQL via pageSize", async () => {
  const response = await fetch(
    `${baseUrl}/api/leads?pageSize=1&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    leads: unknown[];
    pagination: Record<string, number>;
  };

  assert.equal(body.leads.length, 1, "pageSize=1 must return exactly one row");
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.pageSize, 1);
  assert.equal(body.pagination.totalItems, allLeadIds.length);
  assert.equal(body.pagination.totalPages, allLeadIds.length);
});

test("GET /leads paginates without duplicates across pages", async () => {
  const firstResponse = await fetch(
    `${baseUrl}/api/leads?pageSize=2&page=1&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  assert.equal(firstResponse.status, 200);
  const firstBody = (await firstResponse.json()) as {
    leads: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(firstBody.leads.length, 2);
  assert.equal(firstBody.pagination.totalItems, allLeadIds.length);
  assert.equal(
    firstBody.pagination.totalPages,
    Math.ceil(allLeadIds.length / 2),
  );

  const lastResponse = await fetch(
    `${baseUrl}/api/leads?pageSize=2&page=${firstBody.pagination.totalPages}&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  const lastBody = (await lastResponse.json()) as {
    leads: Array<{ id: string }>;
  };

  assert.ok(lastBody.leads.length > 0);

  const firstIds = new Set(firstBody.leads.map((row) => row.id));
  for (const row of lastBody.leads) {
    assert.equal(
      firstIds.has(row.id),
      false,
      "subsequent pages must not repeat earlier rows",
    );
  }
});

test("GET /leads hides leads the project manager cannot see", async () => {
  const response = await fetch(
    `${baseUrl}/api/leads?pageSize=100&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    leads: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  const returnedIds = new Set(body.leads.map((row) => row.id));
  assert.equal(
    returnedIds.has(pmOwnedLeadId),
    true,
    "PM should see leads they created",
  );
  assert.equal(
    returnedIds.has(pmAssignedLeadId),
    true,
    "PM should see leads where they are a salesperson",
  );
  for (const id of otherAdminLeadIds) {
    assert.equal(
      returnedIds.has(id),
      false,
      `PM must not see other admin's lead ${id}`,
    );
  }
  assert.equal(body.pagination.totalItems, 2);
});

test("GET /leads forbids crew members at the route layer", async () => {
  const response = await fetch(`${baseUrl}/api/leads`, {
    headers: { authorization: `Bearer ${crewToken}` },
  });

  assert.equal(response.status, 403);
});

test("GET /leads rejects pageSize above the configured cap", async () => {
  const response = await fetch(`${baseUrl}/api/leads?pageSize=500`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 400);
});

type SearchResult = {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  href: string;
};

type SearchResponse = {
  results: SearchResult[];
  pagination: { page: number; pageSize: number; hasMore: boolean };
};

test("GET /search returns the documented {results, pagination} envelope", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SearchResponse;

  assert.ok(Array.isArray(body.results));
  assert.ok(body.results.length > 0, "search must return seeded matches");
  for (const result of body.results) {
    assert.equal(typeof result.id, "string");
    assert.equal(typeof result.type, "string");
    assert.equal(typeof result.title, "string");
    assert.equal(typeof result.href, "string");
  }

  assert.equal(typeof body.pagination, "object");
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.pageSize, 10);
  assert.equal(typeof body.pagination.hasMore, "boolean");
});

test("GET /search caps results at the configured pageSize", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=2`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SearchResponse;

  assert.ok(
    body.results.length <= 2,
    `pageSize=2 must cap results, got ${body.results.length}`,
  );
  assert.equal(body.pagination.pageSize, 2);
});

test("GET /search rejects pageSize above the documented maximum", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=100`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 400);
});

test("GET /search rejects page numbers above the documented maximum", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&page=21`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 400);
});

test("GET /search lets the caller page past the first 10 results", async () => {
  const firstResponse = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=2&page=1`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(firstResponse.status, 200);
  const firstBody = (await firstResponse.json()) as SearchResponse;
  assert.ok(firstBody.results.length <= 2);
  assert.equal(firstBody.pagination.page, 1);
  assert.equal(firstBody.pagination.pageSize, 2);
  assert.equal(
    firstBody.pagination.hasMore,
    true,
    "seeded data must produce more than one page at pageSize=2",
  );

  const secondResponse = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=2&page=2`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(secondResponse.status, 200);
  const secondBody = (await secondResponse.json()) as SearchResponse;
  assert.equal(secondBody.pagination.page, 2);
  assert.equal(secondBody.pagination.pageSize, 2);
  assert.ok(secondBody.results.length > 0, "second page must include at least one result");

  const firstIds = new Set(firstBody.results.map((result) => result.id));
  for (const result of secondBody.results) {
    assert.equal(
      firstIds.has(result.id),
      false,
      `second page must not repeat first page result ${result.id}`,
    );
  }
});

test("GET /search hides jobs and leads the project manager cannot see", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=25`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SearchResponse;

  const returnedIds = new Set(body.results.map((result) => result.id));

  assert.equal(
    returnedIds.has(accessibleJobId),
    true,
    "PM search must still return jobs the PM can access",
  );
  assert.equal(
    returnedIds.has(pmOwnedLeadId),
    true,
    "PM search must still return leads the PM created",
  );
  assert.equal(
    returnedIds.has(pmAssignedLeadId),
    true,
    "PM search must still return leads where the PM is a salesperson",
  );

  for (const id of [inaccessibleJobId, ...adminOnlyJobIds]) {
    assert.equal(
      returnedIds.has(id),
      false,
      `PM search must not return inaccessible job ${id}`,
    );
  }
  for (const id of otherAdminLeadIds) {
    assert.equal(
      returnedIds.has(id),
      false,
      `PM search must not return inaccessible lead ${id}`,
    );
  }
});

test("GET /search returns no results when the caller has no scope", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${isolatedToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SearchResponse;

  assert.deepEqual(body.results, []);
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.hasMore, false);
});

test("GET /search returns clients with the new client result type for admins", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=25`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SearchResponse;

  const clientResults = body.results.filter((result) => result.type === "client");
  const clientIds = new Set(clientResults.map((result) => result.id));

  for (const id of allClientIds) {
    assert.equal(
      clientIds.has(id),
      true,
      `admin search must include seeded client ${id}`,
    );
  }

  for (const result of clientResults) {
    assert.equal(typeof result.title, "string");
    assert.ok(result.title.length > 0, "client results must have a title");
    assert.equal(
      result.href,
      `/clients?client=${result.id}`,
      "client results must link to the matching client detail",
    );
  }
});

test("GET /search hides clients the project manager cannot see", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=25`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SearchResponse;

  const clientResults = body.results.filter((result) => result.type === "client");
  const clientIds = new Set(clientResults.map((result) => result.id));

  for (const id of pmAccessibleClientIds) {
    assert.equal(
      clientIds.has(id),
      true,
      `PM search must return client ${id} the PM can access`,
    );
  }

  for (const id of adminOnlyClientIds) {
    assert.equal(
      clientIds.has(id),
      false,
      `PM search must not return admin-only client ${id}`,
    );
  }
});

test("GET /search returns no client results for crew members", async () => {
  const response = await fetch(
    `${baseUrl}/api/search?q=ZZZ%20Pagination&pageSize=25`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as SearchResponse;

  const clientResults = body.results.filter((result) => result.type === "client");
  assert.equal(
    clientResults.length,
    0,
    "crew members must not see client results in global search",
  );
});


test("GET /clients returns the {clients, pagination} envelope with admin scope", async () => {
  const response = await fetch(
    `${baseUrl}/api/clients?pageSize=100&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    clients: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.ok(Array.isArray(body.clients));
  assert.equal(typeof body.pagination, "object");
  assert.equal(typeof body.pagination.page, "number");
  assert.equal(typeof body.pagination.pageSize, "number");
  assert.equal(typeof body.pagination.totalItems, "number");
  assert.equal(typeof body.pagination.totalPages, "number");
  assert.equal(body.pagination.totalItems, allClientIds.length);
  assert.equal(
    body.pagination.totalPages,
    Math.max(1, Math.ceil(allClientIds.length / 100)),
  );

  const returnedIds = new Set(body.clients.map((row) => row.id));
  for (const id of allClientIds) {
    assert.equal(
      returnedIds.has(id),
      true,
      `admin should see seeded client ${id}`,
    );
  }
});

test("GET /clients limits returned rows in SQL via pageSize", async () => {
  const response = await fetch(
    `${baseUrl}/api/clients?pageSize=1&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    clients: unknown[];
    pagination: Record<string, number>;
  };

  assert.equal(body.clients.length, 1, "pageSize=1 must return exactly one row");
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.pageSize, 1);
  assert.equal(body.pagination.totalItems, allClientIds.length);
  assert.equal(body.pagination.totalPages, allClientIds.length);
});

test("GET /clients paginates without duplicates across pages", async () => {
  const firstResponse = await fetch(
    `${baseUrl}/api/clients?pageSize=2&page=1&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  assert.equal(firstResponse.status, 200);
  const firstBody = (await firstResponse.json()) as {
    clients: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(firstBody.clients.length, 2);
  assert.equal(firstBody.pagination.page, 1);
  assert.equal(firstBody.pagination.pageSize, 2);
  assert.equal(firstBody.pagination.totalItems, allClientIds.length);
  assert.equal(
    firstBody.pagination.totalPages,
    Math.ceil(allClientIds.length / 2),
  );

  const lastResponse = await fetch(
    `${baseUrl}/api/clients?pageSize=2&page=${firstBody.pagination.totalPages}&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  assert.equal(lastResponse.status, 200);
  const lastBody = (await lastResponse.json()) as {
    clients: Array<{ id: string }>;
  };

  assert.ok(lastBody.clients.length > 0);

  const firstIds = new Set(firstBody.clients.map((row) => row.id));
  for (const row of lastBody.clients) {
    assert.equal(
      firstIds.has(row.id),
      false,
      "subsequent pages must not repeat earlier rows",
    );
  }
});

test("GET /clients hides clients the project manager cannot see", async () => {
  const response = await fetch(
    `${baseUrl}/api/clients?pageSize=100&search=ZZZ%20Pagination`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    clients: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  const returnedIds = new Set(body.clients.map((row) => row.id));
  assert.equal(
    returnedIds.has(pmCreatedClientId),
    true,
    "PM should see clients they created",
  );
  assert.equal(
    returnedIds.has(pmRelatedClientId),
    true,
    "PM should see clients linked to jobs they manage",
  );
  for (const id of adminOnlyClientIds) {
    assert.equal(
      returnedIds.has(id),
      false,
      `PM must not see admin-only client ${id}`,
    );
  }
  assert.equal(body.pagination.totalItems, pmAccessibleClientIds.length);
});

test("GET /clients forbids crew members at the route layer", async () => {
  const response = await fetch(`${baseUrl}/api/clients`, {
    headers: { authorization: `Bearer ${crewToken}` },
  });

  assert.equal(response.status, 403);
});

test("GET /clients rejects pageSize above the configured cap", async () => {
  const response = await fetch(`${baseUrl}/api/clients?pageSize=500`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });

  assert.equal(response.status, 400);
});

// Expected visibility per role for the seven seeded schedule items in
// `accessibleJobId`, derived from `buildScheduleListVisibilityFilter`.
//
//                                  admin  PM   crew
//   Visible To All                    Y    Y    Y
//   Hidden From Crew (installers=F)   Y    Y    .   (PM is creator)
//   Hidden From PM (office/est.=F)    Y    .    Y   (other admin created)
//   Assigned To Crew (installers=F)   Y    Y    Y   (crew is assignee; PM via roleVisibility)
//   Crew Created Hidden (all flags F) Y    .    Y   (crew is creator)
//   PM Personal Todo                  .    Y    .   (creator-only)
//   Admin Personal Todo               Y    .    .   (creator-only)
const adminVisibleScheduleIds = [
  scheduleVisibleAllId,
  scheduleHiddenFromCrewId,
  scheduleHiddenFromPmId,
  scheduleAssignedCrewId,
  scheduleCrewCreatedHiddenId,
  scheduleAdminPersonalTodoId,
];
const pmVisibleScheduleIds = [
  scheduleVisibleAllId,
  scheduleHiddenFromCrewId,
  scheduleAssignedCrewId,
  schedulePmPersonalTodoId,
];
const crewVisibleScheduleIds = [
  scheduleVisibleAllId,
  scheduleHiddenFromPmId,
  scheduleAssignedCrewId,
  scheduleCrewCreatedHiddenId,
];

test("GET /jobs/:jobId/schedule returns the {data, pagination} envelope for admins", async () => {
  const response = await fetch(
    `${baseUrl}/api/jobs/${accessibleJobId}/schedule?limit=100`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.ok(Array.isArray(body.data));
  assert.equal(typeof body.pagination, "object");
  assert.equal(typeof body.pagination.page, "number");
  assert.equal(typeof body.pagination.limit, "number");
  assert.equal(typeof body.pagination.totalItems, "number");
  assert.equal(typeof body.pagination.totalPages, "number");

  assert.equal(body.pagination.totalItems, adminVisibleScheduleIds.length);

  const returnedIds = new Set(body.data.map((row) => row.id));
  for (const id of adminVisibleScheduleIds) {
    assert.equal(
      returnedIds.has(id),
      true,
      `admin should see schedule item ${id}`,
    );
  }
  assert.equal(
    returnedIds.has(schedulePmPersonalTodoId),
    false,
    "admin must not see another user's personal to-do",
  );
});

test("GET /jobs/:jobId/schedule scopes totalItems to what a project manager can see", async () => {
  const response = await fetch(
    `${baseUrl}/api/jobs/${accessibleJobId}/schedule?limit=100`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(body.pagination.totalItems, pmVisibleScheduleIds.length);

  const returnedIds = new Set(body.data.map((row) => row.id));
  for (const id of pmVisibleScheduleIds) {
    assert.equal(
      returnedIds.has(id),
      true,
      `PM should see schedule item ${id}`,
    );
  }
  for (const id of [
    scheduleHiddenFromPmId,
    scheduleCrewCreatedHiddenId,
    scheduleAdminPersonalTodoId,
  ]) {
    assert.equal(
      returnedIds.has(id),
      false,
      `PM must not see schedule item ${id}`,
    );
  }
});

test("GET /jobs/:jobId/schedule scopes totalItems to what a crew member can see", async () => {
  const response = await fetch(
    `${baseUrl}/api/jobs/${accessibleJobId}/schedule?limit=100`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(body.pagination.totalItems, crewVisibleScheduleIds.length);

  const returnedIds = new Set(body.data.map((row) => row.id));
  for (const id of crewVisibleScheduleIds) {
    assert.equal(
      returnedIds.has(id),
      true,
      `crew member should see schedule item ${id}`,
    );
  }
  for (const id of [
    scheduleHiddenFromCrewId,
    schedulePmPersonalTodoId,
    scheduleAdminPersonalTodoId,
  ]) {
    assert.equal(
      returnedIds.has(id),
      false,
      `crew member must not see schedule item ${id}`,
    );
  }
});

test("GET /jobs/:jobId/schedule paginates the admin-visible rows in stable startDate order", async () => {
  const limit = 2;
  const expectedTotalPages = Math.ceil(adminVisibleScheduleIds.length / limit);
  const collected: string[] = [];

  for (let page = 1; page <= expectedTotalPages; page += 1) {
    const response = await fetch(
      `${baseUrl}/api/jobs/${accessibleJobId}/schedule?limit=${limit}&page=${page}`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: Array<{ id: string }>;
      pagination: Record<string, number>;
    };

    assert.equal(body.pagination.page, page);
    assert.equal(body.pagination.limit, limit);
    assert.equal(body.pagination.totalItems, adminVisibleScheduleIds.length);
    assert.equal(body.pagination.totalPages, expectedTotalPages);

    const isLastPage = page === expectedTotalPages;
    const expectedSize = isLastPage
      ? adminVisibleScheduleIds.length - limit * (page - 1)
      : limit;
    assert.equal(
      body.data.length,
      expectedSize,
      `page ${page} must contain ${expectedSize} rows`,
    );

    for (const row of body.data) {
      collected.push(row.id);
    }
  }

  assert.deepEqual(
    collected,
    adminVisibleScheduleIds,
    "paginated admin rows must be returned in stable startDate order without duplicates",
  );
});

test("GET /jobs/:jobId/schedule returns crew-visible rows in stable order across pages", async () => {
  const firstPage = await fetch(
    `${baseUrl}/api/jobs/${accessibleJobId}/schedule?limit=2&page=1`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );
  assert.equal(firstPage.status, 200);
  const firstBody = (await firstPage.json()) as {
    data: Array<{ id: string }>;
    pagination: Record<string, number>;
  };

  assert.equal(firstBody.data.length, 2);
  assert.equal(firstBody.pagination.totalItems, crewVisibleScheduleIds.length);
  assert.equal(
    firstBody.pagination.totalPages,
    Math.ceil(crewVisibleScheduleIds.length / 2),
  );
  assert.deepEqual(
    firstBody.data.map((row) => row.id),
    crewVisibleScheduleIds.slice(0, 2),
    "page 1 must return the first two crew-visible rows in startDate order",
  );

  const secondPage = await fetch(
    `${baseUrl}/api/jobs/${accessibleJobId}/schedule?limit=2&page=2`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );
  assert.equal(secondPage.status, 200);
  const secondBody = (await secondPage.json()) as {
    data: Array<{ id: string }>;
  };

  assert.deepEqual(
    secondBody.data.map((row) => row.id),
    crewVisibleScheduleIds.slice(2, 4),
    "page 2 must return the next crew-visible rows without overlapping page 1",
  );

  const firstIds = new Set(firstBody.data.map((row) => row.id));
  for (const row of secondBody.data) {
    assert.equal(
      firstIds.has(row.id),
      false,
      "page 2 must not repeat page 1 rows",
    );
  }
});

test("GET /jobs/:jobId/schedule rejects requests for jobs the caller cannot see", async () => {
  const response = await fetch(
    `${baseUrl}/api/jobs/${inaccessibleJobId}/schedule`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 403);
});

test("POST /clients rejects crew members at the route guard", async () => {
  const response = await fetch(`${baseUrl}/api/clients`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${crewToken}`,
    },
    body: JSON.stringify({ companyName: "ZZZ Pagination Crew Cannot Create" }),
  });

  assert.equal(response.status, 403);
});

test("POST /clients lets project managers create clients", async () => {
  const response = await fetch(`${baseUrl}/api/clients`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      authorization: `Bearer ${pmToken}`,
    },
    body: JSON.stringify({
      companyName: "ZZZ Pagination PM Created Via API",
    }),
  });

  assert.equal(response.status, 201);
  const body = (await response.json()) as { client: { id: string } };
  assert.equal(typeof body.client.id, "string");

  // Track for cleanup so the after() hook can remove it.
  allClientIds.push(body.client.id);
});

test("PUT /clients/:id rejects crew members at the route guard", async () => {
  const response = await fetch(`${baseUrl}/api/clients/${pmCreatedClientId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      authorization: `Bearer ${crewToken}`,
    },
    body: JSON.stringify({ companyName: "ZZZ Pagination Crew Cannot Edit" }),
  });

  assert.equal(response.status, 403);
});

test("PUT /clients/:id lets project managers update clients they created", async () => {
  const response = await fetch(`${baseUrl}/api/clients/${pmCreatedClientId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      authorization: `Bearer ${pmToken}`,
    },
    body: JSON.stringify({
      companyName: "ZZZ Pagination PM Created Client (Edited)",
    }),
  });

  assert.equal(response.status, 200);
});

test("PUT /clients/:id lets project managers update clients linked to jobs they manage", async () => {
  const response = await fetch(`${baseUrl}/api/clients/${pmRelatedClientId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      authorization: `Bearer ${pmToken}`,
    },
    body: JSON.stringify({
      companyName: "ZZZ Pagination PM Related Client (Edited)",
    }),
  });

  assert.equal(response.status, 200);
});

test("PUT /clients/:id forbids project managers from editing clients outside their scope", async () => {
  const response = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[0]}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
      body: JSON.stringify({ companyName: "ZZZ Pagination PM Should Not Edit" }),
    },
  );

  assert.equal(response.status, 403);
});

test("DELETE /clients/:id rejects crew members at the route guard", async () => {
  const response = await fetch(`${baseUrl}/api/clients/${pmCreatedClientId}`, {
    method: "DELETE",
    headers: {
      "x-requested-with": "XMLHttpRequest",
      authorization: `Bearer ${crewToken}`,
    },
  });

  assert.equal(response.status, 403);
});

test("DELETE /clients/:id forbids project managers, even on accessible clients", async () => {
  const ownClientResponse = await fetch(
    `${baseUrl}/api/clients/${pmCreatedClientId}`,
    {
      method: "DELETE",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
    },
  );
  assert.equal(ownClientResponse.status, 403);

  const adminClientResponse = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[0]}`,
    {
      method: "DELETE",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
    },
  );
  assert.equal(adminClientResponse.status, 403);
});

test("DELETE /clients/:id lets admins delete clients", async () => {
  const targetId = adminOnlyClientIds[adminOnlyClientIds.length - 1];
  const response = await fetch(`${baseUrl}/api/clients/${targetId}`, {
    method: "DELETE",
    headers: {
      "x-requested-with": "XMLHttpRequest",
      authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(response.status, 200);
});

test("POST /clients/:id/contacts rejects crew members at the route guard", async () => {
  const response = await fetch(
    `${baseUrl}/api/clients/${pmCreatedClientId}/contacts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${crewToken}`,
      },
      body: JSON.stringify({ firstName: "Crew Cannot Create Contact" }),
    },
  );

  assert.equal(response.status, 403);
});

test("POST /clients/:id/contacts lets project managers add contacts on accessible clients", async () => {
  const response = await fetch(
    `${baseUrl}/api/clients/${pmCreatedClientId}/contacts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
      body: JSON.stringify({ firstName: "ZZZ Pagination PM Contact" }),
    },
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as { contact: { id: string } };
  assert.equal(typeof body.contact.id, "string");
});

test("POST /clients/:id/contacts forbids project managers on inaccessible clients", async () => {
  const response = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[0]}/contacts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
      body: JSON.stringify({ firstName: "PM Should Not Create Contact" }),
    },
  );

  assert.equal(response.status, 403);
});

test("PUT /clients/:id/contacts/:contactId enforces client scope", async () => {
  const seedAdminContactResponse = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[0]}/contacts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ firstName: "ZZZ Pagination Admin Only Contact" }),
    },
  );
  assert.equal(seedAdminContactResponse.status, 201);
  const adminContactId = (
    (await seedAdminContactResponse.json()) as { contact: { id: string } }
  ).contact.id;

  const crewResponse = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[0]}/contacts/${adminContactId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${crewToken}`,
      },
      body: JSON.stringify({ firstName: "Crew Cannot Edit" }),
    },
  );
  assert.equal(crewResponse.status, 403);

  const pmForbiddenResponse = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[0]}/contacts/${adminContactId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
      body: JSON.stringify({ firstName: "PM Cannot Edit Outside Scope" }),
    },
  );
  assert.equal(pmForbiddenResponse.status, 403);

  const seedPmContactResponse = await fetch(
    `${baseUrl}/api/clients/${pmRelatedClientId}/contacts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ firstName: "ZZZ Pagination PM Editable Contact" }),
    },
  );
  assert.equal(seedPmContactResponse.status, 201);
  const pmEditableContactId = (
    (await seedPmContactResponse.json()) as { contact: { id: string } }
  ).contact.id;

  const pmAllowedResponse = await fetch(
    `${baseUrl}/api/clients/${pmRelatedClientId}/contacts/${pmEditableContactId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
      body: JSON.stringify({ firstName: "PM Edited Contact" }),
    },
  );
  assert.equal(pmAllowedResponse.status, 200);
});

test("DELETE /clients/:id/contacts/:contactId enforces client scope", async () => {
  const seedAdminContactResponse = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[1]}/contacts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ firstName: "ZZZ Pagination Admin Delete Target" }),
    },
  );
  assert.equal(seedAdminContactResponse.status, 201);
  const adminContactId = (
    (await seedAdminContactResponse.json()) as { contact: { id: string } }
  ).contact.id;

  const crewResponse = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[1]}/contacts/${adminContactId}`,
    {
      method: "DELETE",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${crewToken}`,
      },
    },
  );
  assert.equal(crewResponse.status, 403);

  const pmForbiddenResponse = await fetch(
    `${baseUrl}/api/clients/${adminOnlyClientIds[1]}/contacts/${adminContactId}`,
    {
      method: "DELETE",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
    },
  );
  assert.equal(pmForbiddenResponse.status, 403);

  const seedPmContactResponse = await fetch(
    `${baseUrl}/api/clients/${pmCreatedClientId}/contacts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ firstName: "ZZZ Pagination PM Delete Target" }),
    },
  );
  assert.equal(seedPmContactResponse.status, 201);
  const pmDeletableContactId = (
    (await seedPmContactResponse.json()) as { contact: { id: string } }
  ).contact.id;

  const pmAllowedResponse = await fetch(
    `${baseUrl}/api/clients/${pmCreatedClientId}/contacts/${pmDeletableContactId}`,
    {
      method: "DELETE",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        authorization: `Bearer ${pmToken}`,
      },
    },
  );
  assert.equal(pmAllowedResponse.status, 200);
});

// Single schedule item endpoints (`GET/PUT/DELETE /schedule-items/:id`) defer
// to `assertCanViewScheduleItem` / `assertCanManageScheduleItem` rather than the
// SQL-side filter exercised above. The cases below cover the same visibility
// branches against the per-item helper so a future change to either path is
// caught by automated tests.

test("GET /schedule-items/:id allows admins to read a regular schedule item", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleVisibleAllId}`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { item: { id: string } };
  assert.equal(body.item.id, scheduleVisibleAllId);
});

test("GET /schedule-items/:id allows the project manager (creator) to read it", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleVisibleAllId}`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { item: { id: string } };
  assert.equal(body.item.id, scheduleVisibleAllId);
});

test("GET /schedule-items/:id allows a crew member when role visibility flags allow it", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleVisibleAllId}`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { item: { id: string } };
  assert.equal(body.item.id, scheduleVisibleAllId);
});

test("GET /schedule-items/:id allows the crew creator even when every visibility flag is off", async () => {
  // scheduleCrewCreatedHiddenId has all role-visibility flags set to false but
  // the crew member is the creator, so they must still be able to read it.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleCrewCreatedHiddenId}`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { item: { id: string } };
  assert.equal(body.item.id, scheduleCrewCreatedHiddenId);
});

test("GET /schedule-items/:id allows an assigned crew member even when installers visibility is off", async () => {
  // scheduleAssignedCrewId has visibleToInstallers=false but the crew member
  // is an explicit assignee, which must override the role flag.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleAssignedCrewId}`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { item: { id: string } };
  assert.equal(body.item.id, scheduleAssignedCrewId);
});

test("GET /schedule-items/:id returns 403 for a crew member blocked by visibleToInstallers", async () => {
  // scheduleHiddenFromCrewId has visibleToInstallers=false. The crew member
  // is neither creator nor assignee, so the role visibility flag must reject.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleHiddenFromCrewId}`,
    { headers: { authorization: `Bearer ${crewToken}` } },
  );

  assert.equal(response.status, 403);
});

test("GET /schedule-items/:id returns 403 for a project manager blocked by office/estimator visibility flags", async () => {
  // scheduleHiddenFromPmId has both visibleToOfficeStaff and
  // visibleToEstimators set to false. The PM is neither creator nor assignee,
  // so the role visibility flags must reject.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleHiddenFromPmId}`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 403);
});

test("GET /schedule-items/:id returns 403 for an admin trying to read another user's personal to-do", async () => {
  // The personal-to-do guard must block even an admin from reading a personal
  // to-do they did not create.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${schedulePmPersonalTodoId}`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );

  assert.equal(response.status, 403);
});

test("GET /schedule-items/:id returns 403 for a project manager trying to read an admin's personal to-do", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleAdminPersonalTodoId}`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );

  assert.equal(response.status, 403);
});

test("GET /schedule-items/:id allows the personal to-do creator to read their own item", async () => {
  // The PM's own personal to-do must remain readable to them.
  const pmResponse = await fetch(
    `${baseUrl}/api/schedule-items/${schedulePmPersonalTodoId}`,
    { headers: { authorization: `Bearer ${pmToken}` } },
  );
  assert.equal(pmResponse.status, 200);
  const pmBody = (await pmResponse.json()) as { item: { id: string } };
  assert.equal(pmBody.item.id, schedulePmPersonalTodoId);

  // The admin's own personal to-do must remain readable to them.
  const adminResponse = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleAdminPersonalTodoId}`,
    { headers: { authorization: `Bearer ${adminToken}` } },
  );
  assert.equal(adminResponse.status, 200);
  const adminBody = (await adminResponse.json()) as { item: { id: string } };
  assert.equal(adminBody.item.id, scheduleAdminPersonalTodoId);
});

function jsonHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

function xhrHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "x-requested-with": "XMLHttpRequest",
  };
}

test("PUT /schedule-items/:id returns 403 for an admin modifying another user's personal to-do", async () => {
  // The personal-to-do guard must block modification by admins too. Middleware
  // rejects before the body is parsed, so an empty body is fine.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${schedulePmPersonalTodoId}`,
    {
      method: "PUT",
      headers: jsonHeaders(adminToken),
      body: JSON.stringify({}),
    },
  );

  assert.equal(response.status, 403);
});

test("PUT /schedule-items/:id returns 403 for a project manager modifying an admin's personal to-do", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleAdminPersonalTodoId}`,
    {
      method: "PUT",
      headers: jsonHeaders(pmToken),
      body: JSON.stringify({}),
    },
  );

  assert.equal(response.status, 403);
});

test("PUT /schedule-items/:id returns 403 for a project manager blocked by role visibility flags", async () => {
  // scheduleHiddenFromPmId is hidden from the PM by the visibility flags, so
  // attempting to modify it must 403 before any DB write.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleHiddenFromPmId}`,
    {
      method: "PUT",
      headers: jsonHeaders(pmToken),
      body: JSON.stringify({}),
    },
  );

  assert.equal(response.status, 403);
});

test("PUT /schedule-items/:id returns 403 for a crew member who can view but not manage", async () => {
  // Crew members can view scheduleVisibleAllId but `assertCanManageScheduleItem`
  // restricts modification to admins and PMs that manage the job.
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleVisibleAllId}`,
    {
      method: "PUT",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({}),
    },
  );

  assert.equal(response.status, 403);
});

test("DELETE /schedule-items/:id returns 403 for an admin trying to delete another user's personal to-do", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${schedulePmPersonalTodoId}`,
    {
      method: "DELETE",
      headers: xhrHeaders(adminToken),
    },
  );

  assert.equal(response.status, 403);
});

test("DELETE /schedule-items/:id returns 403 for a project manager trying to delete an admin's personal to-do", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleAdminPersonalTodoId}`,
    {
      method: "DELETE",
      headers: xhrHeaders(pmToken),
    },
  );

  assert.equal(response.status, 403);
});

test("DELETE /schedule-items/:id returns 403 for a crew member who can view but not manage", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleVisibleAllId}`,
    {
      method: "DELETE",
      headers: xhrHeaders(crewToken),
    },
  );

  assert.equal(response.status, 403);
});

test("POST /schedule-items/:id/notes returns 403 for an admin posting to another user's personal to-do", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${schedulePmPersonalTodoId}/notes`,
    {
      method: "POST",
      headers: jsonHeaders(adminToken),
      body: JSON.stringify({ note: "should not be allowed" }),
    },
  );

  assert.equal(response.status, 403);
});

test("POST /schedule-items/:id/notes returns 403 for a project manager posting to an admin's personal to-do", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleAdminPersonalTodoId}/notes`,
    {
      method: "POST",
      headers: jsonHeaders(pmToken),
      body: JSON.stringify({ note: "should not be allowed" }),
    },
  );

  assert.equal(response.status, 403);
});

test("POST /schedule-items/:id/todos returns 403 for a crew member blocked by visibleToInstallers", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleHiddenFromCrewId}/todos`,
    {
      method: "POST",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({ title: "should not be allowed" }),
    },
  );

  assert.equal(response.status, 403);
});

test("POST /schedule-items/:id/notes allows the project manager (creator) to add a collaborative note", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleVisibleAllId}/notes`,
    {
      method: "POST",
      headers: jsonHeaders(pmToken),
      body: JSON.stringify({ note: "PM collaborative note" }),
    },
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as { note: { id: string; note: string } };
  assert.equal(body.note.note, "PM collaborative note");
  assert.ok(body.note.id);
});

test("POST /schedule-items/:id/todos allows an assigned crew member to add a collaborative to-do even when installers visibility is off", async () => {
  const response = await fetch(
    `${baseUrl}/api/schedule-items/${scheduleAssignedCrewId}/todos`,
    {
      method: "POST",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({ title: "Crew assignee follow-up" }),
    },
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    todo: { id: string; title: string };
  };
  assert.equal(body.todo.title, "Crew assignee follow-up");
  assert.ok(body.todo.id);
});
