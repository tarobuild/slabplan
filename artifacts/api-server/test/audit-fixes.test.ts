// Regression tests for Task #277 — authorization & data-integrity fixes
// surfaced in the platform audit. Each `test(...)` below pins exactly one
// of the six items in the task spec so a future regression fails the
// most specific check possible.
//
//   1. POST /jobs — PM cannot assign a different PM (403, not silent
//      override).
//   2. DELETE /clients/:id — non-admin (PM) cannot delete a client even
//      one they can otherwise see.
//   3. CHECK constraint `jobs_amount_paid_lte_contract_check` rejects
//      direct-DB violations of `amount_paid_cents <= contract_value_cents`.
//   4. applyInvoiceMatches issues a single batched UPDATE for N matches
//      (verified by behaviour: N=50 matches all land with correct
//      billed_cents in one request).
//   5. PATCH /jobs/:jobId/financials/invoices/:invoiceId/matches rejects
//      the *whole* request when ANY referenced line item belongs to a
//      different job (single batched ownership check, not a partial
//      apply).
//   6. GET /agent/conversations supports cursor pagination — `?cursor=`
//      returns nextCursor and walking the cursor visits every row in
//      the (pinned, last_message_at, id) DESC order without overlap.

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
let adminToken: string;
let pmToken: string;
let crewToken: string;

const adminUserId = crypto.randomUUID();
const pmUserId = crypto.randomUUID();
const otherPmUserId = crypto.randomUUID();
const crewUserId = crypto.randomUUID();
const foreignJobId = crypto.randomUUID();
const ownedDailyLogId = crypto.randomUUID();
const foreignDailyLogId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const otherClientId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const otherJobId = crypto.randomUUID();
const checkConstraintJobId = crypto.randomUUID();

// Financials seed (one tracker, one area, many line items so we can
// build a 50-match invoice for the batched-update test).
let trackerId: string;
let otherTrackerId: string;
let areaId: string;
const lineItemIds: string[] = Array.from({ length: 50 }, () =>
  crypto.randomUUID(),
);
const otherJobLineItemId = crypto.randomUUID();
let invoiceId: string;

// Conversation seed — ten conversations across two pinned/unpinned
// buckets so the cursor walk has to cross the pinned boundary.
const conversationCount = 10;
const conversationIds: string[] = Array.from({ length: conversationCount }, () =>
  crypto.randomUUID(),
);

const adminEmail = `admin-${adminUserId}@audit-fixes-test.local`;
const pmEmail = `pm-${pmUserId}@audit-fixes-test.local`;
const otherPmEmail = `pm2-${otherPmUserId}@audit-fixes-test.local`;
const crewEmail = `crew-${crewUserId}@audit-fixes-test.local`;
const adminPassword = "AuditFixes!Pass1";

