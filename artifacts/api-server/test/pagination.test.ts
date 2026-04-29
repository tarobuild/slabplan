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

const testUserIds = [
  adminUserId,
  pmUserId,
  crewUserId,
  otherAdminId,
  isolatedUserId,
];
const testJobIds = [accessibleJobId, inaccessibleJobId];
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
  const { users, jobs, activityLog, dailyLogs } = await import(
    "@workspace/db/schema"
  );

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
  ]);

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
  const { activityLog, dailyLogs, jobAssignees, jobs, users } = await import(
    "@workspace/db/schema"
  );
  const { inArray } = await import("drizzle-orm");

  try {
    await db
      .delete(activityLog)
      .where(inArray(activityLog.id, testActivityIds));
    await db.delete(dailyLogs).where(inArray(dailyLogs.id, crewDailyLogIds));
    await db.delete(jobAssignees).where(inArray(jobAssignees.jobId, testJobIds));
    await db.delete(jobs).where(inArray(jobs.id, testJobIds));
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
