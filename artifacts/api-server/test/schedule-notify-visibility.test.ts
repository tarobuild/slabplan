import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let pmAccessJwt: string;
let workerAccessJwt: string;

const adminUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const workerUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const visibleItemId = crypto.randomUUID();
const hiddenItemId = crypto.randomUUID();

const adminEmail = `admin-${adminUserId}@schedule-notify-visibility-test.local`;
const pmEmail = `pm-${pmUserId}@schedule-notify-visibility-test.local`;
const workerEmail = `worker-${workerUserId}@schedule-notify-visibility-test.local`;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

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

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Notify Admin",
      role: "admin",
    },
    {
      id: pmUserId,
      email: pmEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Notify PM",
      role: "project_manager",
    },
    {
      id: workerUserId,
      email: workerEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Notify Worker",
      role: "crew_member",
    },
  ]);
  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Schedule Notify Visibility Job",
    createdBy: adminUserId,
    projectManagerId: pmUserId,
  });
  await db.insert(jobAssignees).values({ jobId, userId: workerUserId });
  await db.insert(scheduleItems).values([
    {
      id: visibleItemId,
      jobId,
      title: "ZZZ Visible Notify Item",
      startDate: "2026-05-01",
      workDays: 1,
      endDate: "2026-05-01",
      visibleToOfficeStaff: true,
      visibleToEstimators: true,
      createdBy: pmUserId,
    },
    {
      id: hiddenItemId,
      jobId,
      title: "ZZZ Hidden Notify Item",
      startDate: "2026-05-02",
      workDays: 1,
      endDate: "2026-05-02",
      visibleToOfficeStaff: false,
      visibleToEstimators: false,
      visibleToInstallers: false,
      createdBy: adminUserId,
    },
  ]);
  await db.insert(scheduleItemAssignees).values([
    { scheduleItemId: visibleItemId, userId: workerUserId },
    { scheduleItemId: hiddenItemId, userId: adminUserId },
  ]);

  const stamp = new Date();
  pmAccessJwt = auth.signAccessToken({
    id: pmUserId,
    email: pmEmail,
    fullName: "ZZZ Notify PM",
    role: "project_manager",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  workerAccessJwt = auth.signAccessToken({
    id: workerUserId,
    email: workerEmail,
    fullName: "ZZZ Notify Worker",
    role: "crew_member",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
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
  const { activityLog, jobs, users } = await import("@workspace/db/schema");
  const { inArray, eq } = await import("drizzle-orm");

  try {
    await db.delete(activityLog).where(inArray(activityLog.userId, [adminUserId, pmUserId, workerUserId]));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(users).where(inArray(users.id, [adminUserId, pmUserId, workerUserId]));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

function jsonHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

test("crew members cannot enumerate assignees through notify-assigned-users", async () => {
  const response = await fetch(`${baseUrl}/api/jobs/${jobId}/schedule/notify-assigned-users`, {
    method: "POST",
    headers: jsonHeaders(workerAccessJwt),
  });

  assert.equal(response.status, 403);
});

test("notify-assigned-users only counts and records visible assignments", async () => {
  const response = await fetch(`${baseUrl}/api/jobs/${jobId}/schedule/notify-assigned-users`, {
    method: "POST",
    headers: jsonHeaders(pmAccessJwt),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    countUsers: number;
    countItems: number;
    recipients?: Array<{ id: string; fullName: string; email: string }>;
  };
  assert.equal(body.countUsers, 1);
  assert.equal(body.countItems, 1);
  assert.equal(body.recipients?.some((recipient) => recipient.id === adminUserId), false);

  const { db } = await import("@workspace/db");
  const { activityLog } = await import("@workspace/db/schema");
  const { and, desc, eq } = await import("drizzle-orm");
  const [activity] = await db
    .select({ metadata: activityLog.metadata })
    .from(activityLog)
    .where(and(eq(activityLog.entityType, "schedule_notification"), eq(activityLog.userId, pmUserId)))
    .orderBy(desc(activityLog.createdAt))
    .limit(1);

  const serializedMetadata = JSON.stringify(activity?.metadata ?? {});
  assert.equal(serializedMetadata.includes("ZZZ Visible Notify Item"), true);
  assert.equal(serializedMetadata.includes("ZZZ Hidden Notify Item"), false);
  assert.equal(serializedMetadata.includes(adminEmail), false);
});
