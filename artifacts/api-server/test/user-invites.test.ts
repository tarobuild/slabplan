import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

let adminAccessJwt: string;
let crewAccessJwt: string;

const adminUserId = crypto.randomUUID();
const crewUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@user-invites-test.local`;
const crewEmail = `crew-${crewUserId}@user-invites-test.local`;

// Track every email we touch so the `after` hook can scrub the shared
// test database back to a clean state regardless of which path each
// test took (created/accepted/deactivated).
const emailsToCleanup = new Set<string>([adminEmail, crewEmail]);

function trackInvitedEmail(email: string) {
  emailsToCleanup.add(email.toLowerCase());
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const bcryptModule = (await import("bcrypt")).default;
  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");

  await prepareApp();

  // Seed an admin (Cesar-style) and a crew member with real password
  // hashes so the login endpoint can authenticate them later.
  const adminPasswordHash = await bcryptModule.hash("Admin#TestPass1", 10);
  const crewPasswordHash = await bcryptModule.hash("Crew#TestPass1", 10);

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: adminPasswordHash,
      fullName: "ZZZ Invite-Test Admin",
      role: "admin",
    },
    {
      id: crewUserId,
      email: crewEmail,
      passwordHash: crewPasswordHash,
      fullName: "ZZZ Invite-Test Crew",
      role: "crew_member",
    },
  ]);

  const stamp = new Date();

  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Invite-Test Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });

  crewAccessJwt = auth.signAccessToken({
    id: crewUserId,
    email: crewEmail,
    fullName: "ZZZ Invite-Test Crew",
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
  const { users, idempotencyKeys } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    const allEmails = Array.from(emailsToCleanup);
    if (allEmails.length > 0) {
      await db
        .delete(idempotencyKeys)
        .where(inArray(idempotencyKeys.userId, [adminUserId, crewUserId]));
      await db.delete(users).where(inArray(users.email, allEmails));
    }
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

function adminHeaders(extra?: Record<string, string>) {
  return {
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    authorization: `Bearer ${adminAccessJwt}`,
    ...extra,
  };
}

function crewHeaders(extra?: Record<string, string>) {
  return {
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    authorization: `Bearer ${crewAccessJwt}`,
    ...extra,
  };
}

const PUBLIC_HEADERS = {
  "content-type": "application/json",
  "x-requested-with": "XMLHttpRequest",
} as const;

test("only admins can invite users; crew members get 403", async () => {
  const inviteeEmail = `invitee-${crypto.randomUUID()}@user-invites-test.local`;
  trackInvitedEmail(inviteeEmail);

  const denied = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: crewHeaders(),
    body: JSON.stringify({
      email: inviteeEmail,
      fullName: "Should Not Be Created",
      role: "crew_member",
    }),
  });
  assert.equal(denied.status, 403, "non-admin must not be allowed to invite");

  const ok = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: inviteeEmail,
      fullName: "Real Invitee",
      role: "crew_member",
    }),
  });
  assert.equal(ok.status, 201, "admin must be able to invite");
  const body = (await ok.json()) as {
    user: { id: string; email: string; isActive: boolean; passwordSetAt: string | null };
    inviteToken: string;
    invitePath: string;
    inviteTokenExpiresAt: string;
  };
  assert.equal(body.user.email, inviteeEmail.toLowerCase());
  assert.equal(body.user.isActive, true, "invitee should start active");
  assert.equal(body.user.passwordSetAt, null, "invitee has no password yet");
  assert.ok(body.inviteToken.length > 20, "raw token must be returned exactly once");
  assert.match(body.invitePath, /^\/accept-invite\?token=/);
});

test("accept-invite consumes the token exactly once and refuses replays", async () => {
  const inviteeEmail = `accept-${crypto.randomUUID()}@user-invites-test.local`;
  trackInvitedEmail(inviteeEmail);

  const inviteRes = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: inviteeEmail,
      fullName: "Single Use Invitee",
      role: "project_manager",
    }),
  });
  assert.equal(inviteRes.status, 201);
  const { inviteToken } = (await inviteRes.json()) as { inviteToken: string };

  // First accept must succeed and log the user in.
  const accept1 = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ token: inviteToken, password: "FirstPass#1234" }),
  });
  assert.equal(accept1.status, 200, "fresh token must be accepted");
  const session = (await accept1.json()) as {
    accessToken: string;
    user: { email: string; role: string };
  };
  assert.equal(session.user.email, inviteeEmail.toLowerCase());
  assert.equal(session.user.role, "project_manager");
  assert.ok(session.accessToken, "must mint an access token");

  // Replay must fail — token is single-use and is wiped server-side.
  const accept2 = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ token: inviteToken, password: "SecondPass#1234" }),
  });
  assert.equal(accept2.status, 401, "second use of same token must be rejected");

  // The new password actually works at /api/auth/login, proving the
  // accept-invite handler did wire it up correctly.
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ email: inviteeEmail, password: "FirstPass#1234" }),
  });
  assert.equal(login.status, 200, "set-by-invite password must work for login");
});

test("expired and bogus tokens are rejected", async () => {
  const inviteeEmail = `expired-${crypto.randomUUID()}@user-invites-test.local`;
  trackInvitedEmail(inviteeEmail);

  const inviteRes = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: inviteeEmail,
      fullName: "Expired Invitee",
      role: "crew_member",
    }),
  });
  const { inviteToken, user } = (await inviteRes.json()) as {
    inviteToken: string;
    user: { id: string };
  };

  // Force-expire the token in the DB by rewinding inviteTokenExpiresAt.
  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  await db
    .update(users)
    .set({ inviteTokenExpiresAt: new Date(Date.now() - 60_000) })
    .where(eq(users.id, user.id));

  const expired = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ token: inviteToken, password: "AnyPass#1234" }),
  });
  assert.equal(expired.status, 401, "expired token must not be accepted");

  const bogus = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ token: "totally-fake-token", password: "AnyPass#1234" }),
  });
  assert.equal(bogus.status, 401, "unknown token must not be accepted");
});

test("deactivated users cannot log in even with the right password", async () => {
  const inviteeEmail = `deactivated-${crypto.randomUUID()}@user-invites-test.local`;
  trackInvitedEmail(inviteeEmail);

  const inviteRes = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: inviteeEmail,
      fullName: "Soon To Be Disabled",
      role: "crew_member",
    }),
  });
  const { inviteToken, user } = (await inviteRes.json()) as {
    inviteToken: string;
    user: { id: string };
  };

  // Set a real password so login is otherwise possible.
  const accept = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ token: inviteToken, password: "Worker#Pass1234" }),
  });
  assert.equal(accept.status, 200);

  const pats = await import("../src/lib/personal-access-tokens.ts");
  const { db } = await import("@workspace/db");
  const { personalAccessTokens } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const generatedPat = pats.generateRawToken();
  const [patRow] = await db
    .insert(personalAccessTokens)
    .values({
      userId: user.id,
      name: "Revoked on deactivate",
      scope: "read_write",
      tokenHash: generatedPat.tokenHash,
      tokenPrefix: generatedPat.prefix,
      lastFour: generatedPat.lastFour,
    })
    .returning({ id: personalAccessTokens.id });

  // Sanity: the password works before deactivation.
  const okLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ email: inviteeEmail, password: "Worker#Pass1234" }),
  });
  assert.equal(okLogin.status, 200);

  // Admin deactivates them via PATCH /users/:id.
  const patch = await fetch(`${baseUrl}/api/users/${user.id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(patch.status, 200, "admin can deactivate other users");
  const patched = (await patch.json()) as { user: { isActive: boolean } };
  assert.equal(patched.user.isActive, false);

  const [revokedPat] = await db
    .select({ revokedAt: personalAccessTokens.revokedAt })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.id, patRow!.id))
    .limit(1);
  assert.ok(revokedPat?.revokedAt, "deactivation must synchronously revoke live PATs");

  // The password is still correct, but the account is disabled — login
  // must fail with 401 and a message that mentions deactivation.
  const blocked = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ email: inviteeEmail, password: "Worker#Pass1234" }),
  });
  assert.equal(blocked.status, 401, "deactivated account must not be able to log in");
  const problem = (await blocked.json()) as { detail?: string; title?: string };
  assert.match(
    `${problem.title ?? ""} ${problem.detail ?? ""}`.toLowerCase(),
    /deactivat/,
    "401 body should explain that the account is deactivated",
  );
});

