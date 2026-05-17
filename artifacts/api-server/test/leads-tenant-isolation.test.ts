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
const orgALeadId = crypto.randomUUID();
const orgBLeadId = crypto.randomUUID();
const orgAConvertLeadId = crypto.randomUUID();
const createdLeadIds: string[] = [];
const createdJobIds: string[] = [];
const createdClientIds: string[] = [];

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
    leads,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Leads Tenant A ${runId}`,
      slug: `leads-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Leads Tenant B ${runId}`,
      slug: `leads-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `leads-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Leads Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `leads-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Leads Tenant B Admin",
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
      companyName: `Leads Tenant A Client ${runId}`,
      createdBy: orgAAdminId,
    },
    {
      id: orgBClientId,
      organizationId: orgBId,
      companyName: `Leads Tenant B Client ${runId}`,
      createdBy: orgBAdminId,
    },
  ]);

  await db.insert(leads).values([
    {
      id: orgALeadId,
      organizationId: orgAId,
      title: `Leads Tenant A Lead ${runId}`,
      status: "open",
      createdBy: orgAAdminId,
    },
    {
      id: orgBLeadId,
      organizationId: orgBId,
      title: `Leads Tenant B Lead ${runId}`,
      status: "open",
      createdBy: orgBAdminId,
    },
    {
      id: orgAConvertLeadId,
      organizationId: orgAId,
      title: `Leads Tenant A Convert ${runId}`,
      status: "open",
      createdBy: orgAAdminId,
    },
  ]);

  await db.insert(activityLog).values([
    {
      organizationId: orgAId,
      entityType: "lead",
      entityId: orgALeadId,
      action: "created",
      userId: orgAAdminId,
      metadata: { description: `Created lead ${runId}`, leadId: orgALeadId },
    },
    {
      organizationId: orgBId,
      entityType: "lead",
      entityId: orgBLeadId,
      action: "created",
      userId: orgBAdminId,
      metadata: { description: `Created foreign lead ${runId}`, leadId: orgBLeadId },
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `leads-admin-a-${runId}@tenant.local`,
    fullName: "Leads Tenant A Admin",
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
    leadContacts,
    leadSalespeople,
    leadSources,
    leadTags,
    leads,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    const allLeadIds = [orgALeadId, orgBLeadId, orgAConvertLeadId, ...createdLeadIds];
    await db.delete(activityLog).where(inArray(activityLog.entityId, [...allLeadIds, ...createdJobIds]));
    if (createdJobIds.length > 0) {
      await db.delete(folders).where(inArray(folders.jobId, createdJobIds));
      await db.delete(jobAssignees).where(inArray(jobAssignees.jobId, createdJobIds));
      await db.delete(jobs).where(inArray(jobs.id, createdJobIds));
    }
    await db.delete(leadContacts).where(inArray(leadContacts.leadId, allLeadIds));
    await db.delete(leadSalespeople).where(inArray(leadSalespeople.leadId, allLeadIds));
    await db.delete(leadTags).where(inArray(leadTags.leadId, allLeadIds));
    await db.delete(leadSources).where(inArray(leadSources.leadId, allLeadIds));
    await db.delete(leads).where(inArray(leads.id, allLeadIds));
    await db.delete(clients).where(inArray(clients.id, [orgAClientId, orgBClientId, ...createdClientIds]));
    await db
      .delete(organizationMemberships)
      .where(inArray(organizationMemberships.organizationId, [orgAId, orgBId]));
    await db.delete(users).where(inArray(users.id, [orgAAdminId, orgBAdminId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  } finally {
    await pool.end();
  }
});

test("lead list, detail, and search routes are scoped to the active organization", async () => {
  const listResponse = await fetch(`${baseUrl}/leads`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(listResponse.status, 200);
  const listBody = (await listResponse.json()) as {
    leads: Array<{ id: string; title: string }>;
  };
  assert.ok(listBody.leads.some((lead) => lead.id === orgALeadId));
  assert.equal(listBody.leads.some((lead) => lead.id === orgBLeadId), false);

  const foreignDetail = await fetch(`${baseUrl}/leads/${orgBLeadId}`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignDetail.status, 404);

  const searchResponse = await fetch(
    `${baseUrl}/search?q=${encodeURIComponent("Leads Tenant")}`,
    { headers: { authorization: `Bearer ${orgAAdminToken}` } },
  );
  assert.equal(searchResponse.status, 200);
  const searchBody = (await searchResponse.json()) as {
    results: Array<{ id: string; type: string }>;
  };
  assert.ok(searchBody.results.some((result) => result.id === orgALeadId));
  assert.equal(searchBody.results.some((result) => result.id === orgBLeadId), false);

  const activityResponse = await fetch(`${baseUrl}/activity?entityType=lead&entityId=${orgALeadId}`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(activityResponse.status, 200);
  const activityBody = (await activityResponse.json()) as {
    data: Array<{ entityId: string }>;
  };
  assert.ok(activityBody.data.some((entry) => entry.entityId === orgALeadId));

  const foreignActivityResponse = await fetch(
    `${baseUrl}/activity?entityType=lead&entityId=${orgBLeadId}`,
    { headers: { authorization: `Bearer ${orgAAdminToken}` } },
  );
  assert.equal(foreignActivityResponse.status, 200);
  const foreignActivityBody = (await foreignActivityResponse.json()) as {
    data: Array<{ entityId: string }>;
  };
  assert.equal(foreignActivityBody.data.length, 0);
});

test("lead create stamps organization on lead and child rows", async () => {
  const createResponse = await fetch(`${baseUrl}/leads`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      title: `Created Tenant Lead ${runId}`,
      salespeople: [orgAAdminId],
      tags: ["tenant"],
      sources: ["web"],
    }),
  });
  assert.equal(createResponse.status, 201);
  const createBody = (await createResponse.json()) as {
    lead: { id: string; title: string };
  };
  createdLeadIds.push(createBody.lead.id);

  const { db } = await import("@workspace/db");
  const { leadSalespeople, leadSources, leadTags, leads } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [lead] = await db
    .select({ organizationId: leads.organizationId })
    .from(leads)
    .where(eq(leads.id, createBody.lead.id))
    .limit(1);
  assert.equal(lead?.organizationId, orgAId);

  const [salesperson] = await db
    .select({ organizationId: leadSalespeople.organizationId })
    .from(leadSalespeople)
    .where(eq(leadSalespeople.leadId, createBody.lead.id))
    .limit(1);
  assert.equal(salesperson?.organizationId, orgAId);

  const [tag] = await db
    .select({ organizationId: leadTags.organizationId })
    .from(leadTags)
    .where(eq(leadTags.leadId, createBody.lead.id))
    .limit(1);
  assert.equal(tag?.organizationId, orgAId);

  const [source] = await db
    .select({ organizationId: leadSources.organizationId })
    .from(leadSources)
    .where(eq(leadSources.leadId, createBody.lead.id))
    .limit(1);
  assert.equal(source?.organizationId, orgAId);
});

test("lead conversion rejects foreign clients and stamps created rows", async () => {
  const foreignClientResponse = await fetch(`${baseUrl}/leads/${orgAConvertLeadId}/convert-to-job`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({ clientId: orgBClientId }),
  });
  assert.equal(foreignClientResponse.status, 404);

  const convertResponse = await fetch(`${baseUrl}/leads/${orgAConvertLeadId}/convert-to-job`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      newClient: {
        companyName: `Converted Tenant Client ${runId}`,
      },
      job: {
        title: `Converted Tenant Job ${runId}`,
      },
    }),
  });
  assert.equal(convertResponse.status, 201);
  const convertBody = (await convertResponse.json()) as {
    job: { id: string; title: string };
  };
  createdJobIds.push(convertBody.job.id);

  const { db } = await import("@workspace/db");
  const { activityLog, clients, jobs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [job] = await db
    .select({ organizationId: jobs.organizationId, clientId: jobs.clientId })
    .from(jobs)
    .where(eq(jobs.id, convertBody.job.id))
    .limit(1);
  assert.equal(job?.organizationId, orgAId);
  if (job?.clientId) createdClientIds.push(job.clientId);

  const [client] = await db
    .select({ organizationId: clients.organizationId })
    .from(clients)
    .where(eq(clients.id, job!.clientId!))
    .limit(1);
  assert.equal(client?.organizationId, orgAId);

  const [activity] = await db
    .select({ organizationId: activityLog.organizationId })
    .from(activityLog)
    .where(eq(activityLog.entityId, orgAConvertLeadId))
    .limit(1);
  assert.equal(activity?.organizationId, orgAId);
});
