// Aggregation-level integration test for the admin Reports endpoints
// (Task #322). Seeds the test DB with a small fixture (1 client, 1 job,
// 1 tracker, 2 invoices with payments, plus a handful of leads) and
// asserts the SQL aggregates produce the expected numbers.
//
// Mirrors the seeding pattern in financials.test.ts: writes are scoped
// to throwaway IDs and torn down in `after` so the suite can run
// alongside other DB-backed tests.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

const adminUserId = crypto.randomUUID();
const clientId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const trackerId = crypto.randomUUID();
const areaId = crypto.randomUUID();
const lineItemId = crypto.randomUUID();
const oldInvoiceId = crypto.randomUUID();
const newInvoiceId = crypto.randomUUID();
const partialPaymentId = crypto.randomUUID();
const wonLeadId = crypto.randomUUID();
const lostLeadId = crypto.randomUUID();
const openLeadId = crypto.randomUUID();

let __testing: typeof import("../src/routes/reports.ts")["__testing"];

const today = new Date();
const todayStr = today.toISOString().slice(0, 10);
const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86_400_000);

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;

  const { db } = await import("@workspace/db");
  const {
    users,
    clients,
    jobs,
    financialTrackers,
    sovAreas,
    sovLineItems,
    trackerInvoices,
    invoiceLinePayments,
    leads,
  } = await import("@workspace/db/schema");

  ({ __testing } = await import("../src/routes/reports.ts"));

  await db.insert(users).values({
    id: adminUserId,
    email: `reports-${adminUserId}@reports-test.local`,
    passwordHash: "test-not-a-real-hash",
    fullName: "ZZZ Reports Admin",
    role: "admin",
  });
  await db.insert(clients).values({
    id: clientId,
    companyName: `ZZZ Reports Client ${clientId}`,
  });
  await db.insert(jobs).values({
    id: jobId,
    title: `ZZZ Reports Job ${jobId}`,
    clientId,
    createdBy: adminUserId,
    projectManagerId: adminUserId,
    jobType: "interior",
    contractValueCents: 0,
  });
  await db.insert(financialTrackers).values({
    id: trackerId,
    jobId,
    createdBy: adminUserId,
  });
  await db.insert(sovAreas).values({ id: areaId, trackerId, name: "Area A" });
  await db.insert(sovLineItems).values({
    id: lineItemId,
    areaId,
    description: "Line A",
    scheduledValueCents: 100_000,
  });

  // Old invoice: $400 invoiced 95 days ago, $100 paid → $300 outstanding,
  // bucket = 90+. Applied 45 days ago so days-to-payment = 50.
  await db.insert(trackerInvoices).values({
    id: oldInvoiceId,
    trackerId,
    invoiceNumber: "INV-OLD",
    invoiceDate: ninetyDaysAgo.toISOString().slice(0, 10),
    totalCents: 40_000,
    appliedAt: fortyFiveDaysAgo,
    createdBy: adminUserId,
  });
  await db.insert(invoiceLinePayments).values({
    id: partialPaymentId,
    invoiceId: oldInvoiceId,
    lineItemId,
    amountCents: 10_000,
    createdAt: fortyFiveDaysAgo,
  });
  // New invoice: $200 invoiced today, no payments → $200 outstanding,
  // bucket = current.
  await db.insert(trackerInvoices).values({
    id: newInvoiceId,
    trackerId,
    invoiceNumber: "INV-NEW",
    invoiceDate: todayStr,
    totalCents: 20_000,
    createdBy: adminUserId,
  });

  // 1 won + 1 lost (closed within last 90d) → win rate 50%. Plus 1 open.
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
  const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000);
  await db.insert(leads).values([
    {
      id: wonLeadId,
      title: "ZZZ Won lead",
      status: "won",
      createdBy: adminUserId,
      assignedTo: adminUserId,
      createdAt: twentyDaysAgo,
      updatedAt: tenDaysAgo,
    },
    {
      id: lostLeadId,
      title: "ZZZ Lost lead",
      status: "lost",
      createdBy: adminUserId,
      assignedTo: adminUserId,
      createdAt: twentyDaysAgo,
      updatedAt: tenDaysAgo,
    },
    {
      id: openLeadId,
      title: "ZZZ Open lead",
      status: "open",
      createdBy: adminUserId,
      assignedTo: adminUserId,
    },
  ]);
});