function makePublicUser(
  id: string,
  role: string,
  email: string,
  fullName: string,
) {
  return {
    id,
    email,
    fullName,
    role,
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return {
    ...authHeaders(token),
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

  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const {
    users,
    clients,
    jobs,
    financialTrackers,
    sovAreas,
    sovLineItems,
    trackerInvoices,
    agentConversations,
    dailyLogs,
  } = await import("@workspace/db/schema");

  await prepareApp();

  // Rate-limit buckets now live in Postgres (Task #296), shared across
  // every test process and run. Wipe any rows leftover from earlier
  // suites/runs so the login burst + reset-on-success tests below
  // start from a clean per-IP / per-email window.
  const { pool } = await import("@workspace/db");
  await pool.query("delete from rate_limit_buckets");

  // Real bcrypt hash for the admin so the login + reset-on-success test
  // below can perform an actual `/api/auth/login` round-trip. Cost 4 is
  // intentional — secure enough for a throwaway test fixture, fast
  // enough not to add seconds to the suite.
  const bcrypt = (await import("bcrypt")).default;
  const adminPasswordHash = await bcrypt.hash(adminPassword, 4);

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: adminPasswordHash,
      fullName: "ZZZ Audit Fixes Admin",
      role: "admin",
    },
    {
      id: pmUserId,
      email: pmEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Audit Fixes PM",
      role: "project_manager",
    },
    {
      id: otherPmUserId,
      email: otherPmEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Audit Fixes Other PM",
      role: "project_manager",
    },
    {
      id: crewUserId,
      email: crewEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Audit Fixes Crew",
      role: "crew_member",
    },
  ]);

  await db.insert(clients).values([
    {
      id: clientId,
      companyName: `ZZZ Audit Fixes Client ${clientId}`,
      createdBy: adminUserId,
    },
    {
      id: otherClientId,
      companyName: `ZZZ Audit Fixes Other Client ${otherClientId}`,
      createdBy: adminUserId,
    },
  ]);

  await db.insert(jobs).values([
    {
      id: jobId,
      title: "ZZZ Audit Fixes Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: pmUserId,
    },
    {
      id: otherJobId,
      title: "ZZZ Audit Fixes Other Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: pmUserId,
    },
    {
      // A job NOT managed by `pmUserId` so we can test daily-log
      // edit/delete from a non-owner non-PM perspective without the
      // canManageJob carve-out kicking in.
      id: foreignJobId,
      title: "ZZZ Audit Fixes Foreign Job",
      clientId,
      createdBy: adminUserId,
      projectManagerId: otherPmUserId,
    },
  ]);

  // Financials seed — explicit tracker + area + 50 line items so we
  // can build a 50-match invoice request for the batched-update path.
  // Each line item has scheduled = $100 / 10000c so applying $1 / 100c
  // per match is well below the cap.
  trackerId = crypto.randomUUID();
  otherTrackerId = crypto.randomUUID();
  areaId = crypto.randomUUID();
  await db.insert(financialTrackers).values([
    { id: trackerId, jobId, createdBy: adminUserId },
    { id: otherTrackerId, jobId: otherJobId, createdBy: adminUserId },
  ]);
  const otherAreaId = crypto.randomUUID();
  await db.insert(sovAreas).values([
    {
      id: areaId,
      trackerId,
      name: "Audit Area",
      sortIndex: 0,
    },
    {
      id: otherAreaId,
      trackerId: otherTrackerId,
      name: "Audit Other Area",
      sortIndex: 0,
    },
  ]);
  await db.insert(sovLineItems).values([
    ...lineItemIds.map((id, i) => ({
      id,
      areaId,
      description: `LI ${i}`,
      qty: "1",
      rateCents: 10000,
      scheduledValueCents: 10000,
      sortIndex: i,
    })),
    {
      id: otherJobLineItemId,
      areaId: otherAreaId,
      description: "Other-job LI",
      qty: "1",
      rateCents: 10000,
      scheduledValueCents: 10000,
      sortIndex: 0,
    },
  ]);
  invoiceId = crypto.randomUUID();
  await db.insert(trackerInvoices).values({
    id: invoiceId,
    trackerId,
    invoiceNumber: "INV-AUDIT-1",
    invoiceDate: "2026-05-01",
    totalCents: 50_000,
    fileId: null,
    rawAiResponse: {},
    createdBy: adminUserId,
  });

  // Daily-log seed — both logs are created by `pmUserId` (NOT admin)
  // so the admin override PUT/DELETE tests below genuinely exercise the
  // non-owner bypass path (admin is neither creator nor PM-of-job for
  // `foreignDailyLogId`, and not the creator of `ownedDailyLogId`
  // either). The crew_member 403 tests target `foreignDailyLogId`,
  // where crew is not the creator, not admin, and not the PM
  // (`otherPmUserId` is) — so the only path that could let crew through
  // is the admin override they don't have.
  await db.insert(dailyLogs).values([
    {
      id: ownedDailyLogId,
      jobId,
      logDate: "2026-05-01",
      title: "ZZZ Audit Owned Log",
      notes: "",
      createdBy: pmUserId,
    },
    {
      id: foreignDailyLogId,
      jobId: foreignJobId,
      logDate: "2026-05-02",
      title: "ZZZ Audit Foreign Log",
      notes: "",
      createdBy: pmUserId,
    },
  ]);

  // Agent conversations seed — half pinned, all owned by `pmUserId`.
  // lastMessageAt strictly decreasing so the (pinned, lastMessageAt, id)
  // walk is fully deterministic. Pinned rows sort to page 1 first.
  const baseTime = Date.now();
  await db.insert(agentConversations).values(
    conversationIds.map((id, i) => ({
      id,
      userId: pmUserId,
      title: `ZZZ Audit Conv ${i}`,
      pinned: i < 4, // first four are pinned
      lastMessageAt: new Date(baseTime - i * 1000),
      createdAt: new Date(baseTime - i * 1000),
      updatedAt: new Date(baseTime - i * 1000),
    })),
  );

  adminToken = auth.signAccessToken(
    makePublicUser(adminUserId, "admin", adminEmail, "ZZZ Audit Fixes Admin"),
  );
  pmToken = auth.signAccessToken(
    makePublicUser(
      pmUserId,
      "project_manager",
      pmEmail,
      "ZZZ Audit Fixes PM",
    ),
  );
  crewToken = auth.signAccessToken(
    makePublicUser(crewUserId, "crew_member", crewEmail, "ZZZ Audit Fixes Crew"),
  );

  server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { users, clients, jobs, agentConversations } = await import(
    "@workspace/db/schema"
  );
  const { eq, inArray } = await import("drizzle-orm");
  try {
    await db
      .delete(agentConversations)
      .where(inArray(agentConversations.id, conversationIds));
    await db
      .delete(jobs)
      .where(
        inArray(jobs.id, [jobId, otherJobId, foreignJobId, checkConstraintJobId]),
      );
    await db
      .delete(clients)
      .where(inArray(clients.id, [clientId, otherClientId]));
    await db
      .delete(users)
      .where(
        inArray(users.id, [adminUserId, pmUserId, otherPmUserId, crewUserId]),
      );
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await pool.end();
  }
});

