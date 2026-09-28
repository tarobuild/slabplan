import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test, mock } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import Stripe from "stripe";

const runId = randomUUID();
const organizationIds: string[] = [];
const eventIds: string[] = [];
const subscriptions = new Map<string, Stripe.Subscription>();
const sessions = new Map<string, Stripe.Checkout.Session>();
let server: Server;
let baseUrl: string;
let stripe: Stripe;
let failedProviderRead = false;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.STRIPE_SECRET_KEY = "sk_test_local_webhook_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_webhook_fixture";
  process.env.STRIPE_PRICE_PRO = "price_test_pro";
  // Conflict alerts are covered in stripe-webhook-conflict-alerts.test.ts;
  // here they must never reach a real mailbox.
  delete process.env.SECURITY_ALERT_EMAIL;
  const { getStripeClient } = await import("../src/lib/stripe.ts");
  stripe = getStripeClient();
  mock.method(stripe.subscriptions, "retrieve", async (id: string) => {
    if (failedProviderRead) throw new Error("Test provider unavailable");
    const subscription = subscriptions.get(id);
    assert.ok(subscription, `Unknown fixture subscription ${id}`);
    return subscription;
  });
  mock.method(stripe.checkout.sessions, "retrieve", async (id: string) => {
    const session = sessions.get(id);
    assert.ok(session);
    return session;
  });
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

