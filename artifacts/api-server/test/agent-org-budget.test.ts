import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Match the env-bootstrap dance api-integration.test.ts uses so the shared
// db client + Anthropic singleton both load cleanly. We never make a real
// network call here — every test asserts the cap fires *before* the
// orchestrator would dispatch to Anthropic, or hits a non-streaming
// endpoint.
const testDatabaseUrl =
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
delete process.env.SUPABASE_DATABASE_URL;
process.env.DATABASE_URL ??= testDatabaseUrl;
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:0";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-key-not-used";

const usage = await import("../src/lib/agent/usage.ts");

test("monthlyTokenBudget defaults to 10M when env is unset", () => {
  const original = process.env.AGENT_MONTHLY_TOKEN_BUDGET;
  delete process.env.AGENT_MONTHLY_TOKEN_BUDGET;
  try {
    assert.equal(usage.monthlyTokenBudget(), usage.DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET);
    assert.equal(usage.DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET, 10_000_000);
  } finally {
    if (original !== undefined) process.env.AGENT_MONTHLY_TOKEN_BUDGET = original;
  }
});

test("AGENT_MONTHLY_TOKEN_BUDGET env override is respected; junk falls back to default", () => {
  const original = process.env.AGENT_MONTHLY_TOKEN_BUDGET;
  try {
    process.env.AGENT_MONTHLY_TOKEN_BUDGET = "250000";
    assert.equal(usage.monthlyTokenBudget(), 250_000);

    process.env.AGENT_MONTHLY_TOKEN_BUDGET = "not-a-number";
    assert.equal(usage.monthlyTokenBudget(), usage.DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET);

    process.env.AGENT_MONTHLY_TOKEN_BUDGET = "0";
    assert.equal(usage.monthlyTokenBudget(), usage.DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET);

    process.env.AGENT_MONTHLY_TOKEN_BUDGET = "-5";
    assert.equal(usage.monthlyTokenBudget(), usage.DEFAULT_AGENT_MONTHLY_TOKEN_BUDGET);
  } finally {
    if (original === undefined) delete process.env.AGENT_MONTHLY_TOKEN_BUDGET;
    else process.env.AGENT_MONTHLY_TOKEN_BUDGET = original;
  }
});

// ---- DB-backed integration -----------------------------------------------

let server: Server;
let baseUrl: string;
let adminAccessJwt: string;
let userAccessJwt: string;
let conversationId: string;
let nonAdminConversationId: string;

const adminUserId = crypto.randomUUID();
const userAUserId = crypto.randomUUID();
const userBUserId = crypto.randomUUID();
const seededUserIds = [adminUserId, userAUserId, userBUserId];
const conversationIdsToClean: string[] = [];

const adminEmail = `admin-${adminUserId}@org-budget-test.local`;
const userAEmail = `usera-${userAUserId}@org-budget-test.local`;
const userBEmail = `userb-${userBUserId}@org-budget-test.local`;