// -- 1. POST /jobs is admin-only (post-#277 owner directive) ---------------
//
// Owner clarified: only admins create jobs and assign people. The earlier
// "PM may create with self as PM" carve-out is gone — every non-admin
// caller, including PM, must get a 403.

test("POST /jobs — PM is rejected 403 even when setting self as PM", async () => {
  const res = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: jsonHeaders(pmToken),
    body: JSON.stringify({
      title: "PM self-create attempt",
      clientId,
      projectManagerId: pmUserId,
    }),
  });
  assert.equal(res.status, 403);
});

test("POST /jobs — PM is rejected 403 when omitting projectManagerId", async () => {
  const res = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: jsonHeaders(pmToken),
    body: JSON.stringify({
      title: "PM omit-PM attempt",
      clientId,
    }),
  });
  assert.equal(res.status, 403);
});

test("POST /jobs — PM is rejected 403 when setting another PM", async () => {
  const res = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: jsonHeaders(pmToken),
    body: JSON.stringify({
      title: "PM-foreign-PM attempt",
      clientId,
      projectManagerId: otherPmUserId,
    }),
  });
  assert.equal(res.status, 403);
});

test("POST /jobs — admin can create and assign any PM + workers", async () => {
  const res = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      title: "ZZZ Audit Admin create",
      clientId,
      projectManagerId: otherPmUserId,
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    job: { id: string; projectManagerId: string };
  };
  assert.equal(body.job.projectManagerId, otherPmUserId);
  const { db } = await import("@workspace/db");
  const { jobs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.delete(jobs).where(eq(jobs.id, body.job.id));
});

// -- 1b. POST /leads/:id/convert-to-job is also admin-only -----------------
//
// Previously the lead-conversion path only required manager-or-above and
// quietly inserted into `jobs`, allowing PMs to create jobs indirectly.

test("POST /leads/:id/convert-to-job — PM is rejected 403", async () => {
  const { db } = await import("@workspace/db");
  const { leads } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [lead] = await db
    .insert(leads)
    .values({
      title: "ZZZ Audit Lead for PM convert attempt",
      status: "qualified",
      createdBy: pmUserId,
    })
    .returning();
  try {
    const res = await fetch(
      `${baseUrl}/api/leads/${lead.id}/convert-to-job`,
      { method: "POST", headers: jsonHeaders(pmToken), body: "{}" },
    );
    assert.equal(res.status, 403);
  } finally {
    await db.delete(leads).where(eq(leads.id, lead.id));
  }
});

