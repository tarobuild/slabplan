// Integration tests for task #162: GET /jobs/:jobId/schedule is a true
// read endpoint, write paths persist the cascade in the same transaction,
// and the periodic sweeper applies auto-complete-overdue.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Pool } from "pg";

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;

const adminUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@schedule-cascade-test.local`;

// One job per scenario; ON DELETE CASCADE clears related rows in after().
const readOnlyJobId = crypto.randomUUID();
const writeCascadeJobId = crypto.randomUUID();
const sweeperJobId = crypto.randomUUID();
const sweeperJobDisabledId = crypto.randomUUID();
const concurrentJobId = crypto.randomUUID();
const allJobIds = [
  readOnlyJobId,
  writeCascadeJobId,
  sweeperJobId,
  sweeperJobDisabledId,
  concurrentJobId,
];

const WRITE_SQL = /^\s*(update|insert|delete)\b/i;

// Wrap pool.query to record any UPDATE/INSERT/DELETE statements issued
// while installed. Returns the recorded list and a restore function.
function installWriteInterceptor(pool: Pool) {
  const writes: string[] = [];
  const original = pool.query.bind(pool);
  pool.query = ((...args: Parameters<Pool["query"]>) => {
    const arg = args[0];
    const text = typeof arg === "string" ? arg : (arg as { text?: string }).text ?? "";
    if (WRITE_SQL.test(text)) {
      writes.push(text.split("\n")[0]!.slice(0, 200));
    }
    return original(...args);
  }) as Pool["query"];
  return {
    writes,
    restore: () => {
      pool.query = original;
    },
  };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // Force the shared DB client to use DATABASE_URL (mirrors api-integration).
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.CORS_ALLOWED_ORIGINS ??= "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN ??= "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { users, jobs } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Schedule Cascade Admin",
    role: "admin",
  });

  await db.insert(jobs).values(
    allJobIds.map((id, i) => ({
      id,
      title: `ZZZ Schedule Cascade Job ${i} ${id}`,
      createdBy: adminUserId,
      projectManagerId: adminUserId,
    })),
  );

  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Schedule Cascade Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { jobs, users, activityLog } = await import("@workspace/db/schema");
  const { inArray, eq } = await import("drizzle-orm");

  try {
    await db.delete(jobs).where(inArray(jobs.id, allJobIds));
    // activity_log doesn't cascade from users, so clear it before the
    // admin row goes.
    await db.delete(activityLog).where(eq(activityLog.userId, adminUserId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

function authedGet(path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${adminAccessJwt}` },
  });
}

