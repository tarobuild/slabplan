import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;
const adminUserId = crypto.randomUUID();
const adminEmail = `admin-${adminUserId}@account-tokens-flow-test.local`;

const createdPatIds: string[] = [];
const createdClientIds: string[] = [];

function jsonHeaders(token: string, extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    ...extra,
  };
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
  const { db } = await import("@workspace/db");
  const { users } = await import("@workspace/db/schema");

  await prepareApp();

  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Account Tokens Flow Admin",
    role: "admin",
  });

  const stamp = new Date();
  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Account Tokens Flow Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: stamp,
    updatedAt: stamp,
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { clients, personalAccessTokens, idempotencyKeys, users } = await import(
    "@workspace/db/schema"
  );
  const { inArray, eq } = await import("drizzle-orm");

  try {
    if (createdClientIds.length > 0) {
      await db.delete(clients).where(inArray(clients.id, createdClientIds));
    }
    if (createdPatIds.length > 0) {
      await db
        .delete(personalAccessTokens)
        .where(inArray(personalAccessTokens.id, createdPatIds));
    }
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, adminUserId));
    // Drop any other PATs left for this admin (e.g. inserted directly for the
    // expired-token case, which never went through the create endpoint).
    await db
      .delete(personalAccessTokens)
      .where(eq(personalAccessTokens.userId, adminUserId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await pool.end();
  }
});

test("End-to-end PAT flow: create via API, exercise scope, lastUsedAt, revoke", async () => {
  // 1. Create a read_write PAT via the real API the UI uses.
  const createRes = await fetch(`${baseUrl}/api/account/tokens`, {
    method: "POST",
    headers: jsonHeaders(adminAccessJwt),
    body: JSON.stringify({ name: "Flow test RW", scope: "read_write" }),
  });
  assert.equal(createRes.status, 201, "create should return 201");
  const created = (await createRes.json()) as {
    token: { id: string; tokenPrefix: string; lastFour: string; lastUsedAt: string | null };
    secret: string;
  };
  assert.ok(created.secret.startsWith("cs_pat_"), "secret must use cs_pat_ prefix");
  assert.equal(created.token.lastUsedAt, null, "fresh token has no lastUsedAt");
  createdPatIds.push(created.token.id);
  const rwSecret = created.secret;
  const rwTokenId = created.token.id;

  // 2. Token immediately appears in the list with the right prefix/last-four.
  const listRes = await fetch(`${baseUrl}/api/account/tokens`, {
    headers: { authorization: `Bearer ${adminAccessJwt}` },
  });
  assert.equal(listRes.status, 200);
  const listBody = (await listRes.json()) as {
    tokens: Array<{
      id: string;
      tokenPrefix: string;
      lastFour: string;
      revokedAt: string | null;
    }>;
  };
  const listed = listBody.tokens.find((t) => t.id === rwTokenId);
  assert.ok(listed, "newly minted token must be returned by GET /account/tokens");
  assert.equal(listed.tokenPrefix, created.token.tokenPrefix);
  assert.equal(listed.lastFour, created.token.lastFour);
  assert.equal(listed.revokedAt, null, "fresh token is not revoked");

  // 3. The PAT itself works as a Bearer credential against a read endpoint.
  const readWithPat = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${rwSecret}` },
  });
  assert.equal(readWithPat.status, 200, "read_write PAT must work on GET /users");

  // 4. lastUsedAt is bumped after a successful authenticated call. The
  //    middleware does this as a fire-and-forget write, so poll briefly.
  const { db } = await import("@workspace/db");
  const { personalAccessTokens, clients } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  let lastUsedAt: Date | null = null;
  for (let i = 0; i < 20; i += 1) {
    const [row] = await db
      .select({ lastUsedAt: personalAccessTokens.lastUsedAt })
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.id, rwTokenId))
      .limit(1);
    if (row?.lastUsedAt) {
      lastUsedAt = row.lastUsedAt;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(lastUsedAt, "lastUsedAt must be populated after a successful PAT call");

  // 5. read_write PAT can perform a real write (POST /clients).
  const writeRes = await fetch(`${baseUrl}/api/clients`, {
    method: "POST",
    headers: jsonHeaders(rwSecret),
    body: JSON.stringify({ companyName: `ZZZ PAT Flow Co ${crypto.randomUUID()}` }),
  });
  assert.equal(writeRes.status, 201, "read_write PAT must succeed on POST /clients");
  const writeBody = (await writeRes.json()) as { client: { id: string } };
  createdClientIds.push(writeBody.client.id);

  // 6. PATs cannot mint other PATs even with read_write scope.
  const mintViaPat = await fetch(`${baseUrl}/api/account/tokens`, {
    method: "POST",
    headers: jsonHeaders(rwSecret),
    body: JSON.stringify({ name: "should-be-blocked", scope: "read" }),
  });
  assert.equal(mintViaPat.status, 403, "PATs must not be able to mint other PATs");

  // 7. Create a read-only PAT and verify a write endpoint rejects it.
  const roCreateRes = await fetch(`${baseUrl}/api/account/tokens`, {
    method: "POST",
    headers: jsonHeaders(adminAccessJwt),
    body: JSON.stringify({ name: "Flow test RO", scope: "read" }),
  });
  assert.equal(roCreateRes.status, 201);
  const ro = (await roCreateRes.json()) as { token: { id: string }; secret: string };
  createdPatIds.push(ro.token.id);

  const roReadOk = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${ro.secret}` },
  });
  assert.equal(roReadOk.status, 200, "read-only PAT must work on GET");

  const roWriteDenied = await fetch(`${baseUrl}/api/clients`, {
    method: "POST",
    headers: jsonHeaders(ro.secret),
    body: JSON.stringify({ companyName: "should-be-blocked" }),
  });
  assert.equal(
    roWriteDenied.status,
    403,
    "read-only PAT must be rejected on POST with 403",
  );
  const roProblem = (await roWriteDenied.json()) as { type?: string };
  assert.match(String(roProblem.type ?? ""), /\/insufficient-scope$/);

  // 8. Revoke the read_write PAT through the UI's API and confirm 401.
  const revokeRes = await fetch(`${baseUrl}/api/account/tokens/${rwTokenId}`, {
    method: "DELETE",
    headers: jsonHeaders(adminAccessJwt),
  });
  assert.equal(revokeRes.status, 204, "revoke should return 204");

  const afterRevoke = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${rwSecret}` },
  });
  assert.equal(afterRevoke.status, 401, "revoked PAT must be rejected with 401");

  // 9. Expired PAT → 401. The create endpoint validates expiresAt is in
  //    the future, so insert directly with a past expiry.
  const pats = await import("../src/lib/personal-access-tokens.ts");
  const expired = pats.generateRawToken();
  const [expiredRow] = await db
    .insert(personalAccessTokens)
    .values({
      userId: adminUserId,
      name: "Flow test expired",
      scope: "read_write",
      tokenHash: expired.tokenHash,
      tokenPrefix: expired.prefix,
      lastFour: expired.lastFour,
      expiresAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: personalAccessTokens.id });
  createdPatIds.push(expiredRow!.id);

  const expiredRes = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${expired.secret}` },
  });
  assert.equal(expiredRes.status, 401, "expired PAT must be rejected with 401");

  // Belt-and-braces: cleanup the client we created via the read_write PAT.
  await db.delete(clients).where(eq(clients.id, writeBody.client.id));
  createdClientIds.splice(createdClientIds.indexOf(writeBody.client.id), 1);
});
