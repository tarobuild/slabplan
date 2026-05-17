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
const orgBCrewId = crypto.randomUUID();
const invitedEmails: string[] = [];

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
  process.env.REPLIT_DEV_DOMAIN = "workspace.example.test";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const email = await import("../src/lib/email.ts");
  const { db } = await import("@workspace/db");
  const { organizationMemberships, organizations, users } = await import(
    "@workspace/db/schema"
  );

  email.__setEmailSenderForTests({
    async send() {
      return { id: "tenant-user-test" };
    },
  });

  await prepareApp();

  await db.insert(organizations).values([
    {
      id: orgAId,
      name: `Users Tenant A ${runId}`,
      slug: `users-tenant-a-${runId}`,
      status: "active",
    },
    {
      id: orgBId,
      name: `Users Tenant B ${runId}`,
      slug: `users-tenant-b-${runId}`,
      status: "active",
    },
  ]);

  await db.insert(users).values([
    {
      id: orgAAdminId,
      email: `users-admin-a-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Users Tenant A Admin",
      role: "admin",
      defaultOrganizationId: orgAId,
    },
    {
      id: orgBAdminId,
      email: `users-admin-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Users Tenant B Admin",
      role: "admin",
      defaultOrganizationId: orgBId,
    },
    {
      id: orgBCrewId,
      email: `users-crew-b-${runId}@tenant.local`,
      passwordHash: "test-not-a-real-hash",
      fullName: "Users Tenant B Crew",
      role: "crew_member",
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
    {
      organizationId: orgBId,
      userId: orgBCrewId,
      role: "crew_member",
      isDefault: true,
    },
  ]);

  orgAAdminToken = auth.signAccessToken({
    id: orgAAdminId,
    email: `users-admin-a-${runId}@tenant.local`,
    fullName: "Users Tenant A Admin",
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
    organizationMemberships,
    organizations,
    personalAccessTokens,
    users,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    const seededUserIds = [orgAAdminId, orgBAdminId, orgBCrewId];
    const invitedRows =
      invitedEmails.length > 0
        ? await db
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.email, invitedEmails))
        : [];
    const allUserIds = [...seededUserIds, ...invitedRows.map((row) => row.id)];

    if (allUserIds.length > 0) {
      await db.delete(activityLog).where(inArray(activityLog.entityId, allUserIds));
      await db.delete(personalAccessTokens).where(inArray(personalAccessTokens.userId, allUserIds));
      await db
        .delete(organizationMemberships)
        .where(inArray(organizationMemberships.userId, allUserIds));
      await db.delete(users).where(inArray(users.id, allUserIds));
    }

    await db.delete(organizations).where(inArray(organizations.id, [orgAId, orgBId]));
  } finally {
    await pool.end();
  }
});

test("user administration is scoped to the active organization", async () => {
  const listResponse = await fetch(`${baseUrl}/users?includeInactive=true`, {
    headers: { authorization: `Bearer ${orgAAdminToken}` },
  });
  assert.equal(listResponse.status, 200);
  const listBody = (await listResponse.json()) as { users: Array<{ id: string }> };
  assert.equal(listBody.users.some((user) => user.id === orgAAdminId), true);
  assert.equal(listBody.users.some((user) => user.id === orgBAdminId), false);
  assert.equal(listBody.users.some((user) => user.id === orgBCrewId), false);

  const foreignPatch = await fetch(`${baseUrl}/users/${orgBAdminId}`, {
    method: "PATCH",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({ fullName: "Should Not Update" }),
  });
  assert.equal(foreignPatch.status, 404);

  const foreignReissue = await fetch(`${baseUrl}/users/${orgBAdminId}/invite`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
  });
  assert.equal(foreignReissue.status, 404);

  const inviteEmail = `users-invite-${runId}@tenant.local`;
  invitedEmails.push(inviteEmail);
  const inviteResponse = await fetch(`${baseUrl}/users`, {
    method: "POST",
    headers: jsonHeaders(orgAAdminToken),
    body: JSON.stringify({
      email: inviteEmail,
      fullName: "Users Tenant A Invitee",
      role: "crew_member",
    }),
  });
  assert.equal(inviteResponse.status, 201);
  const inviteBody = (await inviteResponse.json()) as { user: { id: string } };

  const { db } = await import("@workspace/db");
  const { organizationMemberships, users } = await import("@workspace/db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const [invitedUser] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, inviteBody.user.id))
    .limit(1);
  assert.equal(invitedUser?.defaultOrganizationId, orgAId);

  const [membership] = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, inviteBody.user.id),
        isNull(organizationMemberships.deletedAt),
      ),
    )
    .limit(1);
  assert.equal(membership?.organizationId, orgAId);
  assert.equal(membership?.role, "crew_member");
});
