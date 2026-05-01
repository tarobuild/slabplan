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
let workerAccessJwt: string;

const adminUserId = crypto.randomUUID();
const workerUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@schedule-cascade-test.local`;
const workerEmail = `worker-${workerUserId}@schedule-cascade-test.local`;

// One job per scenario; ON DELETE CASCADE clears related rows in after().
const readOnlyJobId = crypto.randomUUID();
const writeCascadeJobId = crypto.randomUUID();
const sweeperJobId = crypto.randomUUID();
const sweeperJobDisabledId = crypto.randomUUID();
const concurrentJobId = crypto.randomUUID();
const baselineReadOnlyJobId = crypto.randomUUID();
const baselineVisibilityJobId = crypto.randomUUID();
const allJobIds = [
  readOnlyJobId,
  writeCascadeJobId,
  sweeperJobId,
  sweeperJobDisabledId,
  concurrentJobId,
  baselineReadOnlyJobId,
  baselineVisibilityJobId,
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
  const { jobAssignees, users, jobs } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Schedule Cascade Admin",
      role: "admin",
    },
    {
      id: workerUserId,
      email: workerEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Schedule Cascade Worker",
      role: "crew_member",
    },
  ]);

  await db.insert(jobs).values(
    allJobIds.map((id, i) => ({
      id,
      title: `ZZZ Schedule Cascade Job ${i} ${id}`,
      createdBy: adminUserId,
      projectManagerId: adminUserId,
    })),
  );
  await db.insert(jobAssignees).values({ jobId: baselineVisibilityJobId, userId: workerUserId });

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
  workerAccessJwt = auth.signAccessToken({
    id: workerUserId,
    email: workerEmail,
    fullName: "ZZZ Schedule Cascade Worker",
    role: "crew_member",
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
    await db.delete(users).where(inArray(users.id, [adminUserId, workerUserId]));
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

function workerGet(path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${workerAccessJwt}` },
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

