import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;

let adminAccessJwt: string;
let patSecret: string;
let patId: string;

const adminUserId = crypto.randomUUID();
const patUserId = crypto.randomUUID();

const cursorJobIds: string[] = Array.from({ length: 5 }, () => crypto.randomUUID());
// Unique per-run discriminator that we embed in every seeded job title so
// the cursor walk can use `?search=` to filter ONLY this suite's rows out
// of the shared test database — sibling suites and leftover jobs would
// otherwise expand the page count unpredictably.
const cursorJobMarker = `cursor-walk-${crypto.randomUUID()}`;
const idempotentlyCreatedPatIds: string[] = [];

const adminEmail = `admin-${adminUserId}@api-integration-test.local`;
const patEmail = `pat-${patUserId}@api-integration-test.local`;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  // The shared db client (lib/db) prefers SUPABASE_DATABASE_URL when set, but
  // that points at the production pooler with a 15-client cap that the test
  // suites blow through immediately. Force tests to use the local DATABASE_URL.
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;
  process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
  process.env.REPLIT_DEV_DOMAIN = "workspace.kirk.replit.dev";

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const pats = await import("../src/lib/personal-access-tokens.ts");
  const { db } = await import("@workspace/db");
  const { users, jobs, personalAccessTokens } = await import("@workspace/db/schema");

  await prepareApp();

  const passwordHash = "test-not-a-real-hash";
  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash,
      fullName: "ZZZ Integration Admin",
      role: "admin",
    },
    {
      id: patUserId,
      email: patEmail,
      passwordHash,
      fullName: "ZZZ Integration PAT Owner",
      role: "admin",
    },
  ]);

  // Five jobs with distinct createdAt timestamps so the (createdAt, id)
  // cursor walk produces a deterministic order across page boundaries.
  const baseTime = Date.now();
  await db.insert(jobs).values(
    cursorJobIds.map((id, i) => ({
      id,
      // Marker is embedded in the title so the cursor walk below can
      // filter on it via `?search=` — that scopes the response to only
      // these 5 rows even when the test DB carries leftovers from other
      // suites.
      title: `ZZZ Integration Cursor Job ${i} ${cursorJobMarker}`,
      createdBy: adminUserId,
      projectManagerId: adminUserId,
      // Decreasing offset so the natural DESC(createdAt) order matches the
      // index in cursorJobIds (job 0 is newest).
      createdAt: new Date(baseTime - i * 1000),
    })),
  );

  // Issue a PAT directly through the same helpers the API uses, so we
  // exercise the real hash + storage shape (rather than crafting a
  // fake row).
  const generated = pats.generateRawToken();
  const [insertedPat] = await db
    .insert(personalAccessTokens)
    .values({
      userId: patUserId,
      name: "Integration PAT",
      scope: "read_write",
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.prefix,
      lastFour: generated.lastFour,
    })
    .returning({ id: personalAccessTokens.id });

  patSecret = generated.secret;
  patId = insertedPat!.id;

  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Integration Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
  const {
    jobs,
    users,
    personalAccessTokens,
    idempotencyKeys,
  } = await import("@workspace/db/schema");
  const { inArray, eq } = await import("drizzle-orm");

  try {
    await db.delete(jobs).where(inArray(jobs.id, cursorJobIds));
    const patIdsToClean = [patId, ...idempotentlyCreatedPatIds].filter(Boolean);
    if (patIdsToClean.length > 0) {
      await db
        .delete(personalAccessTokens)
        .where(inArray(personalAccessTokens.id, patIdsToClean));
    }
    // The idempotency middleware persists the cached response keyed by user.
    // Wipe anything we left behind so a re-run of the suite starts clean.
    await db
      .delete(idempotencyKeys)
      .where(inArray(idempotencyKeys.userId, [adminUserId, patUserId]));
    await db.delete(users).where(eq(users.id, adminUserId));
    await db.delete(users).where(eq(users.id, patUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

test("PAT can call a protected endpoint, then 401s with problem+json after revocation", async () => {
  // Sanity: the PAT we issued in `before` works against a real GET route.
  const ok = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${patSecret}` },
  });
  assert.equal(ok.status, 200, "PAT bearer must authenticate against /api/users");
  const okBody = (await ok.json()) as { data: unknown[] };
  assert.ok(Array.isArray(okBody.data), "users list must come back as an array");

  // Revoke through the same code path the API uses, so we exercise the
  // production revoke logic rather than poking the row directly.
  const { revokeToken } = await import("../src/lib/personal-access-tokens.ts");
  const revoked = await revokeToken(patUserId, patId);
  assert.equal(revoked, true, "revokeToken must report success on a live token");

  const denied = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${patSecret}` },
  });
  assert.equal(denied.status, 401, "revoked PAT must be rejected");
  // Error envelope contract: revoked tokens get an RFC 7807 problem
  // document, not a bare {message: …} JSON blob.
  const contentType = denied.headers.get("content-type") ?? "";
  assert.match(contentType, /application\/problem\+json/);
  const body = (await denied.json()) as Record<string, unknown>;
  assert.equal(body.status, 401);
  assert.equal(typeof body.type, "string");
  assert.match(String(body.type), /\/invalid-token$/);
  assert.equal(body.title, "Unauthorized");
  assert.equal(typeof body.detail, "string");
});

