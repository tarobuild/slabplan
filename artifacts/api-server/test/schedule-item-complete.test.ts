// Integration tests for task #231: crew members can flip completion on
// schedule items they're assigned to via the narrow
// POST /api/schedule-items/:id/complete endpoint, but they still get
// 403 on the full PUT and on items they're not assigned to.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

let adminToken: string;
let crewToken: string;
let outsiderCrewToken: string;

const adminUserId = crypto.randomUUID();
const crewUserId = crypto.randomUUID();
const outsiderCrewUserId = crypto.randomUUID();

const jobId = crypto.randomUUID();
const otherJobId = crypto.randomUUID();
// One item the crew member is assigned to (the happy-path target).
const assignedItemId = crypto.randomUUID();
// One item on the same job the crew member is NOT assigned to (must 403).
const unassignedItemId = crypto.randomUUID();
// One item on a different job entirely the outsider crew has zero ties to.
const otherJobItemId = crypto.randomUUID();

const allUserIds = [adminUserId, crewUserId, outsiderCrewUserId];
const allJobIds = [jobId, otherJobId];
const allItemIds = [assignedItemId, unassignedItemId, otherJobItemId];

function makeUser(
  id: string,
  role: "admin" | "project_manager" | "crew_member",
  email: string,
  fullName: string,
) {
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

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return {
    ...authHeaders(token),
    "content-type": "application/json",
    // CSRF middleware requires this header on state-changing requests.
    "x-requested-with": "XMLHttpRequest",
  };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // Force the shared db client onto the local test pool — the prod pooler
  // has a 15-client cap that the suites blow through immediately.
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS ??= "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN ??= "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const {
    jobAssignees,
    jobs,
    scheduleItemAssignees,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  const passwordHash = "test-not-a-real-hash";
  const adminEmail = `admin-${adminUserId}@schedule-complete-test.local`;
  const crewEmail = `crew-${crewUserId}@schedule-complete-test.local`;
  const outsiderEmail = `crew-${outsiderCrewUserId}@schedule-complete-test.local`;

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash,
      fullName: "ZZZ Schedule Complete Admin",
      role: "admin",
    },
    {
      id: crewUserId,
      email: crewEmail,
      passwordHash,
      fullName: "ZZZ Schedule Complete Crew",
      role: "crew_member",
    },
    {
      id: outsiderCrewUserId,
      email: outsiderEmail,
      passwordHash,
      fullName: "ZZZ Schedule Complete Outsider Crew",
      role: "crew_member",
    },
  ]);

  await db.insert(jobs).values([
    {
      id: jobId,
      title: `ZZZ Schedule Complete Job ${jobId}`,
      createdBy: adminUserId,
      projectManagerId: adminUserId,
    },
    {
      id: otherJobId,
      title: `ZZZ Schedule Complete Other Job ${otherJobId}`,
      createdBy: adminUserId,
      projectManagerId: adminUserId,
    },
  ]);

  // Both crew members can SEE the main job (they're job-assigned), so
  // their 403s on the unassigned item must come from the schedule-item
  // assignment check, not from job-level visibility.
  await db.insert(jobAssignees).values([
    { jobId, userId: crewUserId },
    { jobId, userId: outsiderCrewUserId },
  ]);

  await db.insert(scheduleItems).values([
    {
      id: assignedItemId,
      jobId,
      title: "ZZZ Crew Assigned Item",
      startDate: "2025-05-05",
      workDays: 1,
      endDate: "2025-05-05",
      progress: 0,
      isComplete: false,
      createdBy: adminUserId,
    },
    {
      id: unassignedItemId,
      jobId,
      title: "ZZZ Crew Unassigned Item",
      startDate: "2025-05-06",
      workDays: 1,
      endDate: "2025-05-06",
      progress: 0,
      isComplete: false,
      createdBy: adminUserId,
    },
    {
      id: otherJobItemId,
      jobId: otherJobId,
      title: "ZZZ Other Job Item",
      startDate: "2025-05-07",
      workDays: 1,
      endDate: "2025-05-07",
      progress: 0,
      isComplete: false,
      createdBy: adminUserId,
    },
  ]);

  await db.insert(scheduleItemAssignees).values({
    scheduleItemId: assignedItemId,
    userId: crewUserId,
  });

  adminToken = auth.signAccessToken(
    makeUser(adminUserId, "admin", adminEmail, "ZZZ Schedule Complete Admin"),
  );
  crewToken = auth.signAccessToken(
    makeUser(crewUserId, "crew_member", crewEmail, "ZZZ Schedule Complete Crew"),
  );
  outsiderCrewToken = auth.signAccessToken(
    makeUser(
      outsiderCrewUserId,
      "crew_member",
      outsiderEmail,
      "ZZZ Schedule Complete Outsider Crew",
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
  const { activityLog, jobs, users } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    // jobs cascades to schedule_items / schedule_item_assignees / job_assignees
    await db.delete(jobs).where(inArray(jobs.id, allJobIds));
    // activity_log doesn't cascade off users — clear before user rows go.
    await db.delete(activityLog).where(inArray(activityLog.userId, allUserIds));
    await db.delete(users).where(inArray(users.id, allUserIds));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

test("crew member: full PUT /schedule-items/:id is still 403 (regression guard)", async () => {
  // Even on the item they're assigned to. The narrow /complete endpoint
  // is the ONLY write path open to crew members; the fat PUT must remain
  // admin/PM-only so workers can't reschedule jobs from the field.
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${assignedItemId}`,
    {
      method: "PUT",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({
        title: "ZZZ Crew Assigned Item",
        startDate: "2025-05-05",
        workDays: 1,
        isComplete: true,
      }),
    },
  );
  assert.equal(
    res.status,
    403,
    `crew_member must still be 403 on full PUT, got ${res.status}`,
  );
});

test("crew member: POST /schedule-items/:id/complete on assigned item flips state and persists", async () => {
  const { db } = await import("@workspace/db");
  const { scheduleItems } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const res = await fetch(
    `${baseUrl}/api/schedule-items/${assignedItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({ isComplete: true }),
    },
  );
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);

  const body = (await res.json()) as {
    item: { id: string; isComplete: boolean; progress: number };
  };
  assert.equal(body.item.id, assignedItemId);
  assert.equal(body.item.isComplete, true);
  assert.equal(
    body.item.progress,
    100,
    "completing without explicit progress must set 100",
  );

  // Persistence check — proves the response wasn't a lie.
  const [persisted] = await db
    .select({
      isComplete: scheduleItems.isComplete,
      progress: scheduleItems.progress,
    })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, assignedItemId));
  assert.equal(persisted!.isComplete, true);
  assert.equal(persisted!.progress, 100);

  // GET returns the same state — no read-side filter is hiding the change.
  const getRes = await fetch(
    `${baseUrl}/api/schedule-items/${assignedItemId}`,
    { headers: authHeaders(crewToken) },
  );
  assert.equal(getRes.status, 200);
  const getBody = (await getRes.json()) as {
    item: { isComplete: boolean; progress: number };
  };
  assert.equal(getBody.item.isComplete, true);
  assert.equal(getBody.item.progress, 100);
});

