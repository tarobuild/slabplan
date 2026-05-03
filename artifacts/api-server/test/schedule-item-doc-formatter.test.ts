import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";

const testDatabaseUrl =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

const adminUserId = crypto.randomUUID();
const assigneeUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const phaseId = crypto.randomUUID();
const mainItemId = crypto.randomUUID();
const predecessorAItemId = crypto.randomUUID();
const predecessorBItemId = crypto.randomUUID();

const allUserIds = [adminUserId, assigneeUserId];

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS ??= "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN ??= "workspace.kirk.replit.dev";

  const { prepareApp } = await import("../src/app.ts");
  const { db } = await import("@workspace/db");
  const {
    jobs,
    schedulePhases,
    scheduleItemAssignees,
    scheduleItemNotes,
    scheduleItemPredecessors,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values([
    {
      id: adminUserId,
      email: `admin-${adminUserId}@schedule-doc-test.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Schedule Doc Admin",
      role: "admin",
    },
    {
      id: assigneeUserId,
      email: `assignee-${assigneeUserId}@schedule-doc-test.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Schedule Doc Assignee",
      role: "crew_member",
    },
  ]);

  await db.insert(jobs).values({
    id: jobId,
    title: `ZZZ Schedule Doc Job ${jobId}`,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });

  await db.insert(schedulePhases).values({
    id: phaseId,
    jobId,
    name: "Demo Phase",
    color: "#ff8800",
  });

  await db.insert(scheduleItems).values([
    {
      id: predecessorAItemId,
      jobId,
      title: "ZZZ Predecessor Alpha",
      startDate: "2025-06-01",
      workDays: 1,
      endDate: "2025-06-01",
      createdBy: adminUserId,
    },
    {
      id: predecessorBItemId,
      jobId,
      title: "ZZZ Predecessor Beta",
      startDate: "2025-06-02",
      workDays: 1,
      endDate: "2025-06-02",
      createdBy: adminUserId,
    },
    {
      id: mainItemId,
      jobId,
      schedulePhaseId: phaseId,
      title: "ZZZ Schedule Doc Main Item",
      displayColor: "#123456",
      startDate: "2025-06-10",
      workDays: 3,
      endDate: "2025-06-12",
      isHourly: true,
      startTime: "08:00:00",
      endTime: "17:30:00",
      progress: 42,
      isComplete: false,
      reminder: "1_hour_before",
      notes: JSON.stringify({
        __cadstoneScheduleMeta: true,
        notes: null,
        tags: ["safety", "priority"],
        predecessors: [],
      }),
      showOnGantt: true,
      visibleToEstimators: false,
      visibleToInstallers: true,
      visibleToOfficeStaff: false,
      createdBy: adminUserId,
    },
  ]);

  await db.insert(scheduleItemAssignees).values([
    { scheduleItemId: mainItemId, userId: adminUserId },
    { scheduleItemId: mainItemId, userId: assigneeUserId },
  ]);

  await db.insert(scheduleItemPredecessors).values([
    {
      id: crypto.randomUUID(),
      scheduleItemId: mainItemId,
      predecessorId: predecessorAItemId,
      dependencyType: "finish_to_start",
      lagDays: 0,
    },
    {
      id: crypto.randomUUID(),
      scheduleItemId: mainItemId,
      predecessorId: predecessorBItemId,
      dependencyType: "start_to_start",
      lagDays: 2,
    },
  ]);

  await db.insert(scheduleItemNotes).values([
    {
      id: crypto.randomUUID(),
      scheduleItemId: mainItemId,
      note: "First note from admin.",
      createdBy: adminUserId,
      createdAt: new Date("2025-06-09T10:00:00.000Z"),
    },
    {
      id: crypto.randomUUID(),
      scheduleItemId: mainItemId,
      note: "Second, more recent note.",
      createdBy: assigneeUserId,
      createdAt: new Date("2025-06-09T11:00:00.000Z"),
    },
  ]);
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { activityLog, jobs, users } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(activityLog).where(inArray(activityLog.userId, allUserIds));
    await db.delete(users).where(inArray(users.id, allUserIds));
  } finally {
    await pool.end();
  }
});

