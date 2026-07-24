import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
const issuer = "https://example.supabase.co/auth/v1";
const audience = "authenticated";
const secret = "test-supabase-jwt-secret-with-enough-entropy";

const linkedUserId = crypto.randomUUID();
const linkedSupabaseUserId = crypto.randomUUID();
const inactiveUserId = crypto.randomUUID();
const inactiveSupabaseUserId = crypto.randomUUID();
const legacyUserId = crypto.randomUUID();
const loginUserId = crypto.randomUUID();
const loginSupabaseUserId = crypto.randomUUID();
const loginEmail = `login-${loginUserId}@auth.test`;
const fallbackLoginUserId = crypto.randomUUID();
const fallbackLoginSupabaseUserId = crypto.randomUUID();
const fallbackLoginEmail = `login-${fallbackLoginUserId}@auth.test`;
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL,
  NODE_ENV: process.env.NODE_ENV,
  SUPABASE_AUTH_AUDIENCE: process.env.SUPABASE_AUTH_AUDIENCE,
  SUPABASE_AUTH_ENABLED: process.env.SUPABASE_AUTH_ENABLED,
  SUPABASE_AUTH_ISSUER: process.env.SUPABASE_AUTH_ISSUER,
  SUPABASE_AUTH_LOGIN_ENABLED: process.env.SUPABASE_AUTH_LOGIN_ENABLED,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL,
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
};
const originalFetch = globalThis.fetch;

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function signSupabaseToken(supabaseUserId: string, expiresIn = "1h") {
  return jwt.sign(
    {
      email: `${supabaseUserId}@auth.test`,
      role: "authenticated",
    },
    secret,
    {
      algorithm: "HS256",
      audience,
      expiresIn,
      issuer,
      subject: supabaseUserId,
    },
  );
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.SUPABASE_AUTH_ENABLED = "true";
  process.env.SUPABASE_AUTH_ISSUER = issuer;
  process.env.SUPABASE_AUTH_AUDIENCE = audience;
  process.env.SUPABASE_JWT_SECRET = secret;

  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");

  await db.insert(users).values([
    {
      id: linkedUserId,
      supabaseAuthUserId: linkedSupabaseUserId,
      email: `linked-${linkedUserId}@auth.test`,
      passwordHash: "legacy-password-hash",
      fullName: "Supabase Linked User",
      role: "project_manager",
    },
    {
      id: inactiveUserId,
      supabaseAuthUserId: inactiveSupabaseUserId,
      email: `inactive-${inactiveUserId}@auth.test`,
      passwordHash: "legacy-password-hash",
      fullName: "Inactive Supabase User",
      isActive: false,
      role: "crew_member",
    },
    {
      id: legacyUserId,
      email: `legacy-${legacyUserId}@auth.test`,
      passwordHash: "legacy-password-hash",
      fullName: "Legacy JWT User",
      role: "admin",
    },
    {
      id: loginUserId,
      email: loginEmail,
      passwordHash: "legacy-password-hash",
      fullName: "Supabase Login User",
      role: "project_manager",
    },
    {
      id: fallbackLoginUserId,
      email: fallbackLoginEmail,
      passwordHash: "legacy-password-hash",
      fullName: "Supabase Service Role Login User",
      role: "admin",
    },
  ]);
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    await db
      .delete(users)
      .where(
        inArray(users.id, [
          linkedUserId,
          inactiveUserId,
          legacyUserId,
          loginUserId,
          fallbackLoginUserId,
        ]),
      );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("DATABASE_URL");
    restoreEnv("LOG_LEVEL");
    restoreEnv("NODE_ENV");
    restoreEnv("SUPABASE_AUTH_AUDIENCE");
    restoreEnv("SUPABASE_AUTH_ENABLED");
    restoreEnv("SUPABASE_AUTH_ISSUER");
    restoreEnv("SUPABASE_AUTH_LOGIN_ENABLED");
    restoreEnv("SUPABASE_ANON_KEY");
    restoreEnv("SUPABASE_DATABASE_URL");
    restoreEnv("SUPABASE_JWT_SECRET");
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY");
    restoreEnv("SUPABASE_URL");
    await pool.end();
  }
});