// -- 2. DELETE /clients/:id ownership/role check ---------------------------

test("DELETE /clients/:id — PM (non-admin) is rejected 403", async () => {
  const res = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "DELETE",
    headers: authHeaders(pmToken),
  });
  // requireAdmin runs first — PMs can't delete clients regardless of
  // resource visibility.
  assert.equal(res.status, 403);
  // Sanity: client still exists.
  const { db } = await import("@workspace/db");
  const { clients } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select().from(clients).where(eq(clients.id, clientId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deletedAt, null);
});

// -- 3. CHECK constraint on jobs.amount_paid_cents <= contract_value_cents -

test(
  "DB CHECK jobs_amount_paid_lte_contract_check is registered on the table (Task #277 audit item 3)",
  async () => {
    // Defensive: query pg_constraint directly so a future migration
    // that drops the constraint fails this test even before the
    // behavioral check below has a chance to.
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      select 1
        from pg_constraint
       where conname = 'jobs_amount_paid_lte_contract_check'
         and conrelid = 'public.jobs'::regclass
    `);
    assert.ok(
      (result as unknown as { rows?: unknown[] }).rows?.length ||
        (Array.isArray(result) ? result.length : 0),
      "expected jobs_amount_paid_lte_contract_check to exist on public.jobs",
    );
  },
);

test(
  "DB CHECK jobs_amount_paid_lte_contract_check rejects amount_paid > contract_value",
  async () => {
    const { db } = await import("@workspace/db");
    const { jobs } = await import("@workspace/db/schema");
    let threw = false;
    try {
      await db.insert(jobs).values({
        id: checkConstraintJobId,
        title: "ZZZ Audit Check Constraint Job",
        clientId,
        createdBy: adminUserId,
        projectManagerId: adminUserId,
        contractValueCents: 100,
        amountPaidCents: 500, // violates the CHECK
      });
    } catch (err) {
      threw = true;
      const msg = String((err as Error).message ?? "");
      assert.match(msg, /jobs_amount_paid_lte_contract_check/);
    }
    assert.equal(threw, true, "expected CHECK violation to throw");
  },
);

test("DB CHECK allows amount_paid <= contract_value", async () => {
  const { db } = await import("@workspace/db");
  const { jobs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  await db.insert(jobs).values({
    id: checkConstraintJobId,
    title: "ZZZ Audit Check Constraint Job (valid)",
    clientId,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
    contractValueCents: 1000,
    amountPaidCents: 1000,
  });
  // immediate cleanup so `after` doesn't have to handle it
  await db.delete(jobs).where(eq(jobs.id, checkConstraintJobId));
});

// -- 4 & 5. Batched applyInvoiceMatches + batched ownership check ----------

test(
  "PATCH /financials/invoices/:id/matches — 50-match batch applies cleanly and updates billed_cents",
  async () => {
    const matches = lineItemIds.map((id) => ({
      sovLineItemId: id,
      amountCents: 100, // $1 each, well under the $100 cap
    }));
    const res = await fetch(
      `${baseUrl}/api/jobs/${jobId}/financials/invoices/${invoiceId}/matches`,
      {
        method: "PATCH",
        headers: jsonHeaders(adminToken),
        body: JSON.stringify({ matches }),
      },
    );
    assert.equal(res.status, 200);
    // Verify every line item got billed = 100 (proves the batched
    // UPDATE FROM VALUES touched all rows correctly).
    const { db } = await import("@workspace/db");
    const { sovLineItems } = await import("@workspace/db/schema");
    const { inArray } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: sovLineItems.id,
        billed: sovLineItems.billedCents,
        pct: sovLineItems.percentComplete,
      })
      .from(sovLineItems)
      .where(inArray(sovLineItems.id, lineItemIds));
    assert.equal(rows.length, 50);
    for (const r of rows) {
      assert.equal(Number(r.billed), 100);
      assert.equal(Number(r.pct), 1); // 100 / 10000 = 1%
    }
  },
);

test(
  "PATCH /financials/invoices/:id/matches — rejects whole batch when one line item belongs to another job (403, no partial apply)",
  async () => {
    // Snapshot current billed totals so we can prove NOTHING moved.
    const { db } = await import("@workspace/db");
    const { sovLineItems } = await import("@workspace/db/schema");
    const { inArray } = await import("drizzle-orm");
    const before = await db
      .select({ id: sovLineItems.id, billed: sovLineItems.billedCents })
      .from(sovLineItems)
      .where(inArray(sovLineItems.id, [...lineItemIds, otherJobLineItemId]));
    const beforeMap = new Map(before.map((r) => [r.id, Number(r.billed)]));

    const matches = [
      { sovLineItemId: lineItemIds[0], amountCents: 50 },
      // foreign-job id mixed in — must blow up the whole batch
      { sovLineItemId: otherJobLineItemId, amountCents: 50 },
      { sovLineItemId: lineItemIds[1], amountCents: 50 },
    ];
    const res = await fetch(
      `${baseUrl}/api/jobs/${jobId}/financials/invoices/${invoiceId}/matches`,
      {
        method: "PATCH",
        headers: jsonHeaders(adminToken),
        body: JSON.stringify({ matches }),
      },
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.match(
      body.error?.message ?? "",
      /do not belong to this job/i,
    );

    const after = await db
      .select({ id: sovLineItems.id, billed: sovLineItems.billedCents })
      .from(sovLineItems)
      .where(inArray(sovLineItems.id, [...lineItemIds, otherJobLineItemId]));
    for (const r of after) {
      assert.equal(
        Number(r.billed),
        beforeMap.get(r.id) ?? 0,
        `billed_cents must be unchanged for ${r.id}`,
      );
    }
  },
);

// -- 6. Cursor pagination on /agent/conversations --------------------------

test(
  "GET /agent/conversations — legacy mode (no cursor) returns up to 100 rows without pagination block",
  async () => {
    const res = await fetch(`${baseUrl}/api/agent/conversations`, {
      headers: authHeaders(pmToken),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      conversations: Array<{ id: string }>;
      pagination?: unknown;
    };
    assert.equal(body.pagination, undefined);
    const seen = new Set(body.conversations.map((c) => c.id));
    for (const id of conversationIds) {
      assert.ok(seen.has(id), `legacy mode missing conversation ${id}`);
    }
  },
);

test(
  "GET /agent/conversations?cursor= — walks every row exactly once in (pinned, lastMessageAt, id) DESC",
  async () => {
    const seen: string[] = [];
    let cursor = "";
    let hasMore = true;
    let safety = 20;
    while (hasMore && safety-- > 0) {
      const url = new URL(`${baseUrl}/api/agent/conversations`);
      url.searchParams.set("cursor", cursor);
      url.searchParams.set("limit", "3");
      const res = await fetch(url, { headers: authHeaders(pmToken) });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        conversations: Array<{
          id: string;
          pinned: boolean;
          lastMessageAt: string;
        }>;
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
      for (const c of body.conversations) seen.push(c.id);
      hasMore = body.pagination.hasMore;
      cursor = body.pagination.nextCursor ?? "";
    }

    // Every seeded conversation appears exactly once.
    const seenSet = new Set(seen);
    assert.equal(seen.length, seenSet.size, "no duplicates across pages");
    for (const id of conversationIds) {
      assert.ok(seenSet.has(id), `cursor walk missed ${id}`);
    }

    // Pinned rows (first 4 seeded) must precede the unpinned rows in
    // the walk order.
    const pinnedIds = new Set(conversationIds.slice(0, 4));
    let lastPinnedIdx = -1;
    let firstUnpinnedIdx = seen.length;
    seen.forEach((id, i) => {
      if (pinnedIds.has(id)) lastPinnedIdx = Math.max(lastPinnedIdx, i);
      else firstUnpinnedIdx = Math.min(firstUnpinnedIdx, i);
    });
    assert.ok(
      lastPinnedIdx < firstUnpinnedIdx,
      "all pinned conversations must come before any unpinned in cursor walk",
    );
  },
);

test(
  "GET /agent/conversations?cursor=garbage — invalid cursor is rejected 400",
  async () => {
    const res = await fetch(
      `${baseUrl}/api/agent/conversations?cursor=not-a-real-cursor`,
      { headers: authHeaders(pmToken) },
    );
    assert.equal(res.status, 400);
  },
);

// -- 7. POST /jobs/:id/assignees role gate (Task #288) ---------------------
//
// `requireAdmin` must reject PM and crew before the handler runs.

test("POST /jobs/:id/assignees — PM is rejected 403", async () => {
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/assignees`, {
    method: "POST",
    headers: jsonHeaders(pmToken),
    body: JSON.stringify({ userId: crewUserId }),
  });
  assert.equal(res.status, 403);
});