test("admin can demote another active admin when an active admin remains", async () => {
  const otherAdminId = crypto.randomUUID();
  const otherAdminEmail = `other-admin-${otherAdminId}@user-invites-test.local`;
  trackInvitedEmail(otherAdminEmail);

  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");

  await db.insert(users).values({
    id: otherAdminId,
    email: otherAdminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Other Active Admin",
    role: "admin",
  });

  const response = await fetch(`${baseUrl}/api/users/${otherAdminId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ role: "crew_member" }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { user: { role: string } };
  assert.equal(body.user.role, "crew_member");
});

test("last active admin cannot demote themselves", async () => {
  const response = await fetch(`${baseUrl}/api/users/${adminUserId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ role: "crew_member" }),
  });

  assert.equal(response.status, 400);

  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, adminUserId))
    .limit(1);
  assert.equal(row?.role, "admin");
  assert.equal(row?.isActive, true);
});

test("admin cannot deactivate their own account through PATCH /users/:id", async () => {
  const selfPatch = await fetch(`${baseUrl}/api/users/${adminUserId}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(selfPatch.status, 400, "self-deactivation must be blocked");

  // And the admin row in the DB must still be active.
  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, adminUserId));
  assert.equal(row?.isActive, true, "admin row must remain active after the failed self-patch");
});

test("admin can promote / demote and reissue invite tokens", async () => {
  const inviteeEmail = `promote-${crypto.randomUUID()}@user-invites-test.local`;
  trackInvitedEmail(inviteeEmail);

  const inviteRes = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: inviteeEmail,
      fullName: "Promotable Worker",
      role: "crew_member",
    }),
  });
  const { user, inviteToken: originalToken } = (await inviteRes.json()) as {
    user: { id: string };
    inviteToken: string;
  };

  // Admin promotes the user to project_manager.
  const promote = await fetch(`${baseUrl}/api/users/${user.id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ role: "project_manager", fullName: "Promoted Worker" }),
  });
  assert.equal(promote.status, 200);
  const promoted = (await promote.json()) as {
    user: { role: string; fullName: string };
  };
  assert.equal(promoted.user.role, "project_manager");
  assert.equal(promoted.user.fullName, "Promoted Worker");

  // Admin reissues the invite token. The original token must stop working
  // and the new one must be the only valid one.
  const reissue = await fetch(`${baseUrl}/api/users/${user.id}/invite`, {
    method: "POST",
    headers: adminHeaders(),
  });
  assert.equal(reissue.status, 200);
  const reissued = (await reissue.json()) as { inviteToken: string };
  assert.notEqual(reissued.inviteToken, originalToken, "reissue must mint a fresh token");

  const oldFails = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ token: originalToken, password: "Anything#1234" }),
  });
  assert.equal(oldFails.status, 401, "stale token must be rejected after reissue");

  const newWorks = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: PUBLIC_HEADERS,
    body: JSON.stringify({ token: reissued.inviteToken, password: "FreshPass#1234" }),
  });
  assert.equal(newWorks.status, 200, "fresh token must be accepted");
});
