import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { db } from "@workspace/db";
import { billingEvents, organizations } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { HttpError, asyncHandler } from "../lib/http";
import { getStripeClient, isBillingPlanKey } from "../lib/stripe";
import { updateOrganizationFromStripeSubscription } from "./billing";

const router: IRouter = Router();

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
  const metadataPlan = asString(subscription.metadata?.planKey);
  if (metadataPlan && isBillingPlanKey(metadataPlan)) return metadataPlan;
  return null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId = asString(session.metadata?.organizationId);
  if (!organizationId) return;

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;
  const planKey = asString(session.metadata?.planKey);

  await db
    .update(organizations)
    .set({
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
      subscriptionStatus: subscriptionId ? "active" : session.payment_status ?? undefined,
      planKey: planKey && isBillingPlanKey(planKey) ? planKey : undefined,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));
}

async function handleSubscriptionChanged(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  await updateOrganizationFromStripeSubscription({
    customerId,
    subscriptionId: subscription.id,
    status: subscription.status,
    planKey: getPlanKeyFromSubscription(subscription),
  });
}

async function processStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionChanged(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
}

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const signature = req.get("stripe-signature");
    if (!signature) {
      throw new HttpError(400, "Missing Stripe signature.", undefined, "validation");
    }

    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      requireWebhookSecret(),
    );

    const inserted = await db
      .insert(billingEvents)
      .values({
        id: event.id,
        provider: "stripe",
        type: event.type,
        livemode: event.livemode,
        payload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });

    if (inserted.length === 0) {
      res.json({ received: true, duplicate: true });
      return;
    }

    await processStripeEvent(event);
    res.json({ received: true });
  }),
);

export default router;
