import { Router, type IRouter } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { organizations } from "@workspace/db/schema";
import { HttpError, asyncHandler } from "../lib/http";
import {
  billingPlans,
  getAppPublicUrl,
  getConfiguredBillingPlans,
  getStripeClient,
  getStripePriceId,
  isBillingPlanKey,
} from "../lib/stripe";
import { getActiveOrganizationId } from "../lib/tenant-scope";

const router: IRouter = Router();

const checkoutSchema = z.object({
  planKey: z.string().trim().transform((value) => value.toLowerCase()),
});

function assertCanManageBilling(req: Express.Request) {
  const auth = req.auth;
  if (!auth) {
    throw new HttpError(401, "Authentication required.", undefined, "unauthorized");
  }

  const organizationRole = auth.organizationRole;
  if (organizationRole === "owner" || organizationRole === "admin" || auth.role === "admin") {
    return;
  }

  throw new HttpError(
    403,
    "Only organization owners and admins can manage billing.",
    undefined,
    "forbidden",
  );
}

async function loadActiveOrganization(req: Express.Request) {
  const organizationId = getActiveOrganizationId(req.auth!);
  if (!organizationId) {
    throw new HttpError(
      400,
      "Billing requires an active organization.",
      undefined,
      "validation",
    );
  }

  const [organization] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
    .limit(1);

  if (!organization) {
    throw new HttpError(404, "Organization not found.", undefined, "not-found");
  }

  return organization;
}

async function ensureStripeCustomer(params: {
  organization: Awaited<ReturnType<typeof loadActiveOrganization>>;
  userEmail: string;
}) {
  const { organization, userEmail } = params;
  if (organization.stripeCustomerId) return organization.stripeCustomerId;

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    name: organization.name,
    email: organization.billingEmail || userEmail,
    metadata: {
      organizationId: organization.id,
      organizationSlug: organization.slug,
    },
  });

  await db
    .update(organizations)
    .set({
      stripeCustomerId: customer.id,
      billingEmail: organization.billingEmail || userEmail,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organization.id));

  return customer.id;
}

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const organization = await loadActiveOrganization(req);
    res.json({
      organization: {
        id: organization.id,
        name: organization.name,
        planKey: organization.planKey,
        subscriptionStatus: organization.subscriptionStatus,
        billingEmail: organization.billingEmail,
        hasStripeCustomer: Boolean(organization.stripeCustomerId),
        hasStripeSubscription: Boolean(organization.stripeSubscriptionId),
        trialEndsAt: organization.trialEndsAt?.toISOString() ?? null,
      },
      plans: getConfiguredBillingPlans(),
      billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    });
  }),
);

router.post(
  "/checkout-sessions",
  asyncHandler(async (req, res) => {
    assertCanManageBilling(req);

    const parsed = checkoutSchema.safeParse(req.body ?? {});
    if (!parsed.success || !isBillingPlanKey(parsed.data.planKey)) {
      throw new HttpError(
        400,
        "Invalid billing plan.",
        parsed.success ? undefined : parsed.error.flatten(),
        "validation",
      );
    }

    const organization = await loadActiveOrganization(req);
    const stripe = getStripeClient();
    const plan = billingPlans[parsed.data.planKey];
    const customerId = await ensureStripeCustomer({
      organization,
      userEmail: req.auth!.email,
    });
    const publicUrl = getAppPublicUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getStripePriceId(plan.key), quantity: 1 }],
      success_url: `${publicUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl}/billing`,
      client_reference_id: organization.id,
      metadata: {
        organizationId: organization.id,
        planKey: plan.key,
      },
      subscription_data: {
        metadata: {
          organizationId: organization.id,
          planKey: plan.key,
        },
      },
    });

    if (!session.url) {
      throw new HttpError(502, "Stripe did not return a checkout URL.");
    }

    res.status(201).json({ url: session.url });
  }),
);

router.post(
  "/customer-portal-sessions",
  asyncHandler(async (req, res) => {
    assertCanManageBilling(req);

    const organization = await loadActiveOrganization(req);
    if (!organization.stripeCustomerId) {
      throw new HttpError(
        409,
        "This organization does not have a Stripe customer yet.",
        undefined,
        "billing-not-started",
      );
    }

    const stripe = getStripeClient();
    const publicUrl = getAppPublicUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: `${publicUrl}/billing`,
    });

    res.status(201).json({ url: session.url });
  }),
);

export async function updateOrganizationFromStripeSubscription(params: {
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  planKey: string | null;
}) {
  const conditions = [
    params.subscriptionId ? eq(organizations.stripeSubscriptionId, params.subscriptionId) : undefined,
    params.customerId ? eq(organizations.stripeCustomerId, params.customerId) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

  if (conditions.length === 0) return;

  await db
    .update(organizations)
    .set({
      stripeCustomerId: params.customerId ?? undefined,
      stripeSubscriptionId: params.subscriptionId ?? undefined,
      subscriptionStatus: params.status ?? undefined,
      planKey: params.planKey && isBillingPlanKey(params.planKey) ? params.planKey : undefined,
      updatedAt: new Date(),
    })
    .where(conditions.length === 1 ? conditions[0] : or(...conditions));
}

export default router;
