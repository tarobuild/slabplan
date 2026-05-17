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
const orgALeadId = crypto.randomUUID();
const orgBLeadId = crypto.randomUUID();
const orgATrackerId = crypto.randomUUID();
const orgBTrackerId = crypto.randomUUID();
const orgAAreaId = crypto.randomUUID();
const orgBAreaId = crypto.randomUUID();
const orgALineItemId = crypto.randomUUID();
const orgBLineItemId = crypto.randomUUID();
const orgAInvoiceId = crypto.randomUUID();
const orgBInvoiceId = crypto.randomUUID();
const orgAPaymentId = crypto.randomUUID();
const orgBPaymentId = crypto.randomUUID();

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
    clients,
    financialTrackers,
    invoiceLinePayments,
    jobs,
    leads,
    organizationMemberships,
    organizations,
    sovAreas,
    sovLineItems,
    trackerInvoices,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Reports Tenant A ${runId}`,
      slug: `reports-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Reports Tenant B ${runId}`,
      slug: `reports-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `reports-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Reports Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `reports-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Reports Tenant B Admin",
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
      companyName: `Reports Tenant A Client ${runId}`,
      createdBy: orgAAdminId,
    },
    {
      id: orgBClientId,
      organizationId: orgBId,
      companyName: `Reports Tenant B Client ${runId}`,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(jobs).values([
    {
      id: orgAJobId,
      organizationId: orgAId,
      title: `Reports Tenant A Job ${runId}`,
      status: "open",
      clientId: orgAClientId,
      jobType: "kitchen_countertops",
      createdBy: orgAAdminId,
    },
    {
      id: orgBJobId,
      organizationId: orgBId,
      title: `Reports Tenant B Job ${runId}`,
      status: "closed",
      clientId: orgBClientId,
      jobType: "bathrooms",
      createdBy: orgBAdminId,
    },
  ]);

  const now = new Date();
  const invoiceDate = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

  await db.insert(financialTrackers).values([
    {
      id: orgATrackerId,
      organizationId: orgAId,
      jobId: orgAJobId,
      createdBy: orgAAdminId,
    },
    {
      id: orgBTrackerId,
      organizationId: orgBId,
      jobId: orgBJobId,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(sovAreas).values([
    { id: orgAAreaId, organizationId: orgAId, trackerId: orgATrackerId, name: "Area A" },
    { id: orgBAreaId, organizationId: orgBId, trackerId: orgBTrackerId, name: "Area B" },
  ]);

  await db.insert(sovLineItems).values([
    {
      id: orgALineItemId,
      organizationId: orgAId,
      areaId: orgAAreaId,
      description: "Line A",
      scheduledValueCents: 60_000,
    },
    {
      id: orgBLineItemId,
      organizationId: orgBId,
      areaId: orgBAreaId,
      description: "Line B",
      scheduledValueCents: 90_000,
    },
  ]);

  await db.insert(trackerInvoices).values([
    {
      id: orgAInvoiceId,
      organizationId: orgAId,
      trackerId: orgATrackerId,
      invoiceNumber: `A-${runId}`,
      invoiceDate,
      totalCents: 60_000,
      appliedAt: now,
      createdBy: orgAAdminId,
    },
    {
      id: orgBInvoiceId,
      organizationId: orgBId,
      trackerId: orgBTrackerId,
      invoiceNumber: `B-${runId}`,
      invoiceDate,
      totalCents: 90_000,
      appliedAt: now,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(invoiceLinePayments).values([
    {
      id: orgAPaymentId,
      organizationId: orgAId,
      invoiceId: orgAInvoiceId,
      lineItemId: orgALineItemId,
      amountCents: 10_000,
      createdAt: now,
    },
    {
      id: orgBPaymentId,
      organizationId: orgBId,
      invoiceId: orgBInvoiceId,
      lineItemId: orgBLineItemId,
      amountCents: 20_000,
      createdAt: now,
    },
  ]);

  await db.insert(leads).values([
    {
      id: orgALeadId,
      organizationId: orgAId,
      title: `Reports Tenant A Lead ${runId}`,
      status: "open",
      createdBy: orgAAdminId,
    },
    {
      id: orgBLeadId,
      organizationId: orgBId,
      title: `Reports Tenant B Lead ${runId}`,
      status: "won",
      createdBy: orgBAdminId,
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `reports-admin-a-${runId}@tenant.local`,
    fullName: "Reports Tenant A Admin",
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
    clients,
    financialTrackers,
    invoiceLinePayments,
    jobs,
    leads,
    organizationMemberships,
    organizations,
    sovAreas,
    sovLineItems,
    trackerInvoices,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    await db.delete(invoiceLinePayments).where(inArray(invoiceLinePayments.id, [orgAPaymentId, orgBPaymentId]));
    await db.delete(trackerInvoices).where(inArray(trackerInvoices.id, [orgAInvoiceId, orgBInvoiceId]));
    await db.delete(sovLineItems).where(inArray(sovLineItems.id, [orgALineItemId, orgBLineItemId]));
    await db.delete(sovAreas).where(inArray(sovAreas.id, [orgAAreaId, orgBAreaId]));
    await db.delete(financialTrackers).where(inArray(financialTrackers.id, [orgATrackerId, orgBTrackerId]));
    await db.delete(leads).where(inArray(leads.id, [orgALeadId, orgBLeadId]));
    await db.delete(jobs).where(inArray(jobs.id, [orgAJobId, orgBJobId]));
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

function authHeaders() {
  return { authorization: `Bearer ${orgAAdminToken}` };
}

test("report aggregations are scoped to the active organization", async () => {
  const jobsResponse = await fetch(`${baseUrl}/reports/jobs-by-stage`, {
    headers: authHeaders(),
  });
  assert.equal(jobsResponse.status, 200);
  const jobsBody = (await jobsResponse.json()) as {
    rows: Array<{ clientId: string | null; open: number; closed: number; total: number }>;
  };
  assert.deepEqual(jobsBody.rows.find((row) => row.clientId === orgAClientId), {
    clientId: orgAClientId,
    clientName: `Reports Tenant A Client ${runId}`,
    open: 1,
    closed: 0,
    archived: 0,
    total: 1,
  });
  assert.equal(jobsBody.rows.some((row) => row.clientId === orgBClientId), false);

  const pipelineResponse = await fetch(`${baseUrl}/reports/pipeline`, {
    headers: authHeaders(),
  });
  assert.equal(pipelineResponse.status, 200);
  const pipelineBody = (await pipelineResponse.json()) as {
    funnel: Array<{ stage: string; count: number }>;
    won: number;
    lost: number;
  };
  assert.equal(pipelineBody.funnel.find((row) => row.stage === "open")?.count, 1);
  assert.equal(pipelineBody.funnel.find((row) => row.stage === "won")?.count, 0);
  assert.equal(pipelineBody.won, 0);
  assert.equal(pipelineBody.lost, 0);

  const agingResponse = await fetch(`${baseUrl}/reports/ar-aging`, {
    headers: authHeaders(),
  });
  assert.equal(agingResponse.status, 200);
  const agingBody = (await agingResponse.json()) as {
    rows: Array<{ clientId: string | null; total: number }>;
  };
  assert.equal(agingBody.rows.find((row) => row.clientId === orgAClientId)?.total, 50_000);
  assert.equal(agingBody.rows.some((row) => row.clientId === orgBClientId), false);

  const revenueResponse = await fetch(`${baseUrl}/reports/revenue`, {
    headers: authHeaders(),
  });
  assert.equal(revenueResponse.status, 200);
  const revenueBody = (await revenueResponse.json()) as {
    months: Array<{
      billedCents: number;
      collectedCents: number;
      topJobs: Array<{ jobId: string; amountCents: number }>;
    }>;
  };
  const revenueMonth = revenueBody.months.find((month) =>
    month.topJobs.some((job) => job.jobId === orgAJobId),
  );
  assert.ok(revenueMonth);
  assert.equal(revenueMonth.billedCents, 60_000);
  assert.equal(revenueMonth.collectedCents, 10_000);
  assert.equal(revenueMonth.topJobs.some((job) => job.jobId === orgBJobId), false);

  const daysResponse = await fetch(`${baseUrl}/reports/days-to-payment`, {
    headers: authHeaders(),
  });
  assert.equal(daysResponse.status, 200);
  const daysBody = (await daysResponse.json()) as {
    byClient: Array<{ id: string; count: number }>;
    byJobType: Array<{ id: string; count: number }>;
  };
  assert.equal(daysBody.byClient.find((row) => row.id === orgAClientId)?.count, 1);
  assert.equal(daysBody.byClient.some((row) => row.id === orgBClientId), false);
  assert.equal(daysBody.byJobType.find((row) => row.id === "kitchen_countertops")?.count, 1);
  assert.equal(daysBody.byJobType.some((row) => row.id === "bathrooms"), false);
});
