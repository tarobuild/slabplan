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
const orgAJobId = crypto.randomUUID();
const orgBJobId = crypto.randomUUID();
const createdAreaIds: string[] = [];
const createdLineItemIds: string[] = [];

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
  const { jobs, organizationMemberships, organizations, users } = await import(
    "@workspace/db/schema"
  );

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Financials Tenant A ${runId}`,
      slug: `financials-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Financials Tenant B ${runId}`,
      slug: `financials-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `financials-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Financials Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `financials-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Financials Tenant B Admin",
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

  await db.insert(jobs).values([
    {
      id: orgAJobId,
      organizationId: orgAId,
      title: `Financials Tenant A Job ${runId}`,
      createdBy: orgAAdminId,
    },
    {
      id: orgBJobId,
      organizationId: orgBId,
      title: `Financials Tenant B Job ${runId}`,
      createdBy: orgBAdminId,
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `financials-admin-a-${runId}@tenant.local`,
    fullName: "Financials Tenant A Admin",
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
    financialTrackers,
    jobs,
    organizationMemberships,
    organizations,
    sovAreas,
    sovLineItems,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    if (createdLineItemIds.length > 0) {
      await db.delete(sovLineItems).where(inArray(sovLineItems.id, createdLineItemIds));
    }
    if (createdAreaIds.length > 0) {
      await db.delete(sovAreas).where(inArray(sovAreas.id, createdAreaIds));
    }
    await db.delete(financialTrackers).where(inArray(financialTrackers.jobId, [orgAJobId, orgBJobId]));
    await db.delete(jobs).where(inArray(jobs.id, [orgAJobId, orgBJobId]));
    await db
      .delete(organizationMemberships)
      .where(inArray(organizationMemberships.organizationId, [orgAId, orgBId]));
    await db.delete(users).where(inArray(users.id, [orgAAdminId, orgBAdminId]));
    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  } finally {
    await pool.end();
  }
});

test("admin financials access and writes are scoped to the active organization", async () => {
  const foreignFinancials = await fetch(`${baseUrl}/jobs/${orgBJobId}/financials`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(foreignFinancials.status, 404);

  const ownFinancials = await fetch(`${baseUrl}/jobs/${orgAJobId}/financials`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(ownFinancials.status, 200);

  const areaResponse = await fetch(`${baseUrl}/jobs/${orgAJobId}/financials/areas`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({ name: `Tenant Area ${runId}` }),
  });
  assert.equal(areaResponse.status, 201);
  const areaBody = (await areaResponse.json()) as {
    area: { id: string; organizationId: string | null };
  };
  createdAreaIds.push(areaBody.area.id);
  assert.equal(areaBody.area.organizationId, orgAId);

  const lineItemResponse = await fetch(`${baseUrl}/jobs/${orgAJobId}/financials/line-items`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      areaId: areaBody.area.id,
      description: `Tenant Line ${runId}`,
      scheduledValueCents: 12_500,
    }),
  });
  assert.equal(lineItemResponse.status, 201);
  const lineItemBody = (await lineItemResponse.json()) as {
    lineItem: { id: string; organizationId: string | null };
  };
  createdLineItemIds.push(lineItemBody.lineItem.id);
  assert.equal(lineItemBody.lineItem.organizationId, orgAId);

  const { db } = await import("@workspace/db");
  const { financialTrackers } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [tracker] = await db
    .select({ organizationId: financialTrackers.organizationId })
    .from(financialTrackers)
    .where(eq(financialTrackers.jobId, orgAJobId))
    .limit(1);
  assert.equal(tracker?.organizationId, orgAId);
});