test("formatter renders every section with real data and placeholders for unset fields", async () => {
  const { buildScheduleItemDocBody, __scheduleDocTesting } = await import(
    "../src/routes/schedule.ts"
  );

  const hydrated = await __scheduleDocTesting.hydrateScheduleItem(mainItemId);

  const body = buildScheduleItemDocBody({
    item: hydrated.item,
    jobTitle: `ZZZ Schedule Doc Job ${jobId}`,
    createdByName: "ZZZ Schedule Doc Admin",
    createdByEmail: `admin-${adminUserId}@schedule-doc-test.local`,
    createdAt: new Date("2025-06-15T12:34:56.000Z"),
  });

  assert.ok(body.startsWith("ZZZ Schedule Doc Main Item\n"));

  assert.match(body, /STATUS\n {2}Completion: In Progress\n {2}Progress: 42%/);
  assert.match(body, /Display Color: Custom \(#123456\)/);

  assert.match(body, new RegExp(`Job: ZZZ Schedule Doc Job ${jobId}`));
  assert.match(body, /Phase: Demo Phase/);

  assert.match(body, /ASSIGNEES\n {2}- ZZZ Schedule Doc Admin/);
  assert.match(body, /- ZZZ Schedule Doc Assignee/);

  assert.match(body, /Start Date: 2025-06-10/);
  assert.match(body, /End Date: 2025-06-12/);
  assert.match(body, /Work Days: 3/);
  assert.match(body, /Hourly: Yes/);
  assert.match(body, /Start Time: 8:00 AM/);
  assert.match(body, /End Time: 5:30 PM/);

  assert.match(body, /TAGS\n {2}safety, priority/);

  assert.match(body, /REMINDER\n {2}1 Hour Before/);

  assert.match(
    body,
    /- ZZZ Predecessor Alpha • Finish-to-Start \(FS\) • lag 0 days/,
  );
  assert.match(
    body,
    /- ZZZ Predecessor Beta • Start-to-Start \(SS\) • lag 2 days/,
  );

  assert.match(body, /Show on Gantt: Yes/);
  assert.match(body, /Visible to Estimators: No/);
  assert.match(body, /Visible to Installers: Yes/);
  assert.match(body, /Visible to Office Staff: No/);

  const notesIdx = body.indexOf("NOTES");
  assert.ok(notesIdx > 0, "expected NOTES section");
  const newerIdx = body.indexOf("Second, more recent note.");
  const olderIdx = body.indexOf("First note from admin.");
  assert.ok(newerIdx > 0 && olderIdx > 0, "both notes should appear");
  assert.ok(newerIdx < olderIdx, "newer note must come before the older one");

  assert.match(body, new RegExp(`Item ID: ${mainItemId}`));
  assert.match(body, /Document created by: ZZZ Schedule Doc Admin/);
  assert.match(
    body,
    /Document created at: 2025-06-15T12:34:56\.000Z/,
  );
});

test("formatter shows placeholders when optional fields are unset", async () => {
  const { buildScheduleItemDocBody, __scheduleDocTesting } = await import(
    "../src/routes/schedule.ts"
  );
  const { db } = await import("@workspace/db");
  const { scheduleItems } = await import("@workspace/db/schema");

  const sparseItemId = crypto.randomUUID();
  await db.insert(scheduleItems).values({
    id: sparseItemId,
    jobId,
    title: "ZZZ Sparse Item",
    startDate: "2025-07-01",
    workDays: 1,
    endDate: "2025-07-01",
    createdBy: adminUserId,
  });

  try {
    const hydrated = await __scheduleDocTesting.hydrateScheduleItem(sparseItemId);

    const body = buildScheduleItemDocBody({
      item: hydrated.item,
      jobTitle: null,
      createdByName: null,
      createdByEmail: "fallback@schedule-doc-test.local",
      createdAt: new Date("2025-07-02T00:00:00.000Z"),
    });

    assert.match(body, /Job: Unknown job/);
    assert.match(body, /Phase: None/);
    assert.match(body, /ASSIGNEES\n {2}None/);
    assert.match(body, /TAGS\n {2}None/);
    assert.match(body, /PREDECESSORS\n {2}None/);
    assert.match(body, /NOTES \(most recent first\)\n {2}None/);
    assert.match(body, /REMINDER\n {2}None/);
    assert.match(body, /Document created by: fallback@schedule-doc-test\.local/);
  } finally {
    const { eq } = await import("drizzle-orm");
    await db.delete(scheduleItems).where(eq(scheduleItems.id, sparseItemId));
  }
});
