import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

let adminAccessJwt: string;
let inactiveAccessJwt: string;
let inactiveRefreshJwt: string;
let inactiveUploadJwt: string;
let inactivePatSecret: string;
let inactiveFileViewJwt: string;

const adminUserId = crypto.randomUUID();
const inactiveUserId = crypto.randomUUID();
const deactivatedUserId = crypto.randomUUID();
const fileViewId = crypto.randomUUID();

const adminEmail = `admin-${adminUserId}@deactivation-lockout-test.local`;
const inactiveEmail = `inactive-${inactiveUserId}@deactivation-lockout-test.local`;
const deactivatedEmail = `deactivated-${deactivatedUserId}@deactivation-lockout-test.local`;
const deactivatedPatId = crypto.randomUUID();

function csrfJsonHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  };
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const pats = await import("../src/lib/personal-access-tokens.ts");
  const { db } = await import("@workspace/db");
  const { personalAccessTokens, users } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Deactivation Admin",
      role: "admin",
    },
    {
      id: inactiveUserId,
      email: inactiveEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Inactive User",
      role: "crew_member",
      isActive: false,
    },
    {
      id: deactivatedUserId,
      email: deactivatedEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Soon Deactivated User",
      role: "crew_member",
    },
  ]);

  const stamp = new Date();
  const adminPublicUser = {
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Deactivation Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const inactivePublicUser = {
    id: inactiveUserId,
    email: inactiveEmail,
    fullName: "ZZZ Inactive User",
    role: "crew_member",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  adminAccessJwt = auth.signAccessToken(adminPublicUser);
  inactiveAccessJwt = auth.signAccessToken(inactivePublicUser);
  inactiveRefreshJwt = auth.signRefreshToken(inactivePublicUser);
  inactiveUploadJwt = auth.signUploadToken(inactivePublicUser);
  inactiveFileViewJwt = auth.signFileViewToken(inactivePublicUser, fileViewId);

  const inactivePat = pats.generateRawToken();
  inactivePatSecret = inactivePat.secret;
  await db.insert(personalAccessTokens).values({
    userId: inactiveUserId,
    name: "Inactive user PAT",
    scope: "read_write",
    tokenHash: inactivePat.tokenHash,
    tokenPrefix: inactivePat.prefix,
    lastFour: inactivePat.lastFour,
  });

  const deactivatedPat = pats.generateRawToken();
  await db.insert(personalAccessTokens).values({
    id: deactivatedPatId,
    userId: deactivatedUserId,
    name: "PAT revoked on deactivation",
    scope: "read_write",
    tokenHash: deactivatedPat.tokenHash,
    tokenPrefix: deactivatedPat.prefix,
    lastFour: deactivatedPat.lastFour,
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
  const { activityLog, idempotencyKeys, users } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    const userIds = [adminUserId, inactiveUserId, deactivatedUserId];
    await db.delete(activityLog).where(inArray(activityLog.userId, userIds));
    await db.delete(idempotencyKeys).where(inArray(idempotencyKeys.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

test("refresh is denied for an inactive user", async () => {
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "x-requested-with": "XMLHttpRequest", cookie: `stone_track_refresh_token=${inactiveRefreshJwt}` },
  });

  assert.equal(response.status, 401);
});

test("PAT is denied for an inactive user", async () => {
  const response = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${inactivePatSecret}` },
  });

  assert.equal(response.status, 401);
});

test("admin deactivation revokes outstanding PATs in the same transaction", async () => {
  const response = await fetch(`${baseUrl}/api/users/${deactivatedUserId}`, {
    method: "PATCH",
    headers: csrfJsonHeaders(adminAccessJwt),
    body: JSON.stringify({ isActive: false }),
  });

  assert.equal(response.status, 200);

  const { db } = await import("@workspace/db");
  const { personalAccessTokens } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({ revokedAt: personalAccessTokens.revokedAt })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.id, deactivatedPatId))
    .limit(1);

  assert.ok(row?.revokedAt, "PAT revoked_at must be set before PATCH returns");
});

test("upload-token middleware rejects an inactive user", async () => {
  const response = await fetch(`${baseUrl}/uploads/deactivation-lockout/nonexistent.pdf`, {
    headers: { cookie: `stone_track_upload_token=${inactiveUploadJwt}` },
  });

  assert.equal(response.status, 401);
});

test("signed file-view token rejects an inactive user", async () => {
  const response = await fetch(
    `${baseUrl}/api/files/${fileViewId}/view-signed?token=${encodeURIComponent(inactiveFileViewJwt)}`,
  );

  assert.equal(response.status, 401);
});

test("access-token middleware rejects an inactive user", async () => {
  const response = await fetch(`${baseUrl}/api/users/me`, {
    headers: { authorization: `Bearer ${inactiveAccessJwt}` },
  });

  assert.equal(response.status, 401);
});
