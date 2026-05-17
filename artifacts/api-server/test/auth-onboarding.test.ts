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

const runId = crypto.randomUUID();
const email = `owner-${runId}@onboarding.local`;
const organizationName = `Stone Track Onboarding ${runId}`;
const duplicateOrganizationName = `Stone Track Duplicate ${runId}`;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";

  const { default: app, prepareApp } = await import("../src/app.ts");
  await prepareApp();

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
  const { organizationMemberships, organizations, personalAccessTokens, users } =
    await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    const userIds = userRows.map((row) => row.id);
    if (userIds.length > 0) {
      await db.delete(personalAccessTokens).where(inArray(personalAccessTokens.userId, userIds));
      await db.delete(organizationMemberships).where(inArray(organizationMemberships.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }

    const orgRows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.name, [organizationName, duplicateOrganizationName]));
    const orgIds = orgRows.map((row) => row.id);
    if (orgIds.length > 0) {
      await db.delete(organizations).where(inArray(organizations.id, orgIds));
    }
  } finally {
    await pool.end();
  }
});

function signupPayload(name = organizationName) {
  return {
    organization_name: name,
    full_name: "Onboarding Owner",
    email,
    password: "OnboardingPass#123",
  };
}

test("public signup creates an organization, owner membership, and signed-in admin", async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(signupPayload()),
  });

  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    accessToken?: string;
    user: {
      id: string;
      email: string;
      role: string;
      defaultOrganizationId?: string | null;
    };
  };
  assert.ok(body.accessToken);
  assert.equal(body.user.email, email);
  assert.equal(body.user.role, "admin");
  assert.ok(body.user.defaultOrganizationId);

  const { db } = await import("@workspace/db");
  const { organizationMemberships, organizations, users } = await import("@workspace/db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, body.user.defaultOrganizationId!))
    .limit(1);
  assert.equal(organization?.name, organizationName);
  assert.match(organization?.slug ?? "", /^stone-track-onboarding-/);
  assert.equal(organization?.status, "trialing");

  const [user] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, body.user.id))
    .limit(1);
  assert.equal(user?.defaultOrganizationId, organization?.id);

  const [membership] = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.role,
      isDefault: organizationMemberships.isDefault,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, body.user.id),
        eq(organizationMemberships.organizationId, organization!.id),
        isNull(organizationMemberships.deletedAt),
      ),
    )
    .limit(1);
  assert.equal(membership?.role, "owner");
  assert.equal(membership?.isDefault, true);
});

test("duplicate signup email does not leave an orphan organization", async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(signupPayload(duplicateOrganizationName)),
  });

  assert.equal(response.status, 409);

  const { db } = await import("@workspace/db");
  const { organizations } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, duplicateOrganizationName));
  assert.equal(rows.length, 0);
});