function authedJson(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminAccessJwt}`,
      "content-type": "application/json",
      // CSRF middleware requires this header on state-changing requests.
      "x-requested-with": "XMLHttpRequest",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("GET /jobs/:jobId/schedule does NOT issue any UPDATE/INSERT/DELETE", async () => {
  const { db, pool } = await import("@workspace/db");
  const { scheduleItems } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  // Persist an endDate the cascade would want to fix (workDays=5 from
  // Mon 2025-01-06 should be Fri 2025-01-10, not 2025-01-15).
  const itemId = crypto.randomUUID();
  await db.insert(scheduleItems).values({
    id: itemId,
    jobId: readOnlyJobId,
    title: "ZZZ no-write read item",
    startDate: "2025-01-06",
    workDays: 5,
    endDate: "2025-01-15",
    createdBy: adminUserId,
  });

  const interceptor = installWriteInterceptor(pool);
  let body: { data: Array<{ id: string; endDate: string; startDate: string }> };
  try {
    const res = await authedGet(`/api/jobs/${readOnlyJobId}/schedule`);
    assert.equal(res.status, 200, `GET schedule must return 200, got ${res.status}`);
    body = (await res.json()) as {
      data: Array<{ id: string; endDate: string; startDate: string }>;
    };
  } finally {
    interceptor.restore();
  }

  assert.deepEqual(
    interceptor.writes,
    [],
    `GET must not issue any UPDATE/INSERT/DELETE; observed: ${JSON.stringify(interceptor.writes, null, 2)}`,
  );

  // Response reflects the cascaded endDate (in-memory override).
  const returned = body.data.find((i) => i.id === itemId);
  assert.ok(returned, "seeded item must appear in the response");
  assert.equal(returned!.endDate, "2025-01-10", "GET must return the cascaded endDate");
  assert.equal(returned!.startDate, "2025-01-06");

  // Persisted value stays wrong — confirms no write-back.
  const [persisted] = await db
    .select({ endDate: scheduleItems.endDate })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, itemId));
  assert.equal(
    persisted!.endDate,
    "2025-01-15",
    "GET must NOT have rewritten the persisted endDate",
  );
});

test("concurrent GET /jobs/:jobId/schedule requests do not race or write", async () => {
  const { db, pool } = await import("@workspace/db");
  const { scheduleItems, scheduleItemPredecessors } = await import("@workspace/db/schema");

  // Seed a small chain so each GET runs the cascade on multiple rows.
  const itemAId = crypto.randomUUID();
  const itemBId = crypto.randomUUID();
  await db.insert(scheduleItems).values([
    {
      id: itemAId,
      jobId: concurrentJobId,
      title: "ZZZ concurrent A",
      startDate: "2025-04-07",
      workDays: 5,
      endDate: "2025-04-11",
      createdBy: adminUserId,
    },
    {
      id: itemBId,
      jobId: concurrentJobId,
      title: "ZZZ concurrent B",
      startDate: "2025-04-07",
      workDays: 3,
      endDate: "2025-04-09",
      createdBy: adminUserId,
    },
  ]);
  await db.insert(scheduleItemPredecessors).values({
    scheduleItemId: itemBId,
    predecessorId: itemAId,
    dependencyType: "finish_to_start",
    lagDays: 0,
  });

  const interceptor = installWriteInterceptor(pool);
  let bodies: Array<{ data: Array<{ id: string; startDate: string; endDate: string }> }>;
  try {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => authedGet(`/api/jobs/${concurrentJobId}/schedule`)),
    );
    for (const res of responses) {
      assert.equal(res.status, 200, `concurrent GET must return 200, got ${res.status}`);
    }
    bodies = await Promise.all(responses.map((r) => r.json() as Promise<typeof bodies[number]>));
  } finally {
    interceptor.restore();
  }

  assert.deepEqual(
    interceptor.writes,
    [],
    `concurrent GETs must not issue any UPDATE/INSERT/DELETE; observed: ${JSON.stringify(interceptor.writes, null, 2)}`,
  );

  // Every response must agree on the cascaded values — no race produced
  // a divergent view. B is FS-after-A so B.startDate = workday after
  // A.endDate (Mon 2025-04-14), and B.endDate = Wed 2025-04-16.
  for (const body of bodies) {
    const a = body.data.find((i) => i.id === itemAId);
    const b = body.data.find((i) => i.id === itemBId);
    assert.ok(a && b, "both items must appear in every response");
    assert.equal(a!.startDate, "2025-04-07");
    assert.equal(a!.endDate, "2025-04-11");
    assert.equal(b!.startDate, "2025-04-14", "B must be cascaded after A in every response");
    assert.equal(b!.endDate, "2025-04-16");
  }
});

test("GET pagination orders by cascaded startDate, not stale persisted startDate", async () => {
  // Regression: when persisted start_date lags the cascade, ordering by
  // start_date produces a sequence that disagrees with the response's own
  // startDate fields, so cursor walks skip or duplicate rows. The handler
  // must order by the cascaded (startDate, id) instead.
  const { db } = await import("@workspace/db");
  const { scheduleItems, scheduleItemPredecessors, jobs } = await import("@workspace/db/schema");
  const { eq, asc } = await import("drizzle-orm");

  const orderingJobId = crypto.randomUUID();
  await db.insert(jobs).values({
    id: orderingJobId,
    title: `ZZZ Schedule Cascade Ordering Job ${orderingJobId}`,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });
  allJobIds.push(orderingJobId);

  // C is FS-after-B is FS-after-A, but C's persisted startDate is set
  // BEFORE B's so persisted ORDER BY would produce A, C, B.
  const itemAId = crypto.randomUUID();
  const itemBId = crypto.randomUUID();
  const itemCId = crypto.randomUUID();

  await db.insert(scheduleItems).values([
    {
      id: itemAId,
      jobId: orderingJobId,
      title: "ZZZ ordering A",
      startDate: "2025-03-03",
      workDays: 5,
      endDate: "2025-03-07",
      createdBy: adminUserId,
    },
    {
      id: itemBId,
      jobId: orderingJobId,
      title: "ZZZ ordering B",
      // Stale persisted dates; cascade pushes these forward.
      startDate: "2025-03-04",
      workDays: 3,
      endDate: "2025-03-06",
      createdBy: adminUserId,
    },
    {
      id: itemCId,
      jobId: orderingJobId,
      title: "ZZZ ordering C",
      // Persisted startDate sits between A and B even though cascade
      // order is C after B.
      startDate: "2025-03-03",
      workDays: 2,
      endDate: "2025-03-04",
      createdBy: adminUserId,
    },
  ]);
  await db.insert(scheduleItemPredecessors).values([
    {
      scheduleItemId: itemBId,
      predecessorId: itemAId,
      dependencyType: "finish_to_start",
      lagDays: 0,
    },
    {
      scheduleItemId: itemCId,
      predecessorId: itemBId,
      dependencyType: "finish_to_start",
      lagDays: 0,
    },
  ]);

  // Confirm persisted order differs from cascade order (otherwise this
  // test couldn't catch the regression).
  const persistedOrder = await db
    .select({ id: scheduleItems.id, title: scheduleItems.title })
    .from(scheduleItems)
    .where(eq(scheduleItems.jobId, orderingJobId))
    .orderBy(asc(scheduleItems.startDate), asc(scheduleItems.id));
  assert.notDeepEqual(
    persistedOrder.map((r) => r.title),
    ["ZZZ ordering A", "ZZZ ordering B", "ZZZ ordering C"],
    "test setup invalid: persisted order already matches cascade order",
  );

  const page1 = await authedGet(`/api/jobs/${orderingJobId}/schedule?cursor=&limit=2`);
  assert.equal(page1.status, 200);
  const page1Body = (await page1.json()) as {
    data: Array<{ id: string; startDate: string; title: string }>;
    pagination: { hasMore: boolean; nextCursor: string | null };
  };
  assert.deepEqual(
    page1Body.data.map((r) => r.title),
    ["ZZZ ordering A", "ZZZ ordering B"],
    "page 1 must list items in cascade-resolved order (A, B)",
  );
  for (let i = 1; i < page1Body.data.length; i++) {
    assert.ok(
      page1Body.data[i - 1]!.startDate <= page1Body.data[i]!.startDate,
      `response startDate must be monotonically non-decreasing; got ${page1Body.data[i - 1]!.startDate} then ${page1Body.data[i]!.startDate}`,
    );
  }
  assert.equal(page1Body.pagination.hasMore, true, "more results expected");
  assert.ok(page1Body.pagination.nextCursor, "expected a nextCursor");

  const page2 = await authedGet(
    `/api/jobs/${orderingJobId}/schedule?cursor=${encodeURIComponent(page1Body.pagination.nextCursor!)}&limit=2`,
  );
  assert.equal(page2.status, 200);
  const page2Body = (await page2.json()) as {
    data: Array<{ id: string; title: string }>;
  };
  assert.deepEqual(
    page2Body.data.map((r) => r.title),
    ["ZZZ ordering C"],
    "page 2 must contain the remaining item (C)",
  );

  const seen = new Set(page1Body.data.map((r) => r.id));
  for (const r of page2Body.data) {
    assert.ok(!seen.has(r.id), `row ${r.id} appeared on both pages`);
  }
});

test("write paths persist the cascade to disk in the same transaction", async () => {
  const { db } = await import("@workspace/db");
  const { scheduleItems, scheduleItemPredecessors } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  // B is FS-after-A.
  const itemAId = crypto.randomUUID();
  const itemBId = crypto.randomUUID();

  await db.insert(scheduleItems).values([
    {
      id: itemAId,
      jobId: writeCascadeJobId,
      title: "ZZZ A predecessor",
      startDate: "2025-02-03",
      workDays: 5,
      endDate: "2025-02-07",
      createdBy: adminUserId,
    },
    {
      id: itemBId,
      jobId: writeCascadeJobId,
      title: "ZZZ B downstream",
      startDate: "2025-02-10",
      workDays: 3,
      endDate: "2025-02-12",
      createdBy: adminUserId,
    },
  ]);
  await db.insert(scheduleItemPredecessors).values({
    scheduleItemId: itemBId,
    predecessorId: itemAId,
    dependencyType: "finish_to_start",
    lagDays: 0,
  });

  // Push A out a week via the real PUT route; B's persisted dates must
  // shift in the same transaction.
  const putRes = await authedJson("PUT", `/api/schedule-items/${itemAId}`, {
    title: "ZZZ A predecessor",
    startDate: "2025-02-10",
    workDays: 5,
    displayColor: "#2563eb",
    progress: 0,
    reminder: "none",
    showOnGantt: true,
    visibleToEstimators: true,
    visibleToInstallers: true,
    visibleToOfficeStaff: true,
    isComplete: false,
    isHourly: false,
    notes: "",
    tags: [],
    predecessors: [],
    assigneeIds: [],
    notifyUserIds: [],
  });
  assert.equal(putRes.status, 200, `PUT must succeed; got ${putRes.status} body ${await putRes.text()}`);

  // Read B from the DB directly — no GET in between. A's new endDate is
  // Fri 2025-02-14, so B (FS-after-A) starts Mon 2025-02-17 and runs
  // workDays=3 to Wed 2025-02-19.
  const [bAfter] = await db
    .select({ startDate: scheduleItems.startDate, endDate: scheduleItems.endDate })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, itemBId));

  assert.equal(bAfter!.startDate, "2025-02-17", `B.startDate; got ${bAfter!.startDate}`);
  assert.equal(bAfter!.endDate, "2025-02-19", `B.endDate; got ${bAfter!.endDate}`);
});

test("sweepAllAutomaticCompletion flips overdue items only when settings.opt-in is on", async () => {
  const { db } = await import("@workspace/db");
  const { scheduleItems, scheduleSettings } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const { sweepAllAutomaticCompletion } = await import("../src/routes/schedule.ts");

  // Two jobs, one with the setting on and one off; both have an overdue
  // incomplete item.
  const enabledItemId = crypto.randomUUID();
  const disabledItemId = crypto.randomUUID();

  await db.insert(scheduleSettings).values([
    {
      jobId: sweeperJobId,
      automaticallyMarkItemsComplete: true,
    },
    {
      jobId: sweeperJobDisabledId,
      automaticallyMarkItemsComplete: false,
    },
  ]);

  await db.insert(scheduleItems).values([
    {
      id: enabledItemId,
      jobId: sweeperJobId,
      title: "ZZZ overdue (auto-complete on)",
      startDate: "2024-01-01",
      workDays: 1,
      endDate: "2024-01-01",
      isComplete: false,
      createdBy: adminUserId,
    },
    {
      id: disabledItemId,
      jobId: sweeperJobDisabledId,
      title: "ZZZ overdue (auto-complete off)",
      startDate: "2024-01-01",
      workDays: 1,
      endDate: "2024-01-01",
      isComplete: false,
      createdBy: adminUserId,
    },
  ]);

  await sweepAllAutomaticCompletion(new Date("2025-12-31T00:00:00Z"));

  const [enabledAfter] = await db
    .select({ isComplete: scheduleItems.isComplete, progress: scheduleItems.progress })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, enabledItemId));
  const [disabledAfter] = await db
    .select({ isComplete: scheduleItems.isComplete, progress: scheduleItems.progress })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, disabledItemId));

  assert.equal(enabledAfter!.isComplete, true, "enabled job's overdue item must flip");
  assert.equal(disabledAfter!.isComplete, false, "disabled job's item must not flip");
});