// Audit task #210: GET /jobs/:jobId/schedule/baseline used to harbor
// two hidden writes — (1) synchronizeJobSchedule(jobId) UPDATEing
// schedule_items via cascade and possibly again via
// applyAutomaticCompletionIfEnabled, and (2) ensureJobExists(jobId)
// lazy-INSERTing a default schedule_phase + schedule_settings row on
// first view of a job. Opening the baseline tab is a read-shaped
// action — read-scope PATs and the in-app agent must be able to view
// it without producing mutations, concurrent viewers must not race
// writes, and the audit trail must not record rewrites that no human
// caused. This test seeds a fresh job with NO defaults plus stale
// persisted item dates that the cascade would otherwise rewrite, then
// asserts: (a) the interceptor sees zero UPDATE/INSERT/DELETE, (b) the
// response uses cascade-resolved dates as overrides, (c) persisted
// dates remain stale, and (d) schedule_settings + schedule_phases for
// the job are still empty after the GET (proves the lazy-init writes
// are gone).
test("GET /jobs/:jobId/schedule/baseline does NOT issue any UPDATE/INSERT/DELETE", async () => {
  const { db, pool } = await import("@workspace/db");
  const { scheduleItems, scheduleItemPredecessors, scheduleBaselines, scheduleSettings, schedulePhases } =
    await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  // Deliberately do NOT pre-insert schedule_settings or schedule_phases
  // for this job. ensureJobExists used to lazy-INSERT both the first
  // time anyone hit a schedule endpoint, so a fresh-job GET was secretly
  // populating defaults. The fix swaps to verifyJobExists; this test
  // proves the lazy-init writes are gone by asserting the interceptor
  // sees zero writes AND that schedule_settings / schedule_phases
  // remain empty for this job after the GET.

  // A is the predecessor; B is FS-after-A. Both have stale persisted
  // dates that the cascade engine would want to fix on a write path,
  // producing UPDATEs if the GET still called synchronizeJobSchedule.
  //   A: workDays=5 from Mon 2025-05-05 cascades to endDate=Fri 2025-05-09
  //      (persisted endDate=2025-05-15 is stale).
  //   B: persisted Mon 2025-05-06 -> Wed 2025-05-08 is BEFORE A finishes,
  //      so the FS-after-A cascade pushes B's start to the next workday
  //      after A's cascaded end (Mon 2025-05-12) and recomputes
  //      endDate to Wed 2025-05-14 from workDays=3.
  // (Note: resolvePredecessorStartDate only ever pushes a successor
  // forward, never pulls it back. B's persisted start must therefore
  // be EARLIER than A's cascaded end for the cascade to take effect.)
  const itemAId = crypto.randomUUID();
  const itemBId = crypto.randomUUID();
  await db.insert(scheduleItems).values([
    {
      id: itemAId,
      jobId: baselineReadOnlyJobId,
      title: "ZZZ baseline A predecessor",
      startDate: "2025-05-05",
      workDays: 5,
      endDate: "2025-05-15",
      createdBy: adminUserId,
    },
    {
      id: itemBId,
      jobId: baselineReadOnlyJobId,
      title: "ZZZ baseline B downstream",
      startDate: "2025-05-06",
      workDays: 3,
      endDate: "2025-05-08",
      createdBy: adminUserId,
    },
  ]);
  await db.insert(scheduleItemPredecessors).values({
    scheduleItemId: itemBId,
    predecessorId: itemAId,
    dependencyType: "finish_to_start",
    lagDays: 0,
  });

  // Seed a baseline directly so the GET has something to render.
  // (Going through POST would itself synchronize and "fix" the persisted
  // dates — defeating the test.) Snapshot baselineEndDate matches the
  // current persisted value so shiftDays is well-defined relative to the
  // cascade override.
  await db.insert(scheduleBaselines).values({
    id: crypto.randomUUID(),
    jobId: baselineReadOnlyJobId,
    capturedAt: new Date(),
    capturedBy: adminUserId,
    itemsSnapshot: [
      {
        scheduleItemId: itemAId,
        title: "ZZZ baseline A predecessor",
        baselineStartDate: "2025-05-05",
        baselineEndDate: "2025-05-15",
      },
      {
        scheduleItemId: itemBId,
        title: "ZZZ baseline B downstream",
        baselineStartDate: "2025-05-06",
        baselineEndDate: "2025-05-08",
      },
    ],
  });

  // Pre-flight: confirm the test setup truly omits defaults, otherwise
  // the lazy-init assertion below would be a tautology.
  const settingsBefore = await db
    .select({ jobId: scheduleSettings.jobId })
    .from(scheduleSettings)
    .where(eq(scheduleSettings.jobId, baselineReadOnlyJobId));
  const phasesBefore = await db
    .select({ id: schedulePhases.id })
    .from(schedulePhases)
    .where(eq(schedulePhases.jobId, baselineReadOnlyJobId));
  assert.equal(settingsBefore.length, 0, "test invalid: schedule_settings already present");
  assert.equal(phasesBefore.length, 0, "test invalid: schedule_phases already present");

  const interceptor = installWriteInterceptor(pool);
  let body: {
    baseline: {
      items: Array<{
        scheduleItemId: string;
        baselineEndDate: string;
        currentStartDate: string | null;
        currentEndDate: string | null;
        shiftDays: number;
      }>;
    };
  };
  try {
    const res = await authedGet(`/api/jobs/${baselineReadOnlyJobId}/schedule/baseline`);
    assert.equal(res.status, 200, `GET baseline must return 200, got ${res.status}`);
    body = (await res.json()) as typeof body;
  } finally {
    interceptor.restore();
  }

  assert.deepEqual(
    interceptor.writes,
    [],
    `GET baseline must not issue any UPDATE/INSERT/DELETE; observed: ${JSON.stringify(interceptor.writes, null, 2)}`,
  );

  // Response must reflect the cascade overrides — currentEndDate is the
  // cascade-resolved value, NOT the stale persisted endDate.
  const aEntry = body.baseline.items.find((i) => i.scheduleItemId === itemAId);
  const bEntry = body.baseline.items.find((i) => i.scheduleItemId === itemBId);
  assert.ok(aEntry && bEntry, "both seeded items must appear in the baseline response");
  assert.equal(aEntry!.currentStartDate, "2025-05-05");
  assert.equal(aEntry!.currentEndDate, "2025-05-09", "A.currentEndDate must be cascade-resolved");
  assert.equal(bEntry!.currentStartDate, "2025-05-12", "B.currentStartDate must be cascade-resolved");
  assert.equal(bEntry!.currentEndDate, "2025-05-14", "B.currentEndDate must be cascade-resolved");

  // Persisted dates must remain untouched — confirms no write-back by
  // the cascade.
  const [aPersisted] = await db
    .select({ startDate: scheduleItems.startDate, endDate: scheduleItems.endDate })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, itemAId));
  const [bPersisted] = await db
    .select({ startDate: scheduleItems.startDate, endDate: scheduleItems.endDate })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, itemBId));

  assert.equal(aPersisted!.startDate, "2025-05-05", "A.startDate must NOT have been rewritten");
  assert.equal(aPersisted!.endDate, "2025-05-15", "A.endDate must NOT have been rewritten");
  assert.equal(bPersisted!.startDate, "2025-05-06", "B.startDate must NOT have been rewritten");
  assert.equal(bPersisted!.endDate, "2025-05-08", "B.endDate must NOT have been rewritten");

  // Lazy-init must not have fired: schedule_settings and schedule_phases
  // for this job are still empty after the GET. This is the assertion
  // that catches regressions if anyone re-introduces ensureJobExists or
  // any other lazy-default helper on this read path.
  const settingsAfter = await db
    .select({ jobId: scheduleSettings.jobId })
    .from(scheduleSettings)
    .where(eq(scheduleSettings.jobId, baselineReadOnlyJobId));
  const phasesAfter = await db
    .select({ id: schedulePhases.id })
    .from(schedulePhases)
    .where(eq(schedulePhases.jobId, baselineReadOnlyJobId));
  assert.equal(
    settingsAfter.length,
    0,
    "GET baseline must NOT lazy-INSERT a schedule_settings row",
  );
  assert.equal(
    phasesAfter.length,
    0,
    "GET baseline must NOT lazy-INSERT a default schedule_phase row",
  );
});