test("POST /jobs/:id/assignees — crew is rejected 403", async () => {
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/assignees`, {
    method: "POST",
    headers: jsonHeaders(crewToken),
    body: JSON.stringify({ userId: crewUserId }),
  });
  assert.equal(res.status, 403);
});

test("POST /jobs/:id/assignees — admin can assign (200)", async () => {
  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/assignees`, {
    method: "POST",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({ userId: crewUserId }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { assignees: Array<{ id: string }> };
  assert.ok(
    body.assignees.some((a) => a.id === crewUserId),
    "expected crew user to appear in returned assignee list",
  );
  // Cleanup: remove the assignee row so it doesn't leak across runs.
  const { db } = await import("@workspace/db");
  const { jobAssignees } = await import("@workspace/db/schema");
  const { and: andOp, eq } = await import("drizzle-orm");
  await db
    .delete(jobAssignees)
    .where(
      andOp(eq(jobAssignees.jobId, jobId), eq(jobAssignees.userId, crewUserId)),
    );
});

// -- 8. POST /leads/:id/convert-to-job admin happy-path -------------------

test("POST /leads/:id/convert-to-job — admin succeeds (201)", async () => {
  const { db } = await import("@workspace/db");
  const { leads, jobs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [lead] = await db
    .insert(leads)
    .values({
      title: "ZZZ Audit Lead for admin convert",
      status: "in_negotiation",
      createdBy: adminUserId,
    })
    .returning();
  let createdJobId: string | null = null;
  try {
    const res = await fetch(
      `${baseUrl}/api/leads/${lead.id}/convert-to-job`,
      { method: "POST", headers: jsonHeaders(adminToken), body: "{}" },
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      job: { id: string; title: string; status: string };
    };
    createdJobId = body.job.id;
    assert.equal(body.job.title, "ZZZ Audit Lead for admin convert");
    // Lead must be marked won.
    const refreshed = await db.select().from(leads).where(eq(leads.id, lead.id));
    assert.equal(refreshed[0]?.status, "won");
  } finally {
    if (createdJobId) {
      await db.delete(jobs).where(eq(jobs.id, createdJobId));
    }
    await db.delete(leads).where(eq(leads.id, lead.id));
  }
});

// -- 9. PUT/DELETE /daily-logs/:id ownership gate (Task #288) -------------
//
// `assertCanEditDailyLog` must reject non-owner non-admin non-PM users.
// Admin override must succeed.

test("PUT /daily-logs/:id — crew (non-owner, non-PM) is rejected 403", async () => {
  const res = await fetch(`${baseUrl}/api/daily-logs/${foreignDailyLogId}`, {
    method: "PUT",
    headers: jsonHeaders(crewToken),
    body: JSON.stringify({
      logDate: "2026-05-02",
      title: "crew edit attempt",
      notes: "",
    }),
  });
  assert.equal(res.status, 403);
});

test("DELETE /daily-logs/:id — crew (non-owner, non-PM) is rejected 403", async () => {
  const res = await fetch(`${baseUrl}/api/daily-logs/${foreignDailyLogId}`, {
    method: "DELETE",
    headers: jsonHeaders(crewToken),
  });
  assert.equal(res.status, 403);
  // Sanity: the log is still alive.
  const { db } = await import("@workspace/db");
  const { dailyLogs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(dailyLogs)
    .where(eq(dailyLogs.id, foreignDailyLogId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deletedAt, null);
});

test("PUT /daily-logs/:id — admin override succeeds (200)", async () => {
  const res = await fetch(`${baseUrl}/api/daily-logs/${ownedDailyLogId}`, {
    method: "PUT",
    headers: jsonHeaders(adminToken),
    body: JSON.stringify({
      logDate: "2026-05-01",
      title: "ZZZ Audit Owned Log (admin edit)",
      notes: "edited by admin override",
    }),
  });
  assert.equal(res.status, 200);
  const { db } = await import("@workspace/db");
  const { dailyLogs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(dailyLogs)
    .where(eq(dailyLogs.id, ownedDailyLogId));
  assert.equal(rows[0].title, "ZZZ Audit Owned Log (admin edit)");
});

test("DELETE /daily-logs/:id — admin override succeeds (200, soft-delete)", async () => {
  const res = await fetch(`${baseUrl}/api/daily-logs/${foreignDailyLogId}`, {
    method: "DELETE",
    headers: jsonHeaders(adminToken),
  });
  assert.equal(res.status, 200);
  const { db } = await import("@workspace/db");
  const { dailyLogs } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(dailyLogs)
    .where(eq(dailyLogs.id, foreignDailyLogId));
  assert.notEqual(rows[0].deletedAt, null);
});

// -- 10. Login rate-limit reset-on-success + burst (Task #288) ------------
//
// The login limiter is 5 attempts per 15 min keyed BOTH per IP and per
// email. A successful login MUST clear both buckets so a legitimate
// user who fat-fingered their password a few times is not locked out.
// Order matters here: this test runs first, ends by clearing both
// buckets via a successful login, so the burst test below starts from
// a clean IP bucket.

test(
  "POST /api/auth/login — successful login resets the failure counter",
  async () => {
    const headers = {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    } as const;

    // Four wrong-password attempts — well inside the 5-per-15-min budget.
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: adminEmail, password: "wrongwrong" }),
      });
      assert.equal(
        res.status,
        401,
        `attempt ${i + 1} should be 401 (invalid creds), not throttled`,
      );
    }

    // Correct password — must succeed AND clear both the per-IP and
    // per-email buckets.
    const success = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    assert.equal(success.status, 200);

    // After the reset, a fresh wrong-password attempt for the SAME
    // email + IP must return 401 again (proving bucket cleared) — not
    // 429 (which would mean the previous failures still counted).
    const after = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: adminEmail, password: "wrongwrong" }),
    });
    assert.equal(
      after.status,
      401,
      "post-success failed attempt should be 401, not 429 — buckets must be cleared on success",
    );
  },
);

