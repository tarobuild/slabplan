import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type Stripe from "stripe";

const WEBHOOK_SECRET = "whsec_local_conflict_alert_fixture";
const ALERT_RECIPIENT = "billing-ops@example.test";
const PAYER_EMAIL = "duplicate-payer@example.invalid";
const PAYER_NAME = "Private Duplicate Payer";
const ORG_NAME_MARKER = "Conflict Alert Workspace";

type SentAlert = { to: string; subject: string; text: string; html: string; tag: string };

const organizationIds: string[] = [];
const eventIds: string[] = [];
const subscriptions = new Map<string, Stripe.Subscription>();
const sessions = new Map<string, Stripe.Checkout.Session>();
const sent: SentAlert[] = [];
const logs: string[] = [];
// Every call to the mail provider, whatever its outcome.
let sendCalls = 0;
let senderMode: "ok" | "fail" | "hang" = "ok";
let releaseHang: (() => void) | null = null;
let server: Server;
let baseUrl: string;
let stripe: Stripe;
let alerts: typeof import("../src/lib/billing-conflict-alerts.ts");
let createStripeClientReferenceId: (organizationId: string) => string;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.STRIPE_SECRET_KEY = "sk_test_local_conflict_alert_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = "price_test_pro";

  const stripeLib = await import("../src/lib/stripe.ts");
  createStripeClientReferenceId = stripeLib.createStripeClientReferenceId;
  stripe = stripeLib.getStripeClient();
  mock.method(stripe.subscriptions, "retrieve", async (id: string) => {
    const subscription = subscriptions.get(id);
    assert.ok(subscription, `Unknown fixture subscription ${id}`);
    return subscription;
  });
  mock.method(stripe.checkout.sessions, "retrieve", async (id: string) => {
    const session = sessions.get(id);
    assert.ok(session, `Unknown fixture session ${id}`);
    return session;
  });

  const { __setEmailSenderForTests } = await import("../src/lib/email.ts");
  __setEmailSenderForTests({
    async send(message) {
      sendCalls += 1;
      if (senderMode === "fail")
        throw new Error(`SMTP 550 rejected for ${PAYER_EMAIL} via ${ALERT_RECIPIENT}`);
      if (senderMode === "hang")
        await new Promise<void>((resolve) => {
          releaseHang = resolve;
        });
      sent.push(message);
      return { id: "test-stub" };
    },
  });

  const { logger } = await import("../src/lib/logger.ts");
  const loggerMethods = logger as unknown as Record<string, (...args: unknown[]) => void>;
  for (const level of ["info", "warn", "error"]) {
    mock.method(loggerMethods, level, (...args: unknown[]) => {
      logs.push(JSON.stringify(args));
    });
  }

  alerts = await import("../src/lib/billing-conflict-alerts.ts");
  const { default: router } = await import("../src/routes/stripe-webhook.ts");
  const app = express();
  app.use("/webhook", express.raw({ type: "application/json" }), router);
  app.use(
    (
      error: { statusCode?: number },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res.status(error.statusCode ?? 500).json({ error: "Webhook rejected" });
    },
  );
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
});

beforeEach(() => {
  process.env.SECURITY_ALERT_EMAIL = ALERT_RECIPIENT;
  senderMode = "ok";
  releaseHang = null;
  sent.length = 0;
  logs.length = 0;
  sendCalls = 0;
  // Only the budget test below exercises the hourly limit; a generous limit
  // keeps the other tests independent of attempts spent earlier in the hour.
  alerts.__setBillingConflictAlertLimitsForTests({ maxEmailsPerHour: 1_000 });
});

after(async () => {
  alerts?.__setBillingConflictAlertLimitsForTests(null);
  mock.restoreAll();
  const { __setEmailSenderForTests } = await import("../src/lib/email.ts");
  __setEmailSenderForTests(null);
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  const { db, pool } = await import("@workspace/db");
  const { billingEvents, organizations } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");
  try {
    if (eventIds.length)
      await db
        .delete(billingEvents)
        .where(
          inArray(billingEvents.id, [
            ...eventIds,
            ...eventIds.flatMap(alerts.billingConflictAlertRowIds),
          ]),
        );
    if (organizationIds.length)
      await db
        .delete(organizations)
        .where(inArray(organizations.id, organizationIds));
  } finally {
    await pool.end();
  }
});

