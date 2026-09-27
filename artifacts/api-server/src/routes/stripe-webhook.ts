import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { db } from "@workspace/db";
import { billingEvents, organizations } from "@workspace/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http";
import {
  BILLING_PLAN_KEYS,
  getOrganizationIdFromStripeClientReference,
  getStripeClient,
  getStripePriceId,
} from "../lib/stripe";
import { updateOrganizationFromStripeSubscription } from "./billing";

const router: IRouter = Router();
type StripeWebhookDbClient = Pick<typeof db, "select" | "insert" | "update">;

function requireWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new HttpError(
      503,
      "Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET.",
      undefined,
      "service-unavailable",
    );
  }
  return secret;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getPlanKeyFromSubscription(subscription: Stripe.Subscription) {
  return (
    BILLING_PLAN_KEYS.find((key) =>
      subscription.items.data.some(
        (item) =>
          item.price.id === getStripePriceId(key) && item.quantity === 1,
      ),
    ) ?? null
  );
}

function assertStripeMode(livemode: boolean) {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!/^(sk|rk)_(live|test)_/.test(key))
    throw new HttpError(503, "Stripe API key mode is not configured.");
  if (livemode !== /^(sk|rk)_live_/.test(key))
    throw new HttpError(
      400,
      "Stripe event mode does not match this environment.",
    );
}

async function handleCheckoutCompleted(
  eventSession: Stripe.Checkout.Session,
  database: StripeWebhookDbClient,
) {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(eventSession.id);
  assertStripeMode(session.livemode);
  if (session.mode !== "subscription" || session.status !== "complete") return;
  const organizationId =
    asString(session.metadata?.organizationId) ??
    getOrganizationIdFromStripeClientReference(
      asString(session.client_reference_id),
    );
  if (!organizationId || !z.string().uuid().safeParse(organizationId).success)
    return;

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : (session.customer?.id ?? null);
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);
  if (!customerId || !subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  assertStripeMode(subscription.livemode);
  const subscriptionCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  if (
    subscriptionCustomerId !== customerId ||
    (subscription.metadata.organizationId &&
      subscription.metadata.organizationId !== organizationId)
  ) {
    throw new HttpError(
      409,
      "Checkout and subscription ownership do not match.",
    );
  }
  const planKey = getPlanKeyFromSubscription(subscription);
  if (!planKey)
    throw new HttpError(
      409,
      "Checkout does not contain a configured SlabPlan subscription price.",
    );
  const billingEmail = asString(session.customer_details?.email);

  const [organization] = await database
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.id, organizationId),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);
  if (!organization) return;
  const bindings = await database
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      or(
        eq(organizations.stripeCustomerId, customerId),
        eq(organizations.stripeSubscriptionId, subscriptionId),
      ),
    );
  if (bindings.some((binding) => binding.id !== organizationId))
    throw new HttpError(
      409,
      "Stripe identifiers are already bound to another workspace.",
    );
  if (
    organization.stripeSubscriptionId &&
    organization.stripeSubscriptionId !== subscriptionId
  ) {
    const current = await stripe.subscriptions.retrieve(
      organization.stripeSubscriptionId,
    );
    if (!["canceled", "incomplete_expired"].includes(current.status))
      throw new HttpError(409, "Workspace already has another subscription.");
    // A delayed checkout for an older subscription cannot replace its successor.
    if (current.created >= subscription.created) return;
  }

  await database
    .update(organizations)
    .set({
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
      subscriptionStatus: subscription.status,
      planKey,
      billingEmail: billingEmail ?? undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(organizations.id, organizationId),
        isNull(organizations.deletedAt),
      ),
    );
}

async function handleSubscriptionChanged(
  eventSubscription: Stripe.Subscription,
  database: StripeWebhookDbClient,
) {
  // Stripe does not guarantee delivery order. Read the provider's current state
  // while the webhook transaction lock is held, including for deleted events.
  const subscription = await getStripeClient().subscriptions.retrieve(
    eventSubscription.id,
  );
  assertStripeMode(subscription.livemode);
  const planKey = getPlanKeyFromSubscription(subscription);
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : (subscription.customer?.id ?? null);

  await updateOrganizationFromStripeSubscription(
    {
      customerId,
      subscriptionId: subscription.id,
      status: planKey ? subscription.status : "unsupported_price",
      planKey,
    },
    database,
  );
}

async function processStripeEvent(
  event: Stripe.Event,
  database: StripeWebhookDbClient,
) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        database,
      );
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionChanged(
        event.data.object as Stripe.Subscription,
        database,
      );
      break;
    default:
      break;
  }
}

const handleStripeWebhook = asyncHandler(async (req, res) => {
  const signature = req.get("stripe-signature");
  if (!signature) {
    throw new HttpError(
      400,
      "Missing Stripe signature.",
      undefined,
      "validation",
    );
  }

  const stripe = getStripeClient();
  const webhookSecret = requireWebhookSecret();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch {
    throw new HttpError(
      400,
      "Invalid Stripe signature.",
      undefined,
      "validation",
    );
  }
  assertStripeMode(event.livemode);

  const duplicate = await db.transaction(async (tx) => {
    // Serialize provider reads and writes across autoscale instances so an
    // earlier request cannot commit stale state after a later request.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('slabplan-stripe-webhooks'))`,
    );
    const inserted = await tx
      .insert(billingEvents)
      .values({
        id: event.id,
        provider: "stripe",
        type: event.type,
        livemode: event.livemode,
        payload: {
          id: event.id,
          type: event.type,
          created: event.created,
          livemode: event.livemode,
          objectId: "id" in event.data.object ? event.data.object.id : null,
        },
      })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });

    if (inserted.length === 0) {
      return true;
    }

    await processStripeEvent(event, tx);
    return false;
  });

  if (duplicate) {
    res.json({ received: true, duplicate: true });
    return;
  }

  res.json({ received: true });
});

// Express 5 leaves the mounted URL as either "" or "/" depending on the
// exact caller path. Register both so the webhook stays ahead of auth/CSRF.
router.post("", handleStripeWebhook);
router.post("/", handleStripeWebhook);

export default router;