after(async () => {
  mock.restoreAll();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  const { db, pool } = await import("@workspace/db");
  const { billingEvents, organizations } = await import("@workspace/db/schema");
  const { inArray } = await import("drizzle-orm");
  const { billingConflictAlertRowIds } = await import(
    "../src/lib/billing-conflict-alerts.ts"
  );
  try {
    if (eventIds.length)
      await db
        .delete(billingEvents)
        .where(
          inArray(billingEvents.id, [
            ...eventIds,
            ...eventIds.flatMap(billingConflictAlertRowIds),
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

async function fixture() {
  const { db } = await import("@workspace/db");
  const { organizations } = await import("@workspace/db/schema");
  const id = randomUUID();
  organizationIds.push(id);
  await db
    .insert(organizations)
    .values({
      id,
      name: `TEST webhook ${runId}`,
      slug: `test-${id}`,
      requiresSubscription: true,
    });
  const subscription = {
    id: `sub_${id}`,
    customer: `cus_${id}`,
    livemode: false,
    status: "active",
    created: 100,
    metadata: { organizationId: id },
    items: { data: [{ price: { id: "price_test_pro" }, quantity: 1 }] },
  } as unknown as Stripe.Subscription;
  const { createStripeClientReferenceId } =
    await import("../src/lib/stripe.ts");
  const session = {
    id: `cs_${id}`,
    customer: subscription.customer,
    subscription: subscription.id,
    livemode: false,
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    metadata: {},
    client_reference_id: createStripeClientReferenceId(id),
    customer_details: { email: "test@example.invalid" },
  } as unknown as Stripe.Checkout.Session;
  subscriptions.set(subscription.id, subscription);
  sessions.set(session.id, session);
  return { id, subscription, session };
}

async function organization(id: string) {
  const { db } = await import("@workspace/db");
  const { organizations } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  return (
    await db.select().from(organizations).where(eq(organizations.id, id))
  )[0];
}

function event(type: string, object: unknown, livemode = false) {
  const id = `evt_${randomUUID()}`;
  eventIds.push(id);
  return { id, type, livemode, created: 100, data: { object } };
}

async function deliver(payload: ReturnType<typeof event>, signature?: string) {
  const body = JSON.stringify(payload);
  return fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature":
        signature ??
        stripe.webhooks.generateTestHeaderString({
          payload: body,
          secret: process.env.STRIPE_WEBHOOK_SECRET!,
        }),
    },
    body,
  });
}

test("signed paid checkout binds only its workspace and is idempotent without storing customer PII", async () => {
  const { id, session, subscription } = await fixture();
  const payload = event("checkout.session.completed", session);
  assert.equal((await deliver(payload)).status, 200);
  assert.equal((await organization(id)).stripeSubscriptionId, subscription.id);
  assert.equal((await organization(id)).subscriptionStatus, "active");
  assert.equal((await (await deliver(payload)).json()).duplicate, true);
  const { db } = await import("@workspace/db");
  const { billingEvents } = await import("@workspace/db/schema");
  const { eq } = await import("drizzle-orm");
  const [stored] = await db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.id, payload.id));
  assert.equal(
    JSON.stringify(stored.payload).includes("test@example.invalid"),
    false,
  );
});

test("out-of-order subscription and checkout events cannot reactivate a canceled subscription", async () => {
  const { id, session, subscription } = await fixture();
  assert.equal(
    (await deliver(event("checkout.session.completed", session))).status,
    200,
  );
  subscription.status = "canceled";
  assert.equal(
    (
      await deliver(
        event("customer.subscription.updated", {
          ...subscription,
          status: "active",
        }),
      )
    ).status,
    200,
  );
  assert.equal((await organization(id)).subscriptionStatus, "canceled");
  assert.equal(
    (await deliver(event("checkout.session.completed", session))).status,
    200,
  );
  assert.equal((await organization(id)).subscriptionStatus, "canceled");
});

test("current failed-payment status revokes access even if event payload says active", async () => {
  const { id, session, subscription } = await fixture();
  assert.equal(
    (await deliver(event("checkout.session.completed", session))).status,
    200,
  );
  subscription.status = "past_due";
  assert.equal(
    (
      await deliver(
        event("customer.subscription.updated", {
          ...subscription,
          status: "active",
        }),
      )
    ).status,
    200,
  );
  assert.equal((await organization(id)).subscriptionStatus, "past_due");
});

test("invalid signatures and test/live mismatch cannot change billing state", async () => {
  const { id, session } = await fixture();
  assert.equal(
    (
      await deliver(
        event("checkout.session.completed", session),
        "bad-signature",
      )
    ).status,
    400,
  );
  assert.equal(
    (await deliver(event("checkout.session.completed", session, true))).status,
    400,
  );
  assert.equal((await organization(id)).stripeSubscriptionId, null);
});

test("another workspace cannot claim an already-bound customer or subscription", async () => {
  const first = await fixture();
  const second = await fixture();
  assert.equal(
    (await deliver(event("checkout.session.completed", first.session))).status,
    200,
  );
  second.session.customer = first.subscription.customer;
  second.session.subscription = first.subscription.id;
  assert.equal(
    (await deliver(event("checkout.session.completed", second.session))).status,
    409,
  );
  assert.equal((await organization(second.id)).stripeSubscriptionId, null);
});

test("unsupported prices do not grant access and removal of an allowed price revokes existing access", async () => {
  const { id, session, subscription } = await fixture();
  assert.equal(
    (await deliver(event("checkout.session.completed", session))).status,
    200,
  );
  subscription.items.data[0].price.id = "price_unrelated";
  assert.equal(
    (await deliver(event("customer.subscription.updated", subscription)))
      .status,
    200,
  );
  assert.equal(
    (await organization(id)).subscriptionStatus,
    "unsupported_price",
  );
  assert.equal(
    (await deliver(event("checkout.session.completed", session))).status,
    409,
  );
});

test("provider errors roll back event processing so Stripe can retry", async () => {
  const { id, session } = await fixture();
  const payload = event("checkout.session.completed", session);
  failedProviderRead = true;
  try {
    assert.equal((await deliver(payload)).status, 500);
  } finally {
    failedProviderRead = false;
  }
  assert.equal((await organization(id)).stripeSubscriptionId, null);
  assert.equal((await deliver(payload)).status, 200);
});

test("an older subscription cannot overwrite a replacement for the same customer", async () => {
  const { id, session, subscription } = await fixture();
  assert.equal(
    (await deliver(event("checkout.session.completed", session))).status,
    200,
  );
  const old = {
    ...subscription,
    id: `sub_old_${id}`,
    status: "canceled",
    created: 50,
  } as Stripe.Subscription;
  subscriptions.set(old.id, old);
  assert.equal(
    (await deliver(event("customer.subscription.deleted", old))).status,
    200,
  );
  assert.equal((await organization(id)).stripeSubscriptionId, subscription.id);
  assert.equal((await organization(id)).subscriptionStatus, "active");
});