test("Replaying a POST with the same Idempotency-Key returns the same body and Idempotent-Replayed: true", async () => {
  // POST /api/account/tokens is the most natural write endpoint for this
  // assertion: it returns a 201 + JSON envelope and must not double-create
  // when the client retries with the same Idempotency-Key. We authenticate
  // with a JWT (not a PAT) because the route forbids PATs from minting
  // other PATs.
  const idempotencyKey = `it-${crypto.randomUUID()}`;
  const tokenName = `integration-replay-${crypto.randomUUID()}`;
  const requestBody = JSON.stringify({ name: tokenName, scope: "read" });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    "idempotency-key": idempotencyKey,
    authorization: `Bearer ${adminAccessJwt}`,
  };

  const first = await fetch(`${baseUrl}/api/account/tokens`, {
    method: "POST",
    headers,
    body: requestBody,
  });
  assert.equal(first.status, 201, "first POST must succeed");
  assert.equal(
    first.headers.get("idempotent-replayed"),
    null,
    "the original request is NOT a replay",
  );
  const firstBody = await first.text();
  const firstParsed = JSON.parse(firstBody) as {
    token: { id: string };
    secret: string;
  };
  assert.ok(firstParsed.token?.id, "response must include the new token id");
  assert.ok(
    firstParsed.secret?.startsWith("cs_pat_"),
    "response must include the freshly minted secret",
  );
  idempotentlyCreatedPatIds.push(firstParsed.token.id);

  // Replay with the IDENTICAL body. Per Stripe-style semantics the server
  // must return the exact same status, body, and content-type, plus the
  // Idempotent-Replayed: true marker so the client knows it was a cache
  // hit instead of a fresh execution.
  const second = await fetch(`${baseUrl}/api/account/tokens`, {
    method: "POST",
    headers,
    body: requestBody,
  });
  assert.equal(second.status, 201, "replay must echo the original status");
  assert.equal(
    second.headers.get("idempotent-replayed"),
    "true",
    "replay must set Idempotent-Replayed: true",
  );
  const secondBody = await second.text();
  assert.equal(
    secondBody,
    firstBody,
    "replay body must be byte-identical to the cached response",
  );

  // Confirm the database really only has the one PAT we created — no
  // duplicate row from a re-executed handler.
  const { db } = await import("@workspace/db");
  const { personalAccessTokens } = await import("@workspace/db/schema");
  const { and: andOp, eq: eqOp } = await import("drizzle-orm");
  const rows = await db
    .select({ id: personalAccessTokens.id })
    .from(personalAccessTokens)
    .where(
      andOp(
        eqOp(personalAccessTokens.userId, adminUserId),
        eqOp(personalAccessTokens.name, tokenName),
      ),
    );
  assert.equal(
    rows.length,
    1,
    "idempotent replay must NOT create a second PAT row",
  );
});

test("Cursor walk on /jobs crosses a page boundary with no duplicates and no skipped rows", async () => {
  // 5 seeded jobs + limit=2 forces a page boundary on every step:
  // page 1 → 2 rows + nextCursor, page 2 → 2 rows + nextCursor,
  // page 3 → 1 row + hasMore=false. Walking the full cursor chain must
  // visit every seeded id exactly once.
  const seenInOrder: string[] = [];
  let nextCursor: string | null = "";
  let pages = 0;

  while (true) {
    pages += 1;
    assert.ok(pages <= 10, "cursor walk should terminate well before 10 pages");

    const url = new URL(`${baseUrl}/api/jobs`);
    url.searchParams.set("limit", "2");
    // Constrain the result set to ONLY this suite's seeded jobs. Without
    // this filter, leftover rows from sibling suites can extend the walk
    // past the seeded 5, expanding the page count unpredictably.
    url.searchParams.set("search", cursorJobMarker);
    if (nextCursor !== null) {
      url.searchParams.set("cursor", nextCursor);
    }

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${adminAccessJwt}` },
    });
    assert.equal(response.status, 200, `page ${pages} must return 200`);
    const body = (await response.json()) as {
      jobs: Array<{ id: string }>;
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
    };

    assert.ok(Array.isArray(body.jobs), `page ${pages} must include jobs[]`);
    assert.equal(
      typeof body.pagination.hasMore,
      "boolean",
      `page ${pages} must signal hasMore`,
    );

    for (const row of body.jobs) {
      seenInOrder.push(row.id);
    }

    if (!body.pagination.hasMore) {
      assert.equal(
        body.pagination.nextCursor,
        null,
        "final page must clear nextCursor",
      );
      break;
    }

    assert.ok(
      body.pagination.nextCursor,
      `page ${pages} reports hasMore but did not return a cursor`,
    );
    nextCursor = body.pagination.nextCursor;
  }

  // The `search=` filter pins the response to exactly this suite's
  // seeded rows, so the walk must visit each of the 5 jobs exactly once
  // (no duplicates, no skipped rows, no extra rows leaking in from other
  // suites).
  const seenSet = new Set(seenInOrder);
  assert.equal(
    seenInOrder.length,
    cursorJobIds.length,
    `cursor walk visited ${seenInOrder.length} rows, expected ${cursorJobIds.length}: ${JSON.stringify(seenInOrder)}`,
  );
  assert.equal(
    seenSet.size,
    cursorJobIds.length,
    `cursor walk produced duplicates: ${JSON.stringify(seenInOrder)}`,
  );
  for (const id of cursorJobIds) {
    assert.ok(
      seenSet.has(id),
      `seeded job ${id} was skipped across the cursor boundary`,
    );
  }

  // Order must match the expected DESC(createdAt) ordering — i.e. job 0
  // (newest) before job 4 (oldest). This guards against a regression that
  // returns rows but in the wrong order across the boundary.
  assert.deepEqual(
    seenInOrder,
    cursorJobIds,
    "cursor walk must preserve the DESC(createdAt) ordering across pages",
  );
});