before(async () => {
  const { default: app, prepareApp } = await import("../src/app.ts");
  const auth = await import("../src/lib/auth.ts");
  const { db } = await import("@workspace/db");
  const { users, agentConversations, agentUsageMonthly } = await import(
    "@workspace/db/schema"
  );
  const { inArray } = await import("drizzle-orm");

  await prepareApp();

  // Pre-clean any leftover usage rows for the seeded users so each suite
  // run starts from zero (the unique key is (user_id, year_month)).
  await db
    .delete(agentUsageMonthly)
    .where(inArray(agentUsageMonthly.userId, seededUserIds));

  await db.insert(users).values([
    {
      id: adminUserId,
      email: adminEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Org Budget Admin",
      role: "admin",
    },
    {
      id: userAUserId,
      email: userAEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Org Budget User A",
      role: "crew_member",
    },
    {
      id: userBUserId,
      email: userBEmail,
      passwordHash: "test-not-a-real-hash",
      fullName: "ZZZ Org Budget User B",
      role: "crew_member",
    },
  ]);

  adminAccessJwt = auth.signAccessToken({
    id: adminUserId,
    email: adminEmail,
    fullName: "ZZZ Org Budget Admin",
    role: "admin",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  userAccessJwt = auth.signAccessToken({
    id: userAUserId,
    email: userAEmail,
    fullName: "ZZZ Org Budget User A",
    role: "crew_member",
    avatarUrl: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Two pre-seeded conversations so the admin-only send-handler tests can
  // hit real owned rows. Both have nothing fancy — the cap check fires
  // before any history-load logic does anything interesting.
  const [c1] = await db
    .insert(agentConversations)
    .values({ userId: adminUserId, title: "Org budget test convo" })
    .returning();
  conversationId = c1!.id;
  conversationIdsToClean.push(conversationId);

  const [c2] = await db
    .insert(agentConversations)
    .values({ userId: adminUserId, title: "Per-user cap test convo" })
    .returning();
  nonAdminConversationId = c2!.id;
  conversationIdsToClean.push(nonAdminConversationId);

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
    users,
    agentConversations,
    agentMessages,
    agentUsageMonthly,
  } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");

  try {
    if (conversationIdsToClean.length > 0) {
      await db
        .delete(agentMessages)
        .where(inArray(agentMessages.conversationId, conversationIdsToClean));
      await db
        .delete(agentConversations)
        .where(inArray(agentConversations.id, conversationIdsToClean));
    }
    await db
      .delete(agentUsageMonthly)
      .where(inArray(agentUsageMonthly.userId, seededUserIds));
    await db.delete(users).where(inArray(users.id, seededUserIds));
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await pool.end();
  }
});

// ---- helpers -------------------------------------------------------------

async function clearUsage() {
  const { db } = await import("@workspace/db");
  const { agentUsageMonthly } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db
    .delete(agentUsageMonthly)
    .where(inArray(agentUsageMonthly.userId, seededUserIds));
}

async function setUsageRow(
  userId: string,
  yearMonth: string,
  inputTokens: number,
  outputTokens: number,
  requests = 1,
) {
  const { db } = await import("@workspace/db");
  const { agentUsageMonthly } = await import("@workspace/db/schema");
  await db
    .insert(agentUsageMonthly)
    .values({ userId, yearMonth, inputTokens, outputTokens, requests });
}

// ---- DB tests ------------------------------------------------------------

test("loadOrgUsageSnapshot sums across all users for the current month and ignores past months", async () => {
  await clearUsage();
  const ym = usage.currentYearMonth();

  // Three rows for this month across two users (one user has two rows? —
  // unique constraint forbids that, so use distinct users).
  await setUsageRow(userAUserId, ym, 100_000, 50_000, 3);
  await setUsageRow(userBUserId, ym, 200_000, 80_000, 7);
  // A "previous month" row that must be excluded from the current snapshot.
  // Year-month is intentionally well in the past so it never collides with
  // the running clock.
  await setUsageRow(adminUserId, "2020-01", 9_999_999, 9_999_999, 99);

  const snapshot = await usage.loadOrgUsageSnapshot();
  assert.equal(snapshot.yearMonth, ym);
  assert.equal(snapshot.inputTokens, 300_000);
  assert.equal(snapshot.outputTokens, 130_000);
  assert.equal(snapshot.totalTokens, 430_000);
  assert.equal(snapshot.requests, 10);
  // userCount counts only users with rows in the current month.
  assert.equal(snapshot.userCount, 2);
  assert.equal(snapshot.exceeded, false);
  assert.equal(snapshot.budget, usage.monthlyTokenBudget());
  assert.equal(snapshot.remaining, snapshot.budget - 430_000);
});

test("loadOrgUsageSnapshot.exceeded flips once total >= budget", async () => {
  await clearUsage();
  const ym = usage.currentYearMonth();
  const original = process.env.AGENT_MONTHLY_TOKEN_BUDGET;
  try {
    process.env.AGENT_MONTHLY_TOKEN_BUDGET = "1000";
    await setUsageRow(userAUserId, ym, 600, 350, 1); // total 950, under
    let snap = await usage.loadOrgUsageSnapshot();
    assert.equal(snap.exceeded, false);
    assert.equal(snap.remaining, 50);

    await setUsageRow(userBUserId, ym, 100, 100, 1); // org total 1150 > 1000
    snap = await usage.loadOrgUsageSnapshot();
    assert.equal(snap.exceeded, true);
    assert.equal(snap.remaining, 0);
  } finally {
    if (original === undefined) delete process.env.AGENT_MONTHLY_TOKEN_BUDGET;
    else process.env.AGENT_MONTHLY_TOKEN_BUDGET = original;
    await clearUsage();
  }
});

test("rolling over to a new month resets the org snapshot to zero", async () => {
  await clearUsage();
  // Simulate "last month spent everything" — these rows live under a past
  // year_month and must be invisible to the current-month aggregate.
  await setUsageRow(userAUserId, "2020-02", 5_000_000, 5_000_000, 50);
  await setUsageRow(userBUserId, "2020-02", 5_000_000, 5_000_000, 50);
  const snap = await usage.loadOrgUsageSnapshot();
  assert.equal(snap.totalTokens, 0);
  assert.equal(snap.requests, 0);
  assert.equal(snap.userCount, 0);
  assert.equal(snap.exceeded, false);
  await clearUsage();
});

// ---- HTTP route tests ----------------------------------------------------

test("GET /api/agent/usage/org requires admin role", async () => {
  const denied = await fetch(`${baseUrl}/api/agent/usage/org`, {
    headers: { authorization: `Bearer ${userAccessJwt}` },
  });
  assert.equal(denied.status, 403);
});

test("GET /api/agent/usage/org returns the org-wide month-to-date snapshot for admins", async () => {
  await clearUsage();
  const ym = usage.currentYearMonth();
  await setUsageRow(userAUserId, ym, 1_234, 567, 2);

  const ok = await fetch(`${baseUrl}/api/agent/usage/org`, {
    headers: { authorization: `Bearer ${adminAccessJwt}` },
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as Record<string, unknown>;
  assert.equal(body.yearMonth, ym);
  assert.equal(body.inputTokens, 1_234);
  assert.equal(body.outputTokens, 567);
  assert.equal(body.totalTokens, 1_801);
  assert.equal(body.requests, 2);
  assert.equal(body.userCount, 1);
  assert.equal(body.exceeded, false);
  assert.equal(typeof body.budget, "number");
  assert.equal(typeof body.remaining, "number");
  await clearUsage();
});

test("POST /agent/conversations/:id/messages returns 429 (org-usage-limit) when org budget is exhausted", async () => {
  await clearUsage();
  const ym = usage.currentYearMonth();
  const originalBudget = process.env.AGENT_MONTHLY_TOKEN_BUDGET;
  const originalCap = process.env.AGENT_MONTHLY_TOKEN_CAP;
  try {
    // Squeeze the budget so two small rows on OTHER users push the org
    // counter past it before this user's own per-user cap is anywhere
    // close. That isolates the org-cap firing path from the per-user one.
    process.env.AGENT_MONTHLY_TOKEN_BUDGET = "500";
    process.env.AGENT_MONTHLY_TOKEN_CAP = "999999"; // calling admin is far under
    await setUsageRow(adminUserId, ym, 400, 200, 1); // org=600 > 500

    const res = await fetch(
      `${baseUrl}/api/agent/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "XMLHttpRequest",
          authorization: `Bearer ${adminAccessJwt}`,
        },
        body: JSON.stringify({ content: "hello" }),
      },
    );
    assert.equal(res.status, 429);
    const contentType = res.headers.get("content-type") ?? "";
    assert.match(contentType, /application\/problem\+json/);
    const body = (await res.json()) as Record<string, unknown>;
    // Distinct error type so the UI/runbook can tell org vs per-user apart.
    assert.match(String(body.type ?? ""), /\/org-usage-limit$/);
    assert.match(String(body.detail ?? ""), /Agent monthly budget exhausted/);
  } finally {
    if (originalBudget === undefined) delete process.env.AGENT_MONTHLY_TOKEN_BUDGET;
    else process.env.AGENT_MONTHLY_TOKEN_BUDGET = originalBudget;
    if (originalCap === undefined) delete process.env.AGENT_MONTHLY_TOKEN_CAP;
    else process.env.AGENT_MONTHLY_TOKEN_CAP = originalCap;
    await clearUsage();
  }
});

test("POST /agent/conversations/:id/messages still returns 429 (usage-limit) for the per-user cap when org budget is healthy", async () => {
  await clearUsage();
  const ym = usage.currentYearMonth();
  const originalBudget = process.env.AGENT_MONTHLY_TOKEN_BUDGET;
  const originalCap = process.env.AGENT_MONTHLY_TOKEN_CAP;
  try {
    // Generous org budget, tiny per-user cap that the calling user has
    // already blown. Proves per-user enforcement is independent of and
    // unchanged by the new org cap.
    process.env.AGENT_MONTHLY_TOKEN_BUDGET = "999999999";
    process.env.AGENT_MONTHLY_TOKEN_CAP = "100";
    await setUsageRow(adminUserId, ym, 80, 30, 1); // user total 110 > 100

    const res = await fetch(
      `${baseUrl}/api/agent/conversations/${nonAdminConversationId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "XMLHttpRequest",
          authorization: `Bearer ${adminAccessJwt}`,
        },
        body: JSON.stringify({ content: "hello again" }),
      },
    );
    assert.equal(res.status, 429);
    const body = (await res.json()) as Record<string, unknown>;
    // Per-user error type, NOT the org one.
    assert.match(String(body.type ?? ""), /\/usage-limit$/);
    assert.doesNotMatch(String(body.type ?? ""), /\/org-usage-limit$/);
  } finally {
    if (originalBudget === undefined) delete process.env.AGENT_MONTHLY_TOKEN_BUDGET;
    else process.env.AGENT_MONTHLY_TOKEN_BUDGET = originalBudget;
    if (originalCap === undefined) delete process.env.AGENT_MONTHLY_TOKEN_CAP;
    else process.env.AGENT_MONTHLY_TOKEN_CAP = originalCap;
    await clearUsage();
  }
});
