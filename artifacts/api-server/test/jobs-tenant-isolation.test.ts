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
const orgAClientId = crypto.randomUUID();
const orgBClientId = crypto.randomUUID();
const orgAJobId = crypto.randomUUID();
const orgBJobId = crypto.randomUUID();
const createdJobIds: string[] = [];

function jsonHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

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
    activityLog,
    clients,
    jobs,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Jobs Tenant A ${runId}`,
      slug: `jobs-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Jobs Tenant B ${runId}`,
      slug: `jobs-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `jobs-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Jobs Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `jobs-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Jobs Tenant B Admin",
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

  await db.insert(clients).values([
    {
      id: orgAClientId,
      organizationId: orgAId,
      companyName: `Jobs Tenant A Client ${runId}`,
      createdBy: orgAAdminId,
    },
    {
      id: orgBClientId,
      organizationId: orgBId,
      companyName: `Jobs Tenant B Client ${runId}`,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(jobs).values([
    {
      id: orgAJobId,
      organizationId: orgAId,
      title: `Jobs Tenant A Job ${runId}`,
      clientId: orgAClientId,
      createdBy: orgAAdminId,
    },
    {
      id: orgBJobId,
      organizationId: orgBId,
      title: `Jobs Tenant B Job ${runId}`,
      clientId: orgBClientId,
      createdBy: orgBAdminId,
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `jobs-admin-a-${runId}@tenant.local`,
    fullName: "Jobs Tenant A Admin",
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
    activityLog,
    clients,
    folders,
    jobAssignees,
    jobs,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    const allJobIds = [orgAJobId, orgBJobId, ...createdJobIds];
    await db.delete(activityLog).where(inArray(activityLog.entityId, allJobIds));
    await db.delete(folders).where(inArray(folders.jobId, allJobIds));
    await db.delete(jobAssignees).where(inArray(jobAssignees.jobId, allJobIds));
    await db.delete(jobs).where(inArray(jobs.id, allJobIds));
    await db.delete(clients).where(inArray(clients.id, [orgAClientId, orgBClientId]));
    await db
      .delete(organizationMemberships)
      .where(inArray(organizationMemberships.organizationId, [orgAId, orgBId]));
    await db.delete(users).where(inArray(users.id, [orgAAdminId, orgBAdminId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  } finally {
    await pool.end();
  }
});

test("job list and detail routes are scoped to the active organization", async () => {
  const listResponse = await fetch(`${baseUrl}/jobs`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(listResponse.status, 200);
  const listBody = (await listResponse.json()) as {
    jobs: Array<{ id: string; title: string; clientName: string | null }>;
  };
  assert.ok(listBody.jobs.some((job) => job.id === orgAJobId));
  assert.equal(listBody.jobs.some((job) => job.id === orgBJobId), false);

  const foreignDetail = await fetch(`${baseUrl}/jobs/${orgBJobId}`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignDetail.status, 404);

  const searchResponse = await fetch(
    `${baseUrl}/search?q=${encodeURIComponent("Jobs Tenant")}`,
    { headers: { authorization: `Bearer ${orgAAdminToken}` } },
  );
  assert.equal(searchResponse.status, 200);
  const searchBody = (await searchResponse.json()) as {
    results: Array<{ id: string; type: string }>;
  };
  assert.ok(searchBody.results.some((result) => result.id === orgAJobId));
  assert.equal(searchBody.results.some((result) => result.id === orgBJobId), false);
});

test("job create stamps organization and rejects foreign clients", async () => {
  const foreignClientResponse = await fetch(`${baseUrl}/jobs`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      title: `Foreign Client Job ${runId}`,
      clientId: orgBClientId,
    }),
  });
  assert.equal(foreignClientResponse.status, 400);

  const createResponse = await fetch(`${baseUrl}/jobs`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      title: `Created Tenant Job ${runId}`,
      clientId: orgAClientId,
    }),
  });
  assert.equal(createResponse.status, 201);
  const createBody = (await createResponse.json()) as {
    job: { id: string; organizationId?: string | null };
  };
  createdJobIds.push(createBody.job.id);

  const { db } = await import("@workspace/db");
  const { activityLog, folders, jobs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [job] = await db
    .select({ organizationId: jobs.organizationId })
    .from(jobs)
    .where(eq(jobs.id, createBody.job.id))
    .limit(1);
  assert.equal(job?.organizationId, orgAId);

  const systemFolders = await db
    .select({ organizationId: folders.organizationId })
    .from(folders)
    .where(eq(folders.jobId, createBody.job.id));
  assert.ok(systemFolders.length > 0);
  assert.ok(systemFolders.every((folder) => folder.organizationId === orgAId));

  const activityRows = await db
    .select({ organizationId: activityLog.organizationId })
    .from(activityLog)
    .where(eq(activityLog.entityId, createBody.job.id));
  assert.ok(activityRows.length > 0);
  assert.ok(activityRows.every((row) => row.organizationId === orgAId));
});