function token() {
  return randomUUID().replaceAll("-", "").slice(0, 20);
}

async function workspace(binding?: { customer: string; subscription: string }) {
  const { db } = await import("@workspace/db");
  const { organizations } = await import("@workspace/db/schema");
  const id = randomUUID();
  organizationIds.push(id);
  await db.insert(organizations).values({
    id,
    name: `TEST ${ORG_NAME_MARKER} ${id}`,
    slug: `test-conflict-${id}`,
    requiresSubscription: true,
    ...(binding
      ? {
          stripeCustomerId: binding.customer,
          stripeSubscriptionId: binding.subscription,
          subscriptionStatus: "active",
          planKey: "pro",
        }
      : {}),
  });
  return id;
}

function subscription(
  id: string,
  customer: string,
  options: { organizationId?: string; created?: number } = {},
) {
  const value = {
    id,
    customer,
    livemode: false,
    status: "active",
    created: options.created ?? 100,
    metadata: options.organizationId
      ? { organizationId: options.organizationId }
      : {},
    items: { data: [{ price: { id: "price_test_pro" }, quantity: 1 }] },
  } as unknown as Stripe.Subscription;
  subscriptions.set(id, value);
  return value;
}

function checkoutSession(
  organizationId: string,
  customer: string,
  subscriptionId: string,
) {
  const session = {
    id: `cs_test_${token()}`,
    customer,
    subscription: subscriptionId,
    livemode: false,
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    metadata: {},
    client_reference_id: createStripeClientReferenceId(organizationId),
    customer_details: { email: PAYER_EMAIL, name: PAYER_NAME },
  } as unknown as Stripe.Checkout.Session;
  sessions.set(session.id, session);
  return session;
}

function event(type: string, object: unknown, livemode = false) {
  const id = `evt_test_${token()}`;
  eventIds.push(id);
  return { id, type, livemode, created: 100, data: { object } };
}

async function deliver(payload: ReturnType<typeof event>, signature?: string | null) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null)
    headers["stripe-signature"] =
      signature ??
      stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
  return (await fetch(baseUrl, { method: "POST", headers, body })).status;
}

/** A second paid checkout for a workspace that already has an active subscription. */
async function duplicateCheckout() {
  const tag = token();
  const original = subscription(`sub_orig_${tag}`, `cus_orig_${tag}`);
  const organizationId = await workspace({
    customer: `cus_orig_${tag}`,
    subscription: original.id,
  });
  const duplicate = subscription(`sub_dup_${tag}`, `cus_dup_${tag}`, { created: 200 });
  const session = checkoutSession(organizationId, `cus_dup_${tag}`, duplicate.id);
  return {
    organizationId,
    session,
    sensitive: [
      PAYER_EMAIL,
      PAYER_NAME,
      ORG_NAME_MARKER,
      organizationId,
      original.id,
      `cus_orig_${tag}`,
      duplicate.id,
      `cus_dup_${tag}`,
      session.id,
      WEBHOOK_SECRET,
    ],
  };
}

async function billingRow(id: string) {
  const { db } = await import("@workspace/db");
  const { organizations } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select({
      stripeCustomerId: organizations.stripeCustomerId,
      stripeSubscriptionId: organizations.stripeSubscriptionId,
      subscriptionStatus: organizations.subscriptionStatus,
      planKey: organizations.planKey,
      billingEmail: organizations.billingEmail,
      status: organizations.status,
      updatedAt: organizations.updatedAt,
    })
    .from(organizations)
    .where(eq(organizations.id, id));
  return row;
}

async function storedEvent(id: string) {
  const { db } = await import("@workspace/db");
  const { billingEvents } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, id));
  return row;
}

async function marker(eventId: string) {
  const row = await storedEvent(alerts.billingConflictAlertMarkerId(eventId));
  return row
    ? { ...row, payload: row.payload as Record<string, unknown> }
    : undefined;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("condition was not reached in time");
}

function assertSanitized(text: string, sensitive: string[]) {
  for (const value of sensitive)
    assert.equal(text.includes(value), false, `output must not contain ${value}`);
}