test("resolves a Supabase Auth token to the linked SlabPlan user", async () => {
  const { resolveSupabaseAccessToken } = await import("../src/lib/supabase-auth.ts");
  const token = signSupabaseToken(linkedSupabaseUserId);

  const auth = await resolveSupabaseAccessToken(token);

  assert.equal(auth.userId, linkedUserId);
  assert.equal(auth.supabaseAuthUserId, linkedSupabaseUserId);
  assert.equal(auth.email, `linked-${linkedUserId}@auth.test`);
  assert.equal(auth.role, "project_manager");
  assert.equal(auth.type, "access");
  assert.equal(auth.authProvider, "supabase");
});

test("rejects Supabase Auth tokens for inactive or unlinked users", async () => {
  const { resolveSupabaseAccessToken } = await import("../src/lib/supabase-auth.ts");

  await assert.rejects(
    () => resolveSupabaseAccessToken(signSupabaseToken(inactiveSupabaseUserId)),
    /not linked to an active SlabPlan user/,
  );
  await assert.rejects(
    () => resolveSupabaseAccessToken(signSupabaseToken(crypto.randomUUID())),
    /not linked to an active SlabPlan user/,
  );
});

test("interactive token resolver keeps legacy JWT support during migration", async () => {
  const { resolveInteractiveAccessToken } = await import("../src/lib/access-token.ts");
  const { signAccessToken } = await import("../src/lib/auth.ts");

  const legacyToken = signAccessToken({
    id: legacyUserId,
    email: `legacy-${legacyUserId}@auth.test`,
    fullName: "Legacy JWT User",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const auth = await resolveInteractiveAccessToken(legacyToken);

  assert.equal(auth.userId, legacyUserId);
  assert.equal(auth.role, "admin");
  assert.equal(auth.authProvider, "legacy");
});

test("Supabase password login links a matching SlabPlan user by email", async () => {
  process.env.SUPABASE_AUTH_LOGIN_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";

  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        access_token: "supabase-access-token",
        expires_in: 3600,
        refresh_token: "supabase-refresh-token",
        token_type: "bearer",
        user: {
          id: loginSupabaseUserId,
          email: loginEmail,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { signInWithSupabasePassword } = await import("../src/lib/supabase-auth-session.ts");
  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const session = await signInWithSupabasePassword(loginEmail, "correct-password");

  assert.equal(requests[0]?.url, "https://example.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(requests[0]?.body.email, loginEmail);
  assert.equal(session.accessToken, "supabase-access-token");
  assert.equal(session.refreshToken, "supabase-refresh-token");
  assert.equal(session.user.id, loginUserId);
  assert.equal(session.user.role, "project_manager");

  const [linked] = await db
    .select({ supabaseAuthUserId: users.supabaseAuthUserId })
    .from(users)
    .where(eq(users.id, loginUserId))
    .limit(1);

  assert.equal(linked?.supabaseAuthUserId, loginSupabaseUserId);
});

test("Supabase password login can use the server-side service role key when anon key is absent", async () => {
  process.env.SUPABASE_AUTH_LOGIN_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const requests: Array<{
    url: string;
    authorization: string | null;
    apikey: string | null;
    body: Record<string, unknown>;
  }> = [];
  globalThis.fetch = (async (url, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(url),
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        access_token: "supabase-access-token-service-role",
        expires_in: 3600,
        refresh_token: "supabase-refresh-token-service-role",
        token_type: "bearer",
        user: {
          id: fallbackLoginSupabaseUserId,
          email: fallbackLoginEmail,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const { signInWithSupabasePassword } = await import("../src/lib/supabase-auth-session.ts");
  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const session = await signInWithSupabasePassword(fallbackLoginEmail, "correct-password");

  assert.equal(requests[0]?.url, "https://example.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(requests[0]?.apikey, "test-service-role-key");
  assert.equal(requests[0]?.authorization, "Bearer test-service-role-key");
  assert.equal(requests[0]?.body.email, fallbackLoginEmail);
  assert.equal(session.accessToken, "supabase-access-token-service-role");
  assert.equal(session.refreshToken, "supabase-refresh-token-service-role");
  assert.equal(session.user.id, fallbackLoginUserId);
  assert.equal(session.user.role, "admin");

  const [linked] = await db
    .select({ supabaseAuthUserId: users.supabaseAuthUserId })
    .from(users)
    .where(eq(users.id, fallbackLoginUserId))
    .limit(1);

  assert.equal(linked?.supabaseAuthUserId, fallbackLoginSupabaseUserId);
});
