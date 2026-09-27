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
let verificationToken = "";

const runId = crypto.randomUUID();
const email = `owner-${runId}@onboarding.local`;
const organizationName = `SlabPlan Onboarding ${runId}`;
const duplicateOrganizationName = `SlabPlan Duplicate ${runId}`;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY = "a".repeat(64);
  process.env.REGISTER_IP_MAX = "100";
  const { pool } = await import("@workspace/db");
  await pool.query("DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'auth:security:%'");
  await pool.query("DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'auth:login:ip:%'");
  const { __setEmailSenderForTests } = await import("../src/lib/email.ts");
  __setEmailSenderForTests({ send: async ({ text }) => {
    verificationToken = /#token=([a-f0-9]{64})/.exec(text)?.[1] ?? "";
    return { id: "test-verification" };
  } });

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
  const {
    organizationMemberships,
    organizations,
    personalAccessTokens,
    users,
  } = await import("@workspace/db/schema");
  const { eq, inArray } = await import("drizzle-orm");

  try {
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    const userIds = userRows.map((row) => row.id);
    if (userIds.length > 0) {
      await db
        .delete(personalAccessTokens)
        .where(inArray(personalAccessTokens.userId, userIds));
      await db
        .delete(organizationMemberships)
        .where(inArray(organizationMemberships.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }

    const orgRows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        inArray(organizations.name, [
          organizationName,
          duplicateOrganizationName,
        ]),
      );
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
    accepted_terms_version: "2026-08-19",
    accepted_privacy_version: "2026-08-19",
  };
}

test("public signup requires email verification and MFA before subscription checkout", async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(signupPayload()),
  });

  assert.equal(response.status, 201);
  const pending = await response.json();
  assert.equal(pending.verificationRequired, true);
  assert.equal(pending.emailSent, true);
  assert.equal(pending.email, email);
  assert.equal(pending.accessToken, undefined);
  assert.ok(verificationToken);
  assert.ok(response.headers.get("set-cookie")?.includes("Expires="));

  async function post(path: string, payload: unknown) {
    return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" }, body: JSON.stringify(payload) });
  }
  const unverified = await post("/auth/login", { email, password: signupPayload().password });
  const unverifiedBody = await unverified.json();
  assert.equal(unverifiedBody.verificationRequired, true);
  assert.equal(unverifiedBody.accessToken, undefined);
  assert.equal((await post("/auth/verify-email", { token: verificationToken })).status, 200);
  assert.equal((await post("/auth/verify-email", { token: verificationToken })).status, 400, "email links cannot be replayed");
  const login = await post("/auth/login", { email, password: signupPayload().password });
  const challenge = await login.json();
  assert.equal(challenge.setupRequired, true);
  assert.equal(challenge.accessToken, undefined);
  assert.equal((await fetch(`${baseUrl}/billing/status`, { headers: { authorization: `Bearer ${challenge.challengeToken}` } })).status, 401);
  const enrollment = await (await post("/auth/security/enroll", challenge)).json();
  assert.match(enrollment.uri, /^otpauth:\/\/totp\//);
  const { generate } = await import("otplib");
  const code = await generate({ secret: enrollment.secret });
  const activated = await post("/auth/security/confirm", { challengeToken: challenge.challengeToken, code });
  assert.equal(activated.status, 200);
  const body = await activated.json();
  assert.ok(body.accessToken);
  assert.equal(body.user.email, email);
  assert.equal(body.user.role, "admin");
  assert.equal(body.recoveryCodes.length, 10);
  assert.equal((await post("/auth/security/confirm", { challengeToken: challenge.challengeToken, code })).status, 401);

  const { db } = await import("@workspace/db");
  const { organizationMemberships, organizations, users } =
    await import("@workspace/db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const [organization] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
    })
    .from(organizations)
    .where(eq(organizations.id, body.user.defaultOrganizationId!))
    .limit(1);
  assert.equal(organization?.name, organizationName);
  assert.match(organization?.slug ?? "", /^slabplan-onboarding-/);
  assert.equal(organization?.status, "trialing");

  const [user] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
      termsAcceptedAt: users.termsAcceptedAt,
      termsVersion: users.termsVersion,
      privacyAcceptedAt: users.privacyAcceptedAt,
      privacyVersion: users.privacyVersion,
    })
    .from(users)
    .where(eq(users.id, body.user.id))
    .limit(1);
  assert.equal(user?.defaultOrganizationId, organization?.id);
  assert.ok(user?.termsAcceptedAt);
  assert.equal(user?.termsVersion, "2026-08-19");
  assert.ok(user?.privacyAcceptedAt);
  assert.equal(user?.privacyVersion, "2026-08-19");

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

  const authHeaders = {
    authorization: `Bearer ${body.accessToken}`,
    "x-requested-with": "XMLHttpRequest",
  };
  const billingResponse = await fetch(`${baseUrl}/billing/status`, {
    headers: authHeaders,
  });
  assert.equal(billingResponse.status, 200);
  const billing = (await billingResponse.json()) as {
    organization: {
      requiresSubscription: boolean;
      accessGranted: boolean;
    };
  };
  assert.equal(billing.organization.requiresSubscription, true);
  assert.equal(billing.organization.accessGranted, false);

  const dashboardResponse = await fetch(`${baseUrl}/dashboard`, {
    headers: authHeaders,
  });
  assert.equal(dashboardResponse.status, 402);
  const dashboardProblem = (await dashboardResponse.json()) as {
    type?: string;
    status?: number;
  };
  assert.equal(dashboardProblem.status, 402);
  assert.match(dashboardProblem.type ?? "", /subscription-required/);
});

test("public signup rejects stale or missing legal acceptance", async () => {
  const payload = signupPayload(`Missing Legal ${runId}`);
  delete (payload as Partial<typeof payload>).accepted_terms_version;

  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 400);
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