test("crew member: re-opening an item via /complete restores progress to 99", async () => {
  // Continues from the previous test — assignedItem is currently complete.
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${assignedItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({ isComplete: false }),
    },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    item: { isComplete: boolean; progress: number };
  };
  assert.equal(body.item.isComplete, false);
  assert.equal(
    body.item.progress,
    99,
    "un-completing must drop progress off 100 so the item stops looking done",
  );
});

test("crew member: /complete with explicit progress in [0,100] is honored", async () => {
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${assignedItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({ isComplete: false, progress: 42 }),
    },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    item: { isComplete: boolean; progress: number };
  };
  assert.equal(body.item.isComplete, false);
  assert.equal(body.item.progress, 42);
});

test("crew member: /complete with out-of-range progress is 400", async () => {
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${assignedItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({ isComplete: true, progress: 250 }),
    },
  );
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

test("crew member: /complete on someone else's item (same job) is 403", async () => {
  // outsiderCrew is on the job but not assigned to this specific item.
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${unassignedItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(outsiderCrewToken),
      body: JSON.stringify({ isComplete: true }),
    },
  );
  assert.equal(
    res.status,
    403,
    `unassigned crew must be 403 on /complete, got ${res.status}`,
  );

  // And the persisted state never moved — narrow auth must reject before the
  // UPDATE runs, not after.
  const { db } = await import("@workspace/db");
  const { scheduleItems } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [persisted] = await db
    .select({
      isComplete: scheduleItems.isComplete,
      progress: scheduleItems.progress,
    })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, unassignedItemId));
  assert.equal(persisted!.isComplete, false);
  assert.equal(persisted!.progress, 0);
});

test("crew member: /complete on item in a job they don't even see is 403", async () => {
  // outsiderCrew is on the main job, but not on otherJob, so they shouldn't
  // even be able to view that item — we want the same 403 outcome here.
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${otherJobItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(outsiderCrewToken),
      body: JSON.stringify({ isComplete: true }),
    },
  );
  assert.equal(
    res.status,
    403,
    `out-of-job crew must be 403 on /complete, got ${res.status}`,
  );
});

test("admin: /complete still works for managers (smaller-payload alternative to PUT)", async () => {
  // Admins/PMs already have full PUT, but the narrow endpoint is open to
  // them too — verify so the "narrowness" check doesn't accidentally lock
  // admins out and force the UI into two branches.
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${unassignedItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(adminToken),
      body: JSON.stringify({ isComplete: true }),
    },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    item: { isComplete: boolean; progress: number };
  };
  assert.equal(body.item.isComplete, true);
  assert.equal(body.item.progress, 100);
});

test("crew member: /complete writes an activity-log row so PM/admin views update", async () => {
  // Realtime broadcast piggybacks on writeActivity → emitRealtimeEvent.
  // We check the persisted activity row as a proxy for "the broadcast
  // would have fired" — the runtime emitter has no test seam.
  const { db } = await import("@workspace/db");
  const { activityLog } = await import("@workspace/db/schema");
  const { and, eq } = await import("drizzle-orm");

  // Flip the assigned item back to complete to generate a fresh row,
  // then assert there's at least one entry tagged to crewUserId.
  const res = await fetch(
    `${baseUrl}/api/schedule-items/${assignedItemId}/complete`,
    {
      method: "POST",
      headers: jsonHeaders(crewToken),
      body: JSON.stringify({ isComplete: true }),
    },
  );
  assert.equal(res.status, 200);

  const rows = await db
    .select({
      action: activityLog.action,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      userId: activityLog.userId,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "schedule_item"),
        eq(activityLog.entityId, assignedItemId),
        eq(activityLog.userId, crewUserId),
      ),
    );

  assert.ok(
    rows.length > 0,
    "crew /complete must record an activity log entry for realtime broadcast",
  );
  assert.ok(
    rows.some((row) => row.action === "completed" || row.action === "updated"),
    `expected a completed/updated action, got: ${JSON.stringify(rows.map((r) => r.action))}`,
  );
});
