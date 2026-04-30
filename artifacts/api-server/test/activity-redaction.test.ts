import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;
let workerAccessJwt: string;

const adminUserId = crypto.randomUUID();
const workerUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const restrictedFolderId = crypto.randomUUID();
const personalTodoId = crypto.randomUUID();
const restrictedFolderActivityId = crypto.randomUUID();
const personalTodoActivityId = crypto.randomUUID();

const adminEmail = `admin-${adminUserId}@activity-redaction-test.local`;
const workerEmail = `worker-${workerUserId}@activity-redaction-test.local`;

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
    activityLog,
    folders,
    jobAssignees,
    jobs,
    scheduleItems,
    users,
  } = await import("@workspace/db/schema");
  const { initRealtime } = await import("../src/lib/realtime.ts");

  await prepareApp();

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Activity Admin",
      role: "admin",
    },
    {
      id: workerUserId,
      email: workerEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Activity Worker",
      role: "crew_member",
    },
  ]);

  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Activity Redaction Job",
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });
  await db.insert(jobAssignees).values({ jobId, userId: workerUserId });

  await db.insert(folders).values({
    id: restrictedFolderId,
    title: "Admin Vault Folder",
    scope: "job",
    jobId,
    parentFolderId: null,
    mediaType: "document",
    viewingPermissions: { admin: true },
    uploadingPermissions: { admin: true },
  });

  await db.insert(scheduleItems).values({
    id: personalTodoId,
    jobId,
    title: "Admin Private Todo",
    startDate: "2026-02-02",
    workDays: 1,
    endDate: "2026-02-02",
    isPersonalTodo: true,
    createdBy: adminUserId,
  });

  await db.insert(activityLog).values([
    {
      id: restrictedFolderActivityId,
      entityType: "folder",
      entityId: restrictedFolderId,
      action: "created",
      userId: adminUserId,
      metadata: {
        description: "Created folder Admin Vault Folder",
        jobId,
        folderId: restrictedFolderId,
        mediaType: "document",
      },
    },
    {
      id: personalTodoActivityId,
      entityType: "schedule_item",
      entityId: personalTodoId,
      action: "created",
      userId: adminUserId,
      metadata: {
        description: "Created schedule item Admin Private Todo",
        jobId,
        scheduleItemId: personalTodoId,
        current: { title: "Admin Private Todo" },
      },
    },
  ]);

  const stamp = new Date();
  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Activity Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  workerAccessJwt = auth.signAccessToken({
    id: workerUserId,
    email: workerEmail,
    fullName: "ZZZ Activity Worker",
    role: "crew_member",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });

  server = app.listen(0);
  initRealtime(server);
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
    await db.delete(activityLog).where(inArray(activityLog.id, [restrictedFolderActivityId, personalTodoActivityId]));
    await db.delete(jobs).where(eq(jobs.id, jobId));
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

test("worker activity feed omits admin-only folders and another user's personal todos", async () => {
  const response = await fetch(`${baseUrl}/api/activity?jobId=${jobId}&limit=20`, {
    headers: { authorization: `Bearer ${workerAccessJwt}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string; metadata: unknown; description?: string | null }> };
  const serialized = JSON.stringify(body.data);

  assert.equal(body.data.some((row) => row.id === restrictedFolderActivityId), false);
  assert.equal(body.data.some((row) => row.id === personalTodoActivityId), false);
  assert.equal(serialized.includes("Admin Vault Folder"), false);
  assert.equal(serialized.includes("Admin Private Todo"), false);
});

test("admin activity feed still includes restricted metadata", async () => {
  const response = await fetch(`${baseUrl}/api/activity?jobId=${jobId}&limit=20`, {
    headers: { authorization: `Bearer ${adminAccessJwt}` },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string; metadata: unknown }> };
  const serialized = JSON.stringify(body.data);

  assert.equal(body.data.some((row) => row.id === restrictedFolderActivityId), true);
  assert.equal(body.data.some((row) => row.id === personalTodoActivityId), true);
  assert.equal(serialized.includes("Admin Vault Folder"), true);
  assert.equal(serialized.includes("Admin Private Todo"), true);
});

test("realtime activity payload is redacted per recipient", async () => {
  const { redactRealtimePayloadForAuth } = await import("../src/lib/activity-visibility.ts");
  const payload = {
    id: personalTodoActivityId,
    entityType: "schedule_item",
    entityId: personalTodoId,
    action: "created",
    metadata: {
      description: "Created schedule item Admin Private Todo",
      jobId,
      scheduleItemId: personalTodoId,
      current: { title: "Admin Private Todo" },
    },
  };

  const workerPayload = await redactRealtimePayloadForAuth("activity:created", payload, {
    type: "access",
    userId: workerUserId,
    email: workerEmail,
    role: "crew_member",
  });
  const adminPayload = await redactRealtimePayloadForAuth("activity:created", payload, {
    type: "access",
    userId: adminUserId,
    email: adminEmail,
    role: "admin",
  });

  assert.equal(workerPayload, null);
  assert.deepEqual(adminPayload, payload);
});

test(
  "worker connected to a realtime job room does not receive restricted titles",
  { skip: typeof WebSocket === "undefined" },
  async () => {
    const { emitRealtimeEvent } = await import("../src/lib/realtime.ts");
    const adminSocket = await connectRealtimeSocket(adminAccessJwt);
    const workerSocket = await connectRealtimeSocket(workerAccessJwt);

    try {
      const adminMessage = waitForRealtimeEvent(adminSocket, "activity:created", 1000);
      const workerMessage = waitForRealtimeEvent(workerSocket, "activity:created", 250);

      const payload = {
        id: personalTodoActivityId,
        entityType: "schedule_item",
        entityId: personalTodoId,
        action: "created",
        metadata: {
          description: "Created schedule item Admin Private Todo",
          jobId,
          scheduleItemId: personalTodoId,
          current: { title: "Admin Private Todo" },
        },
      };

      emitRealtimeEvent("activity:created", payload, jobId);

      assert.equal(await workerMessage, null);
      assert.deepEqual(await adminMessage, payload);
    } finally {
      adminSocket.close();
      workerSocket.close();
    }
  },
);

function connectRealtimeSocket(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/socket.io/?EIO=4&transport=websocket`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out connecting realtime socket"));
    }, 1000);

    socket.addEventListener("message", (event) => {
      const data = String(event.data);
      if (data.startsWith("0")) {
        socket.send(`40${JSON.stringify({ token, jobId })}`);
        return;
      }

      if (data.startsWith("40")) {
        clearTimeout(timeout);
        resolve(socket);
        return;
      }

      if (data === "2") {
        socket.send("3");
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Realtime socket error"));
    });
  });
}

function waitForRealtimeEvent(
  socket: WebSocket,
  eventName: string,
  timeoutMs: number,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      const data = String(event.data);
      if (data === "2") {
        socket.send("3");
        return;
      }

      if (!data.startsWith("42")) {
        return;
      }

      const parsed = JSON.parse(data.slice(2)) as [string, unknown];
      if (parsed[0] !== eventName) {
        return;
      }

      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(parsed[1]);
    }

    socket.addEventListener("message", onMessage);
  });
}