test("GET baseline applies schedule visibility rules per viewer", async () => {
  const { db } = await import("@workspace/db");
  const { scheduleBaselines, scheduleItems } = await import("@workspace/db/schema");
  const visibleItemId = crypto.randomUUID();
  const personalTodoId = crypto.randomUUID();

  await db.insert(scheduleItems).values([
    {
      id: visibleItemId,
      jobId: baselineVisibilityJobId,
      title: "ZZZ Worker Visible Baseline Item",
      startDate: "2026-03-02",
      workDays: 1,
      endDate: "2026-03-02",
      visibleToInstallers: true,
      createdBy: adminUserId,
    },
    {
      id: personalTodoId,
      jobId: baselineVisibilityJobId,
      title: "ZZZ Admin Personal Baseline Todo",
      startDate: "2026-03-03",
      workDays: 1,
      endDate: "2026-03-03",
      isPersonalTodo: true,
      createdBy: adminUserId,
    },
  ]);

  await db.insert(scheduleBaselines).values({
    jobId: baselineVisibilityJobId,
    capturedBy: adminUserId,
    itemsSnapshot: [
      {
        scheduleItemId: visibleItemId,
        title: "ZZZ Worker Visible Baseline Item",
        baselineStartDate: "2026-03-02",
        baselineEndDate: "2026-03-02",
      },
      {
        scheduleItemId: personalTodoId,
        title: "ZZZ Admin Personal Baseline Todo",
        baselineStartDate: "2026-03-03",
        baselineEndDate: "2026-03-03",
      },
    ],
  });

  const workerResponse = await workerGet(`/api/jobs/${baselineVisibilityJobId}/schedule/baseline`);
  assert.equal(workerResponse.status, 200);
  const workerBody = (await workerResponse.json()) as {
    baseline: { items: Array<{ scheduleItemId: string; title: string }> };
  };
  assert.deepEqual(
    workerBody.baseline.items.map((item) => item.scheduleItemId),
    [visibleItemId],
  );
  assert.equal(JSON.stringify(workerBody).includes("ZZZ Admin Personal Baseline Todo"), false);

  const adminResponse = await authedGet(`/api/jobs/${baselineVisibilityJobId}/schedule/baseline`);
  assert.equal(adminResponse.status, 200);
  const adminBody = (await adminResponse.json()) as {
    baseline: { items: Array<{ scheduleItemId: string; title: string }> };
  };
  assert.deepEqual(
    new Set(adminBody.baseline.items.map((item) => item.scheduleItemId)),
    new Set([visibleItemId, personalTodoId]),
  );
});

// Findings (audit task #210):
// - Endpoints serving baseline data: GET /jobs/:jobId/schedule/baseline
//   (read), POST and PUT /jobs/:jobId/schedule/baseline (writes), DELETE
//   /jobs/:jobId/schedule/baseline (write). Helpers: buildBaselinePayload
//   (pure read), upsertBaselineForJob (write — only called from POST/PUT).
// - Hidden write #1: the GET previously called synchronizeJobSchedule(jobId),
//   which UPDATEs schedule_items (cascade) and via
//   applyAutomaticCompletionIfEnabled may UPDATE again. Fix: the GET now
//   computes the cascade in memory (loadJobScheduleCascadeInputs +
//   computeJobScheduleCascade) and uses the resolved dates as the
//   response's "current" values. Mirrors the #162 fix on GET schedule.
// - Hidden write #2: the GET also called ensureJobExists(jobId), which
//   lazy-INSERTs a default schedule_phase + schedule_settings row the
//   first time the endpoint is hit for a job. Fix: swapped to the
//   read-only verifyJobExists; defaults are created on the next write
//   path. Same pattern as GET schedule.
// - The write paths (POST/PUT) still synchronize inside
//   upsertBaselineForJob's transaction, so the persistence guarantees on
//   user-initiated writes are unchanged. POST also still calls
//   ensureJobExists, which is appropriate for a write endpoint.
// - upsertBaselineForJob is only called from POST and PUT, so no other
//   read-shaped surface persists baseline writes.
