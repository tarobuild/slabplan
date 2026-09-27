import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generate } from "otplib";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
delete process.env.SUPABASE_DATABASE_URL;
process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY = "c".repeat(64);
process.env.JWT_ACCESS_SECRET = "security-test-access-secret-not-production";
process.env.JWT_REFRESH_SECRET = "security-test-refresh-secret-not-production";
process.env.JWT_UPLOAD_SECRET = "security-test-upload-secret-not-production";

const { db, pool } = await import("@workspace/db");
const { users, organizations, organizationMemberships, personalAccessTokens, securityEvents } = await import("@workspace/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const security = await import("../src/lib/account-security.ts");
const auth = await import("../src/lib/auth.ts");
const { __setEmailSenderForTests } = await import("../src/lib/email.ts");
const password = "SecurityFixturePass#123";
const ids: string[] = [];
const orgIds: string[] = [];
const emails: Array<{ to: string; text: string }> = [];
let server: Server;
let baseUrl: string;

before(async () => {
  await pool.query("DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'auth:security:%'");
  __setEmailSenderForTests({ send: async ({ to, text }) => { emails.push({ to, text }); return { id: "test-mail" }; } });
  const { default: app, prepareApp } = await import("../src/app.ts");
  await prepareApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (ids.length) {
    await db.delete(personalAccessTokens).where(inArray(personalAccessTokens.userId, ids));
    await db.delete(organizationMemberships).where(inArray(organizationMemberships.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  if (orgIds.length) await db.delete(organizations).where(inArray(organizations.id, orgIds));
  await pool.end();
});

async function fixture(required = false) {
  const id = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const bcrypt = await import("bcrypt");
  await db.insert(organizations).values({ id: orgId, name: "TEST security", slug: `test-security-${orgId}`, status: "active", requiresSubscription: false });
  const [user] = await db.insert(users).values({ id, email: `test-${id}@example.test`, fullName: "TEST Security Owner", passwordHash: await bcrypt.hash(password, 4), role: "admin", defaultOrganizationId: orgId, mfaRequired: required, emailVerifiedAt: new Date() }).returning();
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId: id, role: "owner", isDefault: true });
  ids.push(id); orgIds.push(orgId);
  return user!;
}

async function post(path: string, body: unknown, token?: string) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

async function activate(userId: string) {
  const token = await security.issueSecurityChallenge(userId, "setup");
  const enrollment = await security.beginSecurityEnrollment(token);
  const code = await generate({ secret: enrollment.secret });
  const result = await security.completeSecurityChallenge(token, code, "setup");
  return { ...result, secret: enrollment.secret, code };
}

test("security history rejects rewriting and early deletion, while allowing expired retention cleanup", async () => {
  // Exercise the real migration in a rolled-back transaction, including on a
  // test database initially provisioned from the Drizzle schema.
  const { readFile } = await import("node:fs/promises");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DROP TRIGGER IF EXISTS security_events_append_only ON security_events",
    );
    await client.query(
      await readFile(
        new URL(
          "../../../lib/db/migrations/0043_security_events.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const current = crypto.randomUUID();
    const old = crypto.randomUUID();
    await client.query(
      "INSERT INTO security_events (id, event, created_at) VALUES ($1, 'test', now()), ($2, 'test', now() - interval '401 days')",
      [current, old],
    );
    for (const query of [
      "UPDATE security_events SET event = 'rewritten' WHERE id = $1",
      "DELETE FROM security_events WHERE id = $1",
    ]) {
      await client.query("SAVEPOINT reject_change");
      await assert.rejects(client.query(query, [current]), /append-only/);
      await client.query("ROLLBACK TO SAVEPOINT reject_change");
    }
    const deleted = await client.query(
      "DELETE FROM security_events WHERE id = $1",
      [old],
    );
    assert.equal(deleted.rowCount, 1);
    const permissions = await client.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'security_events'::regclass",
    );
    assert.equal(permissions.rows[0].relrowsecurity, true);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("enrollment encrypts factors and hashes recovery codes; old sessions cannot bypass MFA", async () => {
  const user = await fixture(true);
  const before = auth.signAccessToken(user);
  const enabled = await activate(user.id);
  const stored = await security.readSecurityUser(user.id);
  assert.ok(stored.mfaEnabledAt);
  assert.ok(stored.mfaSecretEncrypted?.startsWith("v1."));
  assert.ok(!stored.mfaSecretEncrypted?.includes(enabled.secret));
  assert.equal(stored.mfaRecoveryHashes.length, 10);
  assert.equal(stored.mfaPendingSecretEncrypted, null);
  assert.ok(!JSON.stringify(stored.mfaRecoveryHashes).includes(enabled.recoveryCodes![0]!));
  const forbidden = await fetch(`${baseUrl}/billing/status`, { headers: { authorization: `Bearer ${before}` } });
  assert.equal(forbidden.status, 401);
  const passwordOnly = auth.signAccessToken(user);
  assert.equal((await fetch(`${baseUrl}/billing/status`, { headers: { authorization: `Bearer ${passwordOnly}` } })).status, 401);
  const verified = auth.signAccessToken(user, enabled);
  const status = await fetch(`${baseUrl}/auth/security`, { headers: { authorization: `Bearer ${verified}` } });
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.deepEqual(Object.keys(body).sort(), ["email", "emailVerified", "mfaEnabled", "mfaRequired", "recoveryCodesRemaining"].sort());
  assert.equal(body.recoveryCodesRemaining, 10);
  const events = await db.select().from(securityEvents).where(eq(securityEvents.userId, user.id));
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "security.mfa.enabled");
  assert.equal(events[0].organizationId, user.defaultOrganizationId);
  assert.ok(!JSON.stringify(events).includes(enabled.secret));
  assert.ok(!JSON.stringify(events).includes(enabled.recoveryCodes![0]!));
});

test("challenge attempts persist and five wrong codes invalidate enrollment", async () => {
  const user = await fixture();
  const token = await security.issueSecurityChallenge(user.id, "setup");
  const enrollment = await security.beginSecurityEnrollment(token);
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(security.completeSecurityChallenge(token, "invalid", "setup"));
  const correct = await generate({ secret: enrollment.secret });
  await assert.rejects(security.completeSecurityChallenge(token, correct, "setup"));
  assert.equal((await security.readSecurityUser(user.id)).securityChallengeAttempts, 5);
  const events = await db.select().from(securityEvents).where(eq(securityEvents.userId, user.id));
  assert.equal(events.filter((event) => event.event === "security.mfa.failed").length, 5);
});

test("expired and superseded challenges cannot enroll an authenticator", async () => {
  const user = await fixture();
  const old = await security.issueSecurityChallenge(user.id, "setup");
  const current = await security.issueSecurityChallenge(user.id, "setup");
  await assert.rejects(security.beginSecurityEnrollment(old));
  await db.update(users).set({ securityChallengeExpiresAt: new Date(0) }).where(eq(users.id, user.id));
  await assert.rejects(security.beginSecurityEnrollment(current));
});

test("TOTP replay is rejected even with a new credential challenge", async () => {
  const user = await fixture();
  const enabled = await activate(user.id);
  const token = await security.issueSecurityChallenge(user.id, "login");
  await assert.rejects(security.completeSecurityChallenge(token, enabled.code, "login"));
  const nextCode = await generate({ secret: enabled.secret, epoch: Math.floor(Date.now() / 1000) + 30 });
  const result = await security.completeSecurityChallenge(token, nextCode, "login");
  assert.equal(result.user.id, user.id);
  await assert.rejects(security.completeSecurityChallenge(token, nextCode, "login"));
});

test("recovery code consumption is atomic and bound to its account", async () => {
  const user = await fixture();
  const enabled = await activate(user.id);
  const token = await security.issueSecurityChallenge(user.id, "login");
  const results = await Promise.allSettled([
    security.completeSecurityChallenge(token, enabled.recoveryCodes![0]!, "login"),
    security.completeSecurityChallenge(token, enabled.recoveryCodes![0]!, "login"),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await security.readSecurityUser(user.id)).mfaRecoveryHashes.length, 9);
  const events = await db.select().from(securityEvents).where(eq(securityEvents.userId, user.id));
  assert.equal(events.filter((event) => event.event === "security.mfa.recovery_used").length, 1);
  const other = await fixture();
  await activate(other.id);
  const otherToken = await security.issueSecurityChallenge(other.id, "login");
  await assert.rejects(security.completeSecurityChallenge(otherToken, enabled.recoveryCodes![1]!, "login"));
  const reused = await security.issueSecurityChallenge(user.id, "login");
  await assert.rejects(security.completeSecurityChallenge(reused, enabled.recoveryCodes![0]!, "login"));
});

test("refresh preserves MFA proof; global revocation rejects old access, refresh, and setup challenges", async () => {
  const user = await fixture();
  const enabled = await activate(user.id);
  const refresh = auth.signRefreshToken(user, enabled);
  const response = await fetch(`${baseUrl}/auth/refresh`, { method: "POST", headers: { "x-requested-with": "XMLHttpRequest", cookie: `${auth.refreshCookieName}=${refresh}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(auth.verifyAccessToken(body.accessToken).mfaVerifiedAt, enabled.mfaVerifiedAt);
  assert.equal(auth.verifyAccessToken(body.accessToken).authTime, enabled.authTime);
  const challenge = await security.issueSecurityChallenge(user.id, "login");
  await new Promise((resolve) => setTimeout(resolve, 2));
  await security.revokeAccountSessions(user.id);
  assert.equal((await fetch(`${baseUrl}/auth/security`, { headers: { authorization: `Bearer ${body.accessToken}` } })).status, 401);
  const revoked = await fetch(`${baseUrl}/auth/refresh`, { method: "POST", headers: { "x-requested-with": "XMLHttpRequest", cookie: `${auth.refreshCookieName}=${refresh}` } });
  assert.equal(revoked.status, 401);
  await assert.rejects(security.completeSecurityChallenge(challenge, enabled.recoveryCodes![0]!, "login"));
});

test("resending verification invalidates prior links; expiry and unverified API access fail closed", async () => {
  const user = await fixture();
  await db.update(users).set({ emailVerifiedAt: null, emailVerificationRequired: true }).where(eq(users.id, user.id));
  assert.equal(await security.issueEmailVerification(user), true);
  const first = /#token=([a-f0-9]{64})/.exec(emails.at(-1)!.text)![1]!;
  await security.issueEmailVerification(user);
  const second = /#token=([a-f0-9]{64})/.exec(emails.at(-1)!.text)![1]!;
  await assert.rejects(security.verifyEmail(first));
  assert.equal((await fetch(`${baseUrl}/billing/status`, { headers: { authorization: `Bearer ${auth.signAccessToken(user)}` } })).status, 401);
  await db.update(users).set({ emailVerificationExpiresAt: new Date(0) }).where(eq(users.id, user.id));
  await assert.rejects(security.verifyEmail(second));
  await security.issueEmailVerification(user);
  const third = /#token=([a-f0-9]{64})/.exec(emails.at(-1)!.text)![1]!;
  await security.verifyEmail(third);
  await assert.rejects(security.verifyEmail(third));
});

test("password reset does not bypass an enrolled authenticator", async () => {
  const user = await fixture();
  await activate(user.id);
  const token = crypto.randomBytes(32).toString("hex");
  await db.update(users).set({ inviteTokenHash: crypto.createHash("sha256").update(token).digest("hex"), inviteTokenExpiresAt: new Date(Date.now() + 60000) }).where(eq(users.id, user.id));
  const response = await post("/auth/accept-invite", { token, email: user.email, password: "ResetSecurityPass#123", accepted_terms_version: "2026-08-19", accepted_privacy_version: "2026-08-19" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mfaRequired, true);
  assert.equal(body.accessToken, undefined);
  assert.ok(body.challengeToken);
});

test("setup requires current password and cannot replace an enrolled factor", async () => {
  const user = await fixture();
  const token = auth.signAccessToken(user);
  assert.equal((await post("/auth/security/setup", { password: "wrong-password" }, token)).status, 401);
  const started = await post("/auth/security/setup", { password }, token);
  assert.equal(started.status, 200);
  const { challengeToken } = await started.json();
  assert.equal((await post("/auth/mfa/verify", { challengeToken, code: "123456" })).status, 401, "setup challenges are not login challenges");
  const enabled = await activate(user.id);
  assert.equal((await post("/auth/security/setup", { password }, auth.signAccessToken(user, enabled))).status, 409);
});

test("authenticator setup preserves whitespace in the current password", async () => {
  const user = await fixture();
  const bcrypt = await import("bcrypt");
  const exactPassword = ` ${password} `;
  await db.update(users).set({ passwordHash: await bcrypt.hash(exactPassword, 4) }).where(eq(users.id, user.id));
  const token = auth.signAccessToken(user);
  assert.equal((await post("/auth/security/setup", { password }, token)).status, 401);
  assert.equal((await post("/auth/security/setup", { password: exactPassword }, token)).status, 200);
});

test("email changes atomically revoke sessions and API tokens, and stale addresses cannot issue verification", async () => {
  const user = await fixture();
  const access = auth.signAccessToken(user);
  await db.insert(personalAccessTokens).values({ userId: user.id, organizationId: user.defaultOrganizationId, name: "TEST security token", tokenHash: crypto.randomBytes(32).toString("hex"), tokenPrefix: "test", lastFour: "test" });
  const changedEmail = `changed-${user.id}@example.test`;
  const response = await fetch(`${baseUrl}/users/me`, { method: "PUT", headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest", authorization: `Bearer ${access}` }, body: JSON.stringify({ email: changedEmail, currentPassword: password }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.verificationRequired, true);
  assert.equal(body.emailSent, true);
  const current = await security.readSecurityUser(user.id);
  assert.equal(current.email, changedEmail);
  assert.equal(current.emailVerifiedAt, null);
  assert.ok(current.sessionsRevokedAt);
  const [pat] = await db.select().from(personalAccessTokens).where(eq(personalAccessTokens.userId, user.id));
  assert.ok(pat!.revokedAt);
  assert.equal((await fetch(`${baseUrl}/auth/security`, { headers: { authorization: `Bearer ${access}` } })).status, 401);
  const issued = current.emailVerificationHash;
  assert.equal(await security.issueEmailVerification(user), false);
  assert.equal((await security.readSecurityUser(user.id)).emailVerificationHash, issued);
});

test("email transport failure is explicit and enrollment fails closed without its encryption key", async () => {
  const user = await fixture();
  __setEmailSenderForTests({ send: async () => { throw new Error("test transport unavailable"); } });
  assert.equal(await security.issueEmailVerification(user), false);
  const key = process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY;
  delete process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY;
  try { await assert.rejects(security.issueSecurityChallenge(user.id, "setup")); }
  finally { process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY = key; }
});