test("POST /api/auth/login — burst past the limiter yields 429 + Retry-After", async () => {
  const burstEmail = `ratelimit-${crypto.randomUUID()}@audit-fixes-test.local`;
  const headers = {
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
  } as const;
  const body = JSON.stringify({ email: burstEmail, password: "wrongwrong" });

  // First five attempts fail 401 (invalid credentials) but consume the
  // bucket. The sixth must be 429.
  let lastStatus = 0;
  let lastHeaders: Headers | null = null;
  let lastBody: unknown = null;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers,
      body,
    });
    lastStatus = res.status;
    lastHeaders = res.headers;
    lastBody = await res.json().catch(() => null);
  }
  assert.equal(lastStatus, 429, "expected 429 on the 6th attempt");
  const retryAfter = lastHeaders?.get("retry-after");
  assert.ok(retryAfter && Number(retryAfter) >= 1, "Retry-After header must be set");
  // problem+json envelope (RFC 7807 + legacy `message` alias used by
  // the SPA): verify the body carries the rate-limit type slug AND a
  // human-readable message so clients render it consistently.
  const parsed = lastBody as {
    type?: string;
    status?: number;
    message?: string;
  };
  assert.equal(parsed?.status, 429);
  assert.match(parsed?.type ?? "", /rate-limited/);
  assert.match(parsed?.message ?? "", /too many login/i);
});

