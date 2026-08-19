import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
const runId = crypto.randomUUID();
const localUserId = crypto.randomUUID();
const supabaseUserId = crypto.randomUUID();
const email = `supabase-owner-${runId}@registration.test`;
const organizationName = `Supabase Registration ${runId}`;
const originalFetch = globalThis.fetch;

let server: Server;
let baseUrl: string;
const requests: Array<{
  url: string;
  method: string;
  body: Record<string, unknown>;
}> = [];

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.SUPABASE_AUTH_LOGIN_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = (async (url, init) => {
    const requestUrl = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    requests.push({ url: requestUrl, method: init?.method ?? "GET", body });

    if (
      requestUrl.endsWith("/auth/v1/admin/users") &&
      init?.method === "POST"
    ) {
      return new Response(JSON.stringify({ id: supabaseUserId, email }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (requestUrl.includes("/auth/v1/token?grant_type=password")) {
      return new Response(
        JSON.stringify({
          access_token: "supabase-registration-access-token",
          expires_in: 3600,
          refresh_token: "supabase-registration-refresh-token",
          user: { id: supabaseUserId, email },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (
      requestUrl.includes(`/auth/v1/admin/users/${supabaseUserId}`) &&
      init?.method === "DELETE"
    ) {
      return new Response(null, { status: 204 });
    }

    throw new Error(
      `Unexpected Supabase Auth request: ${init?.method} ${requestUrl}`,
    );
  }) as typeof fetch;

  const { default: app, prepareApp } = await import("../src/app.ts");
  await prepareApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  const { db, pool } = await import("@workspace/db");
  const { organizationMemberships, organizations, users } =
    await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    for (const row of rows) {
      await db
        .delete(organizationMemberships)
        .where(eq(organizationMemberships.userId, row.id));
      await db.delete(users).where(eq(users.id, row.id));
    }
    await db
      .delete(organizations)
      .where(eq(organizations.name, organizationName));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_AUTH_LOGIN_ENABLED;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await pool.end();
  }
});

test("public registration provisions and immediately signs into Supabase Auth", async () => {
  const response = await originalFetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      organization_name: organizationName,
      full_name: "Supabase Owner",
      email,
      password: "SupabaseOwner#123",
      accepted_terms_version: "2026-08-19",
      accepted_privacy_version: "2026-08-19",
    }),
  });

  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    accessToken: string;
    user: { id: string; email: string };
  };
  assert.equal(body.accessToken, "supabase-registration-access-token");
  assert.equal(body.user.email, email);

  const adminCreate = requests.find((request) =>
    request.url.endsWith("/auth/v1/admin/users"),
  );
  assert.ok(adminCreate);
  assert.equal(adminCreate.body.email, email);
  assert.equal(adminCreate.body.email_confirm, true);
  const metadata = adminCreate.body.app_metadata as Record<string, unknown>;
  assert.equal(metadata.cadstone_user_id, body.user.id);

  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [stored] = await db
    .select({
      id: users.id,
      supabaseAuthUserId: users.supabaseAuthUserId,
      termsVersion: users.termsVersion,
      privacyVersion: users.privacyVersion,
    })
    .from(users)
    .where(eq(users.email, email));

  assert.equal(stored?.id, body.user.id);
  assert.equal(stored?.supabaseAuthUserId, supabaseUserId);
  assert.equal(stored?.termsVersion, "2026-08-19");
  assert.equal(stored?.privacyVersion, "2026-08-19");
  assert.notEqual(body.user.id, localUserId);
});