test("a signed duplicate checkout is still refused, alerts the operator once, and changes no workspace", async () => {
  const { organizationId, session, sensitive } = await duplicateCheckout();
  const before = await billingRow(organizationId);
  const payload = event("checkout.session.completed", session);

  assert.equal(await deliver(payload), 409);
  assert.deepEqual(await billingRow(organizationId), before);
  assert.equal(await storedEvent(payload.id), undefined, "the refused event stays unprocessed so Stripe retries it");

  assert.equal(sent.length, 1);
  const [email] = sent;
  assert.equal(email.to, ALERT_RECIPIENT);
  assert.equal(email.tag, "security-alert");
  const rendered = `${email.subject}\n${email.text}\n${email.html}`;
  assert.match(rendered, new RegExp(payload.id));
  assert.match(rendered, /workspace_has_other_subscription/);
  assert.match(rendered, /https:\/\/dashboard\.stripe\.com\/test\/events\//);
  assert.match(email.subject, /TEST mode/);
  assertSanitized(rendered, sensitive);
  assertSanitized(logs.join("\n"), [...sensitive, ALERT_RECIPIENT]);

  const recorded = await marker(payload.id);
  assert.ok(recorded);
  assert.equal(recorded.provider, "slabplan-alert");
  assert.deepEqual(recorded.payload, {
    eventId: payload.id,
    eventType: "checkout.session.completed",
    reason: "workspace_has_other_subscription",
    livemode: false,
    organizationIds: [organizationId],
    delivery: "sent",
    sendAttempts: 1,
  });
  const [, firstAttemptId] = alerts.billingConflictAlertRowIds(payload.id);
  const attempt = await storedEvent(firstAttemptId!);
  assert.equal(attempt?.type, "billing.binding_conflict.send_attempt");
  assert.deepEqual(attempt?.payload, { eventId: payload.id, sendAttempt: 1 });

  // Stripe retries the same event: each retry is refused the same way and a
  // confirmed alert is not sent again.
  assert.equal(await deliver(payload), 409);
  assert.equal(await deliver(payload), 409);
  assert.equal(sent.length, 1);
  assert.equal(sendCalls, 1);
  assert.equal((await marker(payload.id))?.payload.sendAttempts, 1);
  assert.deepEqual(await billingRow(organizationId), before);
});

test("a normal paid checkout binds its workspace without any alert", async () => {
  const tag = token();
  const organizationId = await workspace();
  const paid = subscription(`sub_ok_${tag}`, `cus_ok_${tag}`, { organizationId });
  const payload = event(
    "checkout.session.completed",
    checkoutSession(organizationId, `cus_ok_${tag}`, paid.id),
  );
  assert.equal(await deliver(payload), 200);
  assert.equal((await billingRow(organizationId)).stripeSubscriptionId, paid.id);
  assert.equal(sent.length, 0);
  assert.equal(await marker(payload.id), undefined);
});

test("unsigned, wrongly signed or wrong-mode deliveries of a conflicting event never alert", async () => {
  const { organizationId, session } = await duplicateCheckout();
  const before = await billingRow(organizationId);
  const unsigned = event("checkout.session.completed", session);
  const forged = event("checkout.session.completed", session);
  const wrongSecret = event("checkout.session.completed", session);
  const wrongMode = event("checkout.session.completed", session, true);

  assert.equal(await deliver(unsigned, null), 400);
  assert.equal(await deliver(forged, "t=1,v1=forged"), 400);
  assert.equal(
    await deliver(
      wrongSecret,
      stripe.webhooks.generateTestHeaderString({
        payload: JSON.stringify(wrongSecret),
        secret: "whsec_attacker_controlled",
      }),
    ),
    400,
  );
  assert.equal(await deliver(wrongMode), 400);

  assert.equal(sent.length, 0);
  for (const payload of [unsigned, forged, wrongSecret, wrongMode])
    assert.equal(await marker(payload.id), undefined);
  assert.deepEqual(await billingRow(organizationId), before);
});

test("cross-workspace conflicts change neither workspace and name no workspace outside the private marker", async () => {
  // A checkout for one workspace that reuses another workspace's customer.
  const tag = token();
  const bound = subscription(`sub_bound_${tag}`, `cus_bound_${tag}`);
  const owner = await workspace({ customer: `cus_bound_${tag}`, subscription: bound.id });
  const claimant = await workspace();
  // A subscription-change event whose customer belongs to a third workspace.
  const other = subscription(`sub_other_${tag}`, `cus_other_${tag}`);
  const otherOwner = await workspace({ customer: `cus_other_${tag}`, subscription: other.id });
  const moved = subscription(`sub_moved_${tag}`, `cus_other_${tag}`);
  const movedOwner = await workspace({ customer: `cus_moved_${tag}`, subscription: moved.id });
  // A checkout whose subscription belongs to a different customer.
  const mismatched = subscription(`sub_mismatch_${tag}`, `cus_elsewhere_${tag}`);

  const cases = [
    {
      payload: event("checkout.session.completed", checkoutSession(claimant, `cus_bound_${tag}`, bound.id)),
      reason: "identifiers_bound_to_other_workspace",
      organizations: [claimant, owner],
    },
    {
      payload: event("customer.subscription.updated", { ...moved }),
      reason: "identifiers_resolve_to_different_workspaces",
      organizations: [movedOwner, otherOwner],
    },
    {
      payload: event("checkout.session.completed", checkoutSession(claimant, `cus_mismatch_${tag}`, mismatched.id)),
      reason: "checkout_ownership_mismatch",
      organizations: [claimant],
    },
  ];
  const everyWorkspace = [owner, claimant, otherOwner, movedOwner];
  const before = await Promise.all(everyWorkspace.map(billingRow));

  for (const { payload, reason, organizations } of cases) {
    assert.equal(await deliver(payload), 409, reason);
    const recorded = await marker(payload.id);
    assert.equal(recorded?.payload.reason, reason);
    assert.equal(recorded?.payload.delivery, "sent");
    assert.deepEqual(recorded?.payload.organizationIds, organizations);
  }
  assert.deepEqual(await Promise.all(everyWorkspace.map(billingRow)), before);

  assert.equal(sent.length, cases.length);
  const rendered = sent.map((email) => `${email.subject}\n${email.text}\n${email.html}`).join("\n");
  const identifiers = [
    ...everyWorkspace,
    ORG_NAME_MARKER,
    PAYER_EMAIL,
    `cus_bound_${tag}`,
    bound.id,
    `cus_other_${tag}`,
    other.id,
    moved.id,
    `cus_moved_${tag}`,
    mismatched.id,
  ];
  assertSanitized(rendered, identifiers);
  assertSanitized(logs.join("\n"), [...identifiers, ALERT_RECIPIENT]);
});

test("alert failures never change the refusal, are retried on later deliveries and are bounded", async () => {
  const failing = await duplicateCheckout();
  const payload = event("checkout.session.completed", failing.session);

  senderMode = "fail";
  assert.equal(await deliver(payload), 409);
  let recorded = await marker(payload.id);
  assert.equal(recorded?.payload.delivery, "failed");
  assert.equal(recorded?.payload.failure, "send_failed");
  assert.equal(recorded?.payload.sendAttempts, 1);
  // Provider error text (which here quotes addresses) is never recorded. The
  // private marker holds the workspace id; logs hold no workspace at all.
  assertSanitized(logs.join("\n"), [...failing.sensitive, ALERT_RECIPIENT, "SMTP 550"]);
  assertSanitized(JSON.stringify(recorded?.payload), [
    PAYER_EMAIL,
    PAYER_NAME,
    ALERT_RECIPIENT,
    "SMTP 550",
  ]);

  // The next Stripe retry delivers the alert; later retries do not repeat it.
  senderMode = "ok";
  assert.equal(await deliver(payload), 409);
  assert.equal(sent.length, 1);
  recorded = await marker(payload.id);
  assert.equal(recorded?.payload.delivery, "sent");
  assert.equal(recorded?.payload.sendAttempts, 2);
  assert.equal("failure" in (recorded?.payload ?? {}), false);
  assert.equal(await deliver(payload), 409);
  assert.equal(sent.length, 1);

  // A persistently failing mailbox is tried at most three times per event.
  const exhausted = await duplicateCheckout();
  const exhaustedEvent = event("checkout.session.completed", exhausted.session);
  senderMode = "fail";
  for (let attempt = 1; attempt <= 4; attempt += 1)
    assert.equal(await deliver(exhaustedEvent), 409);
  assert.equal((await marker(exhaustedEvent.id))?.payload.sendAttempts, 3);
  senderMode = "ok";
  assert.equal(await deliver(exhaustedEvent), 409);
  assert.equal(sent.length, 1, "no fourth attempt after three failures");
  // 1 failed + 1 sent for the first event, 3 failed for the second.
  assert.equal(sendCalls, 5);

  // Without a configured recipient the conflict is still recorded and
  // refused; no send is attempted, so no attempt is spent.
  delete process.env.SECURITY_ALERT_EMAIL;
  const unconfigured = await duplicateCheckout();
  const unconfiguredEvent = event("checkout.session.completed", unconfigured.session);
  assert.equal(await deliver(unconfiguredEvent), 409);
  recorded = await marker(unconfiguredEvent.id);
  assert.equal(recorded?.payload.delivery, "failed");
  assert.equal(recorded?.payload.failure, "unconfigured");
  assert.equal(recorded?.payload.sendAttempts, 0);
  assert.equal(sendCalls, 5);

  // Once configured, a later Stripe retry alerts normally.
  process.env.SECURITY_ALERT_EMAIL = ALERT_RECIPIENT;
  assert.equal(await deliver(unconfiguredEvent), 409);
  recorded = await marker(unconfiguredEvent.id);
  assert.equal(recorded?.payload.delivery, "sent");
  assert.equal("failure" in (recorded?.payload ?? {}), false);
  assert.equal(sent.length, 2);
});

test("a slow mailbox does not hold the webhook, and an abandoned claim is retried after its lease", async () => {
  alerts.__setBillingConflictAlertLimitsForTests({ deliveryWaitMs: 50, maxEmailsPerHour: 1_000 });
  const slow = await duplicateCheckout();
  const payload = event("checkout.session.completed", slow.session);

  senderMode = "hang";
  const started = Date.now();
  assert.equal(await deliver(payload), 409);
  assert.ok(Date.now() - started < 2_000, "the response does not wait for the email");
  assert.ok(logs.some((line) => line.includes('"delivery":"pending"')));
  await waitFor(async () => releaseHang !== null);
  assert.equal((await marker(payload.id))?.payload.delivery, "claimed");
  // Later deliveries wait for their (fast) alert so the steps stay ordered.
  alerts.__setBillingConflictAlertLimitsForTests({ deliveryWaitMs: 5_000, maxEmailsPerHour: 1_000 });

  // Simulate an instance that stopped mid-send: once the claim's lease has
  // passed, the next Stripe retry claims and sends again.
  const { db } = await import("@workspace/db");
  const { billingEvents } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  await db
    .update(billingEvents)
    .set({ updatedAt: new Date(Date.now() - 10 * 60_000) })
    .where(eq(billingEvents.id, alerts.billingConflictAlertMarkerId(payload.id)));
  const hung = releaseHang;
  senderMode = "ok";
  assert.equal(await deliver(payload), 409);
  assert.equal(sent.length, 1);
  assert.equal((await marker(payload.id))?.payload.sendAttempts, 2);

  // The first, late send finishing afterwards cannot overwrite the newer
  // claim. The operator received the alert twice: the documented, bounded
  // duplicate after an unconfirmed send.
  assert.ok(hung, "the first send is still pending");
  hung();
  await waitFor(async () => sent.length === 2);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const recorded = await marker(payload.id);
  assert.equal(recorded?.payload.delivery, "sent");
  assert.equal(recorded?.payload.sendAttempts, 2);
  assert.equal(sendCalls, 2);
});

async function attemptsInLastHour() {
  const { db } = await import("@workspace/db");
  const { billingEvents } = await import("@workspace/db/schema");
  const { and, eq, gte, sql } = await import("drizzle-orm");
  const [row] = await db
    .select({ attempts: sql<number>`count(*)::int` })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.provider, "slabplan-alert"),
        eq(billingEvents.type, "billing.binding_conflict.send_attempt"),
        gte(billingEvents.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  return row?.attempts ?? 0;
}

test("interleaved retries, failures, pending sends and new events never exceed the hourly send budget", async () => {
  // Attempts spent earlier in the hour (including by the tests above) count
  // against the same budget, so the limit is set relative to them.
  const baseline = await attemptsInLastHour();
  const budget = 4;
  const configure = (limit: number, deliveryWaitMs: number) =>
    alerts.__setBillingConflictAlertLimitsForTests({ maxEmailsPerHour: limit, deliveryWaitMs });

  const checkouts = await Promise.all(
    ["a", "b", "c", "d", "e"].map(async () => duplicateCheckout()),
  );
  type Payload = ReturnType<typeof event>;
  const [a, b, c, d, e] = checkouts.map((checkout) =>
    event("checkout.session.completed", checkout.session),
  ) as [Payload, Payload, Payload, Payload, Payload];
  const before = await Promise.all(checkouts.map((checkout) => billingRow(checkout.organizationId)));

  const steps: Array<[Payload, typeof senderMode]> = [
    [a, "fail"], // attempt 1: rejected by the mailbox
    [b, "ok"], // attempt 2: sent
    [e, "hang"], // attempt 3: outcome unknown when the webhook answers
    [a, "fail"], // attempt 4: a retry of a failed alert spends budget again
    [c, "ok"], // budget spent: suppressed
    [a, "ok"], // the failed alert is suppressed; its spent attempts stay spent
    [b, "ok"], // confirmed: not repeated
    [e, "ok"], // still claimed within its lease: not repeated
    [d, "ok"], // suppressed
    [c, "fail"], // suppressed again
    [a, "ok"], // still suppressed: suppression freed nothing
  ];
  for (const [payload, mode] of steps) {
    senderMode = mode;
    // Wait for each alert to finish so the steps stay ordered, except the
    // pending send, which must not hold the webhook.
    configure(baseline + budget, mode === "hang" ? 50 : 5_000);
    assert.equal(await deliver(payload), 409);
    if (mode === "hang") await waitFor(async () => releaseHang !== null);
  }
  assert.equal(sendCalls, budget, "provider calls never exceed the hourly budget");
  assert.equal(await attemptsInLastHour(), baseline + budget);

  const hung = releaseHang as (() => void) | null;
  assert.ok(hung, "the pending send is still in flight");
  hung();
  await waitFor(async () => (await marker(e.id))?.payload.delivery === "sent");

  assert.deepEqual(
    await Promise.all([a, b, c, d, e].map(async (payload) => {
      const recorded = await marker(payload.id);
      return [recorded?.payload.delivery, recorded?.payload.sendAttempts];
    })),
    [
      ["suppressed", 2],
      ["sent", 1],
      ["suppressed", 0],
      ["suppressed", 0],
      ["sent", 1],
    ],
  );
  assert.ok(logs.some((line) => line.includes('"delivery":"suppressed"')));

  // One more attempt of budget lets exactly one suppressed alert through.
  configure(baseline + budget + 1, 5_000);
  senderMode = "ok";
  assert.equal(await deliver(c), 409);
  assert.equal(await deliver(d), 409);
  assert.equal(await deliver(a), 409);
  assert.equal(sendCalls, budget + 1);
  assert.equal((await marker(c.id))?.payload.delivery, "sent");
  assert.equal((await marker(d.id))?.payload.delivery, "suppressed");

  assert.deepEqual(
    await Promise.all(checkouts.map((checkout) => billingRow(checkout.organizationId))),
    before,
    "no organization binding changed",
  );
});

/** Attempt rows written for exactly these events, independent of other tests. */
async function attemptRowsFor(stripeEventIds: string[]) {
  const { db } = await import("@workspace/db");
  const { billingEvents } = await import("@workspace/db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  const ids = stripeEventIds.flatMap((id) => alerts.billingConflictAlertRowIds(id).slice(1));
  const rows = await db
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(
      and(
        inArray(billingEvents.id, ids),
        eq(billingEvents.type, "billing.binding_conflict.send_attempt"),
      ),
    );
  return rows.length;
}

test("concurrent deliveries of the same and distinct events near the budget never exceed it", async () => {
  const checkouts = await Promise.all([0, 1, 2, 3].map(async () => duplicateCheckout()));
  type Payload = ReturnType<typeof event>;
  const [x, y, z, w] = checkouts.map((checkout) =>
    event("checkout.session.completed", checkout.session),
  ) as [Payload, Payload, Payload, Payload];
  const before = await Promise.all(checkouts.map((checkout) => billingRow(checkout.organizationId)));
  const budget = 2;
  alerts.__setBillingConflictAlertLimitsForTests({
    maxEmailsPerHour: (await attemptsInLastHour()) + budget,
    deliveryWaitMs: 5_000,
  });

  // One event delivered three times at once, plus three distinct events, all
  // competing for two sends.
  const statuses = await Promise.all([x, x, y, x, z, w].map((payload) => deliver(payload)));
  assert.deepEqual(statuses, [409, 409, 409, 409, 409, 409]);
  assert.equal(sendCalls, budget, "concurrent claims never exceed the budget");
  assert.equal(sent.length, budget);
  assert.equal(await attemptRowsFor([x.id, y.id, z.id, w.id]), budget);

  const markers = await Promise.all([x, y, z, w].map(async (payload) => (await marker(payload.id))?.payload));
  assert.equal(markers.filter((recorded) => recorded?.delivery === "sent").length, budget);
  assert.equal(markers.filter((recorded) => recorded?.delivery === "suppressed").length, 2);
  assert.ok(
    Number(markers[0]?.sendAttempts) <= 1,
    "simultaneous deliveries of one event share a single claim",
  );
  assert.equal(await attemptRowsFor([x.id]), Number(markers[0]?.sendAttempts));

  assert.deepEqual(
    await Promise.all(checkouts.map((checkout) => billingRow(checkout.organizationId))),
    before,
    "no organization binding changed",
  );
});

test("a suppressed alert sends once earlier attempts leave the rolling hour", async () => {
  const [first, second] = await Promise.all([duplicateCheckout(), duplicateCheckout()]);
  const alerted = event("checkout.session.completed", first.session);
  const held = event("checkout.session.completed", second.session);
  const before = await Promise.all([first, second].map((checkout) => billingRow(checkout.organizationId)));

  alerts.__setBillingConflictAlertLimitsForTests({
    maxEmailsPerHour: (await attemptsInLastHour()) + 1,
    deliveryWaitMs: 5_000,
  });
  assert.equal(await deliver(alerted), 409);
  assert.equal(sendCalls, 1);
  assert.equal((await marker(alerted.id))?.payload.delivery, "sent");

  // The budget is now exactly full: the second event is suppressed, and a
  // retry within the hour stays suppressed.
  const full = await attemptsInLastHour();
  alerts.__setBillingConflictAlertLimitsForTests({ maxEmailsPerHour: full, deliveryWaitMs: 5_000 });
  assert.equal(await deliver(held), 409);
  assert.equal(await deliver(held), 409);
  assert.equal(sendCalls, 1);
  assert.equal((await marker(held.id))?.payload.delivery, "suppressed");

  // Age the first event's attempt past the hour, as if time had passed. Only
  // then does the next Stripe retry of the suppressed event send.
  const { db } = await import("@workspace/db");
  const { billingEvents } = await import("@workspace/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const [, firstAttemptId] = alerts.billingConflictAlertRowIds(alerted.id);
  assert.ok(firstAttemptId);
  await db
    .update(billingEvents)
    .set({ createdAt: sql`now() - interval '61 minutes'` })
    .where(eq(billingEvents.id, firstAttemptId));
  assert.ok((await attemptsInLastHour()) < full);

  assert.equal(await deliver(held), 409);
  assert.equal(sendCalls, 2);
  const recorded = await marker(held.id);
  assert.equal(recorded?.payload.delivery, "sent");
  assert.equal(recorded?.payload.sendAttempts, 1);

  // The already-confirmed first alert is not re-sent by the freed budget.
  assert.equal(await deliver(alerted), 409);
  assert.equal(sendCalls, 2);

  assert.deepEqual(
    await Promise.all([first, second].map((checkout) => billingRow(checkout.organizationId))),
    before,
    "no organization binding changed",
  );
});