// -- Task #319: Lead → Job conversion flow ---------------------------------
//
// Verifies the extended POST /leads/:id/convert-to-job flow:
//   * accepts a body with clientId + job overrides + assigneeIds
//   * sets the new job's clientId from the body
//   * inserts job_assignees rows
//   * marks the lead status=won
//   * a follow-up GET /leads/:id surfaces convertedJob with the new job id
//   * a second convert call returns 409 with convertedJob.id

test("POST /leads/:id/convert-to-job — body-driven conversion + convertedJob lookup + 409 on dupe", async () => {
  const { db } = await import("@workspace/db");
  const { leads, jobs, jobAssignees } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");

  const [lead] = await db
    .insert(leads)
    .values({
      title: `ZZZ Audit #319 lead ${crypto.randomUUID()}`,
      status: "qualified",
      streetAddress: "999 Lead St",
      city: "Leadville",
      state: "CA",
      zipCode: "90210",
      createdBy: adminUserId,
    })
    .returning();

  const overrideTitle = `ZZZ Audit #319 job ${crypto.randomUUID()}`;
  let createdJobId = "";
  try {
    // 1) Convert with body: clientId + job overrides + assigneeIds.
    const convertRes = await fetch(
      `${baseUrl}/api/leads/${lead.id}/convert-to-job`,
      {
        method: "POST",
        headers: jsonHeaders(adminToken),
        body: JSON.stringify({
          clientId,
          job: {
            title: overrideTitle,
            contractPrice: "12345.67",
            jobType: "custom",
            assigneeIds: [pmUserId, crewUserId, pmUserId],
          },
        }),
      },
    );
    assert.equal(convertRes.status, 201);
    const convertBody = (await convertRes.json()) as {
      job: { id: string; title: string; status: string };
    };
    createdJobId = convertBody.job.id;
    assert.equal(convertBody.job.title, overrideTitle);
    assert.equal(convertBody.job.status, "open");

    // Job row carries the body's clientId + override jobType.
    const [createdJob] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, createdJobId));
    assert.equal(createdJob.clientId, clientId);
    assert.equal(createdJob.jobType, "custom");

    // job_assignees deduped (pmUserId twice → one row) and crew row
    // present.
    const assigneeRows = await db
      .select()
      .from(jobAssignees)
      .where(eq(jobAssignees.jobId, createdJobId));
    const userIds = assigneeRows.map((r) => r.userId).sort();
    assert.deepEqual(userIds, [crewUserId, pmUserId].sort());

    // Source lead now `won`.
    const [updated] = await db.select().from(leads).where(eq(leads.id, lead.id));
    assert.equal(updated.status, "won");

    // 2) GET /leads/:id surfaces convertedJob.{id,title,status}.
    const detailRes = await fetch(
      `${baseUrl}/api/leads/${lead.id}`,
      { headers: authHeaders(adminToken) },
    );
    assert.equal(detailRes.status, 200);
    const detailBody = (await detailRes.json()) as {
      lead: { convertedJob: { id: string; title: string; status: string } | null };
    };
    assert.ok(detailBody.lead.convertedJob, "expected convertedJob to be populated");
    assert.equal(detailBody.lead.convertedJob!.id, createdJobId);
    assert.equal(detailBody.lead.convertedJob!.title, overrideTitle);

    // 3) Second convert returns 409 + convertedJob.id in the problem body.
    const dupeRes = await fetch(
      `${baseUrl}/api/leads/${lead.id}/convert-to-job`,
      { method: "POST", headers: jsonHeaders(adminToken), body: "{}" },
    );
    assert.equal(dupeRes.status, 409);
    const dupeBody = (await dupeRes.json()) as {
      errors?: { convertedJob?: { id: string } };
    };
    assert.equal(dupeBody.errors?.convertedJob?.id, createdJobId);
  } finally {
    if (createdJobId) {
      await db.delete(jobs).where(eq(jobs.id, createdJobId));
    }
    await db.delete(leads).where(eq(leads.id, lead.id));
  }
});
