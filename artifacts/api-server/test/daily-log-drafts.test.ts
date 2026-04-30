import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;
let workerAAccessJwt: string;
let workerBAccessJwt: string;

const adminUserId = crypto.randomUUID();
const workerAUserId = crypto.randomUUID();
const workerBUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const draftLogId = crypto.randomUUID();

const adminEmail = `admin-${adminUserId}@daily-log-drafts-test.local`;
const workerAEmail = `worker-a-${workerAUserId}@daily-log-drafts-test.local`;
const workerBEmail = `worker-b-${workerBUserId}@daily-log-drafts-test.local`;

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
  const { dailyLogs, jobAssignees, jobs, users } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Daily Log Admin",
      role: "admin",
    },
    {
      id: workerAUserId,
      email: workerAEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Daily Log Worker A",
      role: "crew_member",
    },
    {
      id: workerBUserId,
      email: workerBEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Daily Log Worker B",
      role: "crew_member",
    },
  ]);
  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Daily Log Draft Visibility Job",
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });
  await db.insert(jobAssignees).values([
    { jobId, userId: workerAUserId },
    { jobId, userId: workerBUserId },
  ]);
  await db.insert(dailyLogs).values({
    id: draftLogId,
    jobId,
    logDate: "2026-04-01",
    title: "Worker A Draft Log",
    notes: "draft notes",
    shareInternalUsers: true,
    isPrivate: false,
    createdBy: workerAUserId,
    publishedAt: null,
  });

  const stamp = new Date();
  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Daily Log Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  workerAAccessJwt = auth.signAccessToken({
    id: workerAUserId,
    email: workerAEmail,
    fullName: "ZZZ Daily Log Worker A",
    role: "crew_member",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  workerBAccessJwt = auth.signAccessToken({
    id: workerBUserId,
    email: workerBEmail,
    fullName: "ZZZ Daily Log Worker B",
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
  const { jobs, users } = await import("@workspace/db/schema");
  const { inArray, eq } = await import("drizzle-orm");

  try {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(users).where(inArray(users.id, [adminUserId, workerAUserId, workerBUserId]));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function listLogs(token: string) {
  const response = await fetch(`${baseUrl}/api/jobs/${jobId}/daily-logs?pageSize=50`, {
    headers: authHeaders(token),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { logs: Array<{ id: string; title: string | null; status: string }> };
}

test("draft daily logs are visible only to creator and admins until published", async () => {
  const workerAList = await listLogs(workerAAccessJwt);
  assert.equal(workerAList.logs.some((log) => log.id === draftLogId), true);

  const workerADetail = await fetch(`${baseUrl}/api/daily-logs/${draftLogId}`, {
    headers: authHeaders(workerAAccessJwt),
  });
  assert.equal(workerADetail.status, 200);

  const workerBList = await listLogs(workerBAccessJwt);
  assert.equal(workerBList.logs.some((log) => log.id === draftLogId), false);

  const workerBDetail = await fetch(`${baseUrl}/api/daily-logs/${draftLogId}`, {
    headers: authHeaders(workerBAccessJwt),
  });
  assert.equal(workerBDetail.status, 403);

  const adminList = await listLogs(adminAccessJwt);
  assert.equal(adminList.logs.some((log) => log.id === draftLogId), true);
});

test("published daily logs are visible to other eligible users", async () => {
  const { db } = await import("@workspace/db");
  const { dailyLogs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  await db
    .update(dailyLogs)
    .set({ publishedAt: new Date() })
    .where(eq(dailyLogs.id, draftLogId));

  const workerBList = await listLogs(workerBAccessJwt);
  assert.equal(workerBList.logs.some((log) => log.id === draftLogId), true);

  const workerBDetail = await fetch(`${baseUrl}/api/daily-logs/${draftLogId}`, {
    headers: authHeaders(workerBAccessJwt),
  });
  assert.equal(workerBDetail.status, 200);
});
