import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let server: Server;
let baseUrl: string;
let adminToken: string;

const adminUserId = crypto.randomUUID();
const jobId = crypto.randomUUID();

// Twelve seeded logs against one job. logDate decreases by index so the
// natural ORDER BY (logDate desc, createdAt desc, id desc) produces a
// deterministic walk where index 0 is the newest. Six of them belong to
// the "alpha" tag and six to "beta" so cursor-mode multi-tag filtering
// still has to cross a page boundary at limit=3.
const logCount = 12;
const dailyLogIds: string[] = Array.from({ length: logCount }, () =>
  crypto.randomUUID(),
);

function dayFor(i: number) {
  // Distinct dates within a single month so logDate is a unique sort key.
  return `2025-05-${String(logCount - i).padStart(2, "0")}`;
}

function tagFor(i: number) {
  // Even indices → "alpha" (6 rows: 0,2,4,6,8,10), odd indices →
  // "beta" (6 rows: 1,3,5,7,9,11). Ensures both tags appear on every
  // page at limit=3.
  return i % 2 === 0 ? "alpha" : "beta";
}

// Per-run marker so the keywords filter test cannot match leftover
// rows from sibling suites sharing the same database.
const runMarker = `cursor-walk-${crypto.randomUUID()}`;

function notesFor(i: number) {
  // Embed a high-cardinality marker so the keywords filter test can
  // single out exactly one row.
  return `cursor-test seed log ${i} ${runMarker}-${i}`;
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
  const { users, jobs, dailyLogs, dailyLogTags } = await import(
    "@workspace/db/schema"
  );

  await prepareApp();

  const adminEmail = `admin-${adminUserId}@daily-logs-cursor-test.local`;
  await db.insert(users).values({
    id: adminUserId,
    email: adminEmail,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Daily Logs Cursor Admin",
    role: "admin",
  });

  await db.insert(jobs).values({
    id: jobId,
    title: "ZZZ Daily Logs Cursor Job",
    createdBy: adminUserId,
    projectManagerId: adminUserId,
  });

  const baseTime = Date.now();
  // Seed 12 logs with varied share flags so the `sharedWith` filter can
  // single out a known subset:
  //   - rows 0,3,6,9 → shareSubsVendors=true (4 rows)
  //   - rows 1,4,7,10 → shareClient=true (4 rows)
  //   - row 11 → isPrivate=true (1 row, plus visible to admin)
  //   - everything else → shareInternalUsers=true (default)
  await db.insert(dailyLogs).values(
    dailyLogIds.map((id, i) => ({
      id,
      jobId,
      logDate: dayFor(i),
      title: `ZZZ Cursor Log ${i}`,
      notes: notesFor(i),
      createdBy: adminUserId,
      // Distinct createdAt timestamps so the (logDate, createdAt, id)
      // cursor tuple is fully deterministic even if logDates collide
      // someday.
      createdAt: new Date(baseTime - i * 1000),
      updatedAt: new Date(baseTime - i * 1000),
      shareInternalUsers: true,
      shareSubsVendors: i % 3 === 0,
      shareClient: i % 3 === 1,
      isPrivate: i === 11,
    })),
  );

  await db.insert(dailyLogTags).values(
    dailyLogIds.map((id, i) => ({
      dailyLogId: id,
      tagName: tagFor(i),
    })),
  );

  adminToken = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Daily Logs Cursor Admin",
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
  const { users, jobs, dailyLogs, dailyLogTags } = await import(
    "@workspace/db/schema"
  );
  const { inArray, eq } = await import("drizzle-orm");

  try {
    await db
      .delete(dailyLogTags)
      .where(inArray(dailyLogTags.dailyLogId, dailyLogIds));
    await db.delete(dailyLogs).where(inArray(dailyLogs.id, dailyLogIds));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

type CursorPage = {
  logs: Array<{
    id: string;
    logDate: string;
    notes: string;
    title: string | null;
    tags: string[];
    isPrivate?: boolean;
    shareSubsVendors?: boolean;
    shareClient?: boolean;
  }>;
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
};

async function fetchPage(
  params: Record<string, string | string[]>,
): Promise<CursorPage> {
  const url = new URL(`${baseUrl}/api/jobs/${jobId}/daily-logs`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, v);
    } else {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(
    response.status,
    200,
    `GET ${url.pathname}${url.search} must return 200, got ${response.status}: ${await response.text()}`,
  );
  return (await response.json()) as CursorPage;
}

async function fetchSeededLogs(params: Record<string, string | string[]> = {}) {
  // Drain the cursor chain and return only the rows we seeded so leftover
  // rows from other tests sharing the same DB cannot pollute assertions.
  const seededIds = new Set(dailyLogIds);
  const collected: CursorPage["logs"] = [];
  let cursor: string | null = "";
  let pages = 0;
  while (cursor !== null) {
    pages += 1;
    assert.ok(pages <= 50, "cursor walk should terminate well before 50 pages");
    const page: CursorPage = await fetchPage({
      cursor,
      limit: "5",
      ...params,
    });
    for (const log of page.logs) {
      if (seededIds.has(log.id)) collected.push(log);
    }
    cursor = page.pagination.hasMore ? page.pagination.nextCursor : null;
  }
  return collected;
}

test("GET /jobs/:jobId/daily-logs first cursor page returns hasMore + nextCursor", async () => {
  // Bootstrap form: `?cursor=&limit=3` is the canonical "give me the
  // first cursor page" request. With 12 seeded logs and limit=3 the
  // server must report hasMore=true and a non-empty nextCursor.
  const page = await fetchPage({ cursor: "", limit: "3" });

  assert.equal(page.logs.length, 3, "first cursor page must honor limit=3");
  assert.equal(page.pagination.limit, 3);
  assert.equal(page.pagination.hasMore, true);
  assert.equal(typeof page.pagination.nextCursor, "string");
  assert.ok(
    (page.pagination.nextCursor ?? "").length > 0,
    "nextCursor must be a non-empty opaque token",
  );

  // The cursor envelope is opaque base64url. Decoding it on the wire
  // would couple this test to the encoding format, so just sanity-check
  // the URL-safe shape.
  assert.match(page.pagination.nextCursor!, /^[A-Za-z0-9_-]+$/);
});

test("Walking the cursor chain visits every seeded log exactly once", async () => {
  // limit=3 + 12 seeded rows → 4 pages. Walking the chain must visit
  // every seeded id, with no duplicates and no skipped rows. Because
  // the daily-logs DB is shared across tests, we filter to seeded ids.
  const seededIds = new Set(dailyLogIds);
  const seenInOrder: string[] = [];
  let cursor: string | null = "";
  let pages = 0;

  while (cursor !== null) {
    pages += 1;
    assert.ok(pages <= 20, "cursor walk should terminate well before 20 pages");
    const page = await fetchPage({ cursor, limit: "3" });

    for (const log of page.logs) {
      if (seededIds.has(log.id)) seenInOrder.push(log.id);
    }
    if (page.pagination.hasMore) {
      assert.ok(
        page.pagination.nextCursor,
        "hasMore=true must come with a nextCursor",
      );
      cursor = page.pagination.nextCursor;
    } else {
      assert.equal(
        page.pagination.nextCursor,
        null,
        "hasMore=false must come with nextCursor=null",
      );
      cursor = null;
    }
  }

  assert.equal(
    new Set(seenInOrder).size,
    seenInOrder.length,
    "cursor walk must NOT duplicate any row",
  );
  for (const id of dailyLogIds) {
    assert.ok(
      seenInOrder.includes(id),
      `cursor walk must visit seeded log ${id}`,
    );
  }
  // The ORDER BY is (logDate desc, createdAt desc, id desc). Our seed
  // assigns logDate descending with index, so the natural walk order
  // matches the `dailyLogIds` index order.
  const seededInWalkOrder = seenInOrder.filter((id) => seededIds.has(id));
  assert.deepEqual(
    seededInWalkOrder,
    [...dailyLogIds],
    "cursor walk must produce rows in (logDate desc, createdAt desc, id desc) order",
  );
});

test("Cursor mode honors the `keywords` filter", async () => {
  // The seeded notes carry `<runMarker>-<index>`. Filtering by the
  // index-7 marker singles out exactly one seeded row, and the
  // per-run UUID keeps leftover rows from other suites out of the
  // result set.
  const collected = await fetchSeededLogs({ keywords: `${runMarker}-7` });
  assert.equal(
    collected.length,
    1,
    `exactly one seeded log must match ${runMarker}-7`,
  );
  assert.equal(collected[0]!.id, dailyLogIds[7]);
});

test("Cursor mode honors the `tags` filter (single + multi-value)", async () => {
  const alphaIds = dailyLogIds.filter((_, i) => i % 2 === 0);
  const collectedAlpha = await fetchSeededLogs({ tags: "alpha" });
  const collectedAlphaIds = collectedAlpha.map((log) => log.id);
  assert.equal(
    collectedAlphaIds.length,
    alphaIds.length,
    `tags=alpha must return all ${alphaIds.length} seeded alpha logs`,
  );
  for (const id of alphaIds) {
    assert.ok(
      collectedAlphaIds.includes(id),
      `tags=alpha must include seeded log ${id}`,
    );
  }
  for (const log of collectedAlpha) {
    assert.ok(
      log.tags.includes("alpha"),
      "every returned log must actually carry the alpha tag",
    );
  }

  // Multi-tag filter: `alpha,beta` is "all of" — no seeded log carries
  // both, so nothing should come back.
  const collectedBoth = await fetchSeededLogs({ tags: "alpha,beta" });
  assert.equal(
    collectedBoth.length,
    0,
    "multi-tag filter is intersect-not-union: no seeded log carries both alpha AND beta",
  );
});

test("Cursor mode honors the `from` and `to` date filters", async () => {
  // Logs are seeded across 2025-05-01..2025-05-12 (logDate = 2025-05-${12-i}).
  // from=2025-05-05&to=2025-05-08 brackets exactly four seeded logs:
  // logDate 2025-05-05 (i=7), 06 (i=6), 07 (i=5), 08 (i=4).
  const collected = await fetchSeededLogs({
    from: "2025-05-05",
    to: "2025-05-08",
  });
  const expectedIds = [4, 5, 6, 7].map((i) => dailyLogIds[i]);
  const collectedIds = new Set(collected.map((log) => log.id));
  assert.equal(
    collected.length,
    expectedIds.length,
    `from/to bracket must return exactly ${expectedIds.length} seeded rows`,
  );
  for (const id of expectedIds) {
    assert.ok(
      collectedIds.has(id),
      `from/to bracket must include seeded log ${id}`,
    );
  }
  for (const log of collected) {
    assert.ok(
      log.logDate >= "2025-05-05" && log.logDate <= "2025-05-08",
      `returned log ${log.id} (logDate=${log.logDate}) is outside the from/to range`,
    );
  }
});

test("Cursor mode honors the `sharedWith` filter", async () => {
  // sharedWith=subs_vendors filters to shareSubsVendors=true.
  // Seed assigns shareSubsVendors=true when i % 3 === 0 → indices 0,3,6,9.
  const subsExpected = dailyLogIds.filter((_, i) => i % 3 === 0);
  const collectedSubs = await fetchSeededLogs({ sharedWith: "subs_vendors" });
  const collectedSubsIds = new Set(collectedSubs.map((log) => log.id));
  assert.equal(
    collectedSubs.length,
    subsExpected.length,
    `sharedWith=subs_vendors must return exactly ${subsExpected.length} seeded rows`,
  );
  for (const id of subsExpected) {
    assert.ok(
      collectedSubsIds.has(id),
      `sharedWith=subs_vendors must include seeded log ${id}`,
    );
  }

  // sharedWith=client → shareClient=true → indices 1,4,7,10.
  const clientExpected = dailyLogIds.filter((_, i) => i % 3 === 1);
  const collectedClient = await fetchSeededLogs({ sharedWith: "client" });
  const collectedClientIds = new Set(collectedClient.map((log) => log.id));
  assert.equal(
    collectedClient.length,
    clientExpected.length,
    `sharedWith=client must return exactly ${clientExpected.length} seeded rows`,
  );
  for (const id of clientExpected) {
    assert.ok(
      collectedClientIds.has(id),
      `sharedWith=client must include seeded log ${id}`,
    );
  }

  // sharedWith=private → isPrivate=true → exactly one seeded row (index
  // 11). Asserting the count guards against a regression where the
  // private filter silently degrades to "no filter" and lets every
  // seeded log through.
  const collectedPrivate = await fetchSeededLogs({ sharedWith: "private" });
  assert.equal(
    collectedPrivate.length,
    1,
    "sharedWith=private must return exactly one seeded log",
  );
  assert.equal(
    collectedPrivate[0]!.id,
    dailyLogIds[11]!,
    "sharedWith=private must return the one seeded private log",
  );
});

test("Cursor mode rejects an invalid cursor with 400", async () => {
  const url = new URL(`${baseUrl}/api/jobs/${jobId}/daily-logs`);
  url.searchParams.set("cursor", "not-a-real-cursor");
  url.searchParams.set("limit", "3");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(
    response.status,
    400,
    "malformed cursor token must surface as a 400, not a 500",
  );
});
