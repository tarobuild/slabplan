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
const orgADeleteClientId = crypto.randomUUID();
const orgADeleteJobId = crypto.randomUUID();
const createdClientIds: string[] = [];
const createdContactIds: string[] = [];

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
      name: `Tenant A ${runId}`,
      slug: `tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Tenant B ${runId}`,
      slug: `tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `admin-a-${runId}@clients-tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `admin-b-${runId}@clients-tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Tenant B Admin",
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
      companyName: `Tenant A Client ${runId}`,
      createdBy: orgAAdminId,
    },
    {
      id: orgBClientId,
      organizationId: orgBId,
      companyName: `Tenant B Client ${runId}`,
      createdBy: orgBAdminId,
    },
    {
      id: orgADeleteClientId,
      organizationId: orgAId,
      companyName: `Tenant A Delete Client ${runId}`,
      createdBy: orgAAdminId,
    },
  ]);

  await db.insert(jobs).values({
    id: orgADeleteJobId,
    organizationId: orgAId,
    title: `Tenant A Job ${runId}`,
    clientId: orgADeleteClientId,
    createdBy: orgAAdminId,
  });

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `admin-a-${runId}@clients-tenant.local`,
    fullName: "Tenant A Admin",
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
    clientContacts,
    clients,
    jobs,
    organizationMemberships,
    organizations,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    await db.delete(clientContacts).where(inArray(clientContacts.id, createdContactIds));
    await db.delete(jobs).where(inArray(jobs.id, [orgADeleteJobId]));
    await db
      .delete(clients)
      .where(inArray(clients.id, [
        orgAClientId,
        orgBClientId,
        orgADeleteClientId,
        ...createdClientIds,
      ]));
    await db
      .delete(organizationMemberships)
      .where(inArray(organizationMemberships.organizationId, [orgAId, orgBId]));
    await db.delete(users).where(inArray(users.id, [orgAAdminId, orgBAdminId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  } finally {
    await pool.end();
  }
});

test("client list and detail routes are scoped to the active organization", async () => {
  const listResponse = await fetch(`${baseUrl}/clients?status=all`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(listResponse.status, 200);
  const listBody = (await listResponse.json()) as {
    clients: Array<{ id: string; companyName: string }>;
  };
  assert.ok(listBody.clients.some((client) => client.id === orgAClientId));
  assert.equal(
    listBody.clients.some((client) => client.id === orgBClientId),
    false,
  );

  const foreignDetail = await fetch(`${baseUrl}/clients/${orgBClientId}`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignDetail.status, 404);

  const foreignSearch = await fetch(
    `${baseUrl}/search?q=${encodeURIComponent(`Tenant B Client ${runId}`)}`,
    { headers: { authorization: `Bearer ${orgAAdminToken}` } },
  );
  assert.equal(foreignSearch.status, 200);
  const foreignSearchBody = (await foreignSearch.json()) as {
    results: Array<{ id: string; type: string }>;
  };
  assert.equal(
    foreignSearchBody.results.some((result) => result.id === orgBClientId),
    false,
  );
});

test("client and contact creates stamp the active organization", async () => {
  const createResponse = await fetch(`${baseUrl}/clients`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({ companyName: `Tenant A Created ${runId}` }),
  });
  assert.equal(createResponse.status, 201);
  const createBody = (await createResponse.json()) as {
    client: { id: string; organizationId: string | null };
  };
  createdClientIds.push(createBody.client.id);
  assert.equal(createBody.client.organizationId, orgAId);

  const contactResponse = await fetch(`${baseUrl}/clients/${orgAClientId}/contacts`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({ firstName: "Tenant", lastName: "Contact" }),
  });
  assert.equal(contactResponse.status, 201);
  const contactBody = (await contactResponse.json()) as {
    contact: { id: string; organizationId: string | null };
  };
  createdContactIds.push(contactBody.contact.id);
  assert.equal(contactBody.contact.organizationId, orgAId);
});

test("tenant-scoped client deletion reassigns live jobs to a tenant Unknown client", async () => {
  const deleteResponse = await fetch(`${baseUrl}/clients/${orgADeleteClientId}`, {
    method: "DELETE",
    headers: jsonHeaders(orgAAdminToken),
  });
  assert.equal(deleteResponse.status, 200);

  const { db } = await import("@workspace/db");
  const { clients, jobs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [job] = await db
    .select({ clientId: jobs.clientId })
    .from(jobs)
    .where(eq(jobs.id, orgADeleteJobId))
    .limit(1);

  assert.ok(job?.clientId);

  const [unknownClient] = await db
    .select({
      id: clients.id,
      organizationId: clients.organizationId,
      companyName: clients.companyName,
    })
    .from(clients)
    .where(eq(clients.id, job.clientId))
    .limit(1);

  assert.equal(unknownClient?.organizationId, orgAId);
  assert.equal(unknownClient?.companyName, "Unknown client");
});