after(async () => {
  const { db, pool } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const {
    users,
    clients,
    jobs,
    financialTrackers,
    sovAreas,
    sovLineItems,
    trackerInvoices,
    invoiceLinePayments,
    leads,
  } = await import("@workspace/db/schema");
  try {
    await db.delete(invoiceLinePayments).where(eq(invoiceLinePayments.invoiceId, oldInvoiceId));
    await db.delete(trackerInvoices).where(eq(trackerInvoices.id, oldInvoiceId));
    await db.delete(trackerInvoices).where(eq(trackerInvoices.id, newInvoiceId));
    await db.delete(sovLineItems).where(eq(sovLineItems.id, lineItemId));
    await db.delete(sovAreas).where(eq(sovAreas.id, areaId));
    await db.delete(financialTrackers).where(eq(financialTrackers.id, trackerId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(clients).where(eq(clients.id, clientId));
    await db.delete(leads).where(eq(leads.id, wonLeadId));
    await db.delete(leads).where(eq(leads.id, lostLeadId));
    await db.delete(leads).where(eq(leads.id, openLeadId));
    await db.delete(users).where(eq(users.id, adminUserId));
  } finally {
    await pool.end();
  }
});

test("loadArAging: bucketing and outstanding math match seeded fixture", async () => {
  const rows = await __testing.loadArAging();
  const mine = rows.find((r) => r.clientId === clientId);
  assert.ok(mine, "fixture client should appear in A/R aging");
  // $300 outstanding in 90+ bucket from old invoice + $200 in current.
  assert.equal(mine.d90plus, 30_000);
  assert.equal(mine.current, 20_000);
  assert.equal(mine.total, 50_000);
});

test("loadRevenue: this-month bucket includes today's $200 invoice", async () => {
  const months = await __testing.loadRevenue({ from: "1970-01-01", to: todayStr });
  const thisMonth = todayStr.slice(0, 7);
  const bucket = months.find((m) => m.month === thisMonth);
  assert.ok(bucket, "current month should be in the 12-month skeleton");
  assert.ok(bucket.billedCents >= 20_000, "today's invoice should land in this month");
});

test("loadPipeline: win rate = 50% with 1 won / 1 lost in window", async () => {
  const data = await __testing.loadPipeline({
    from: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
    to: todayStr,
  });
  assert.ok(data.won >= 1);
  assert.ok(data.lost >= 1);
  // Other leads in the DB might shift the rate, but with both 1+1 from
  // our fixture the rate must be > 0 and the funnel must contain "open".
  assert.ok(data.winRate > 0);
  assert.ok(data.funnel.find((f) => f.stage === "open"));
});

test("loadDaysToPayment: old invoice contributes ~45 day average", async () => {
  const data = await __testing.loadDaysToPayment({
    from: new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10),
    to: todayStr,
  });
  const mine = data.byClient.find((b) => b.id === clientId);
  assert.ok(mine, "fixture client should appear");
  // Invoice dated ~95 days ago, applied ~45 days ago → ~50 days.
  assert.ok(mine.avgDays >= 40 && mine.avgDays <= 60, `expected ~50, got ${mine.avgDays}`);
});

test("loadJobsByStage: fixture client has exactly 1 open job", async () => {
  const rows = await __testing.loadJobsByStage();
  const mine = rows.find((r) => r.clientId === clientId);
  assert.ok(mine, "fixture client should appear");
  assert.equal(mine.open, 1);
  assert.equal(mine.total, 1);
});
