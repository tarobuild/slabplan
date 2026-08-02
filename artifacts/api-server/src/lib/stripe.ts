import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { HttpError } from "./http";

export const BILLING_PLAN_KEYS = ["pro"] as const;
export type BillingPlanKey = (typeof BILLING_PLAN_KEYS)[number];

export type BillingPlan = {
  key: BillingPlanKey;
  name: string;
  monthlyUsd: number;
  maxUsers: number;
  features: string[];
  priceEnv: string;
};

export const billingPlans: Record<BillingPlanKey, BillingPlan> = {
  pro: {
    key: "pro",
    name: "Full Access",
    monthlyUsd: 250,
    maxUsers: 25,
    priceEnv: "STRIPE_PRICE_PRO",
    features: [
      "Every SlabPlan workflow and report",
      "Up to 25 team members",
      "Private project files and field media",
      "AI-assisted document and operations workflows",
      "Role-aware team access",
    ],
  },
};

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;

  const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(
      503,
      "Stripe is not configured. Set STRIPE_SECRET_KEY before using billing.",
      undefined,
      "service-unavailable",
    );
  }

  stripeClient = new Stripe(apiKey, {
    appInfo: {
      name: "SlabPlan",
    },
  });

  return stripeClient;
}

export function getConfiguredBillingPlans() {
  return BILLING_PLAN_KEYS.map((key) => {
    const plan = billingPlans[key];
    return {
      key: plan.key,
      name: plan.name,
      monthlyUsd: plan.monthlyUsd,
      maxUsers: plan.maxUsers,
      features: plan.features,
      configured: Boolean(process.env[plan.priceEnv]?.trim()),
    };
  });
}

function getHttpsUrlFromEnv(name: string, allowedHostname: string): URL | null {
  const value = process.env[name]?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(
      503,
      `${name} must be a valid HTTPS URL.`,
      undefined,
      "service-unavailable",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== allowedHostname ||
    url.username ||
    url.password
  ) {
    throw new HttpError(
      503,
      `${name} must be a valid https://${allowedHostname} URL.`,
      undefined,
      "service-unavailable",
    );
  }

  return url;
}

function getClientReferenceSecret(): string {
  const secret =
    process.env.STRIPE_CLIENT_REFERENCE_SECRET?.trim() ||
    process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new HttpError(
      503,
      "STRIPE_CLIENT_REFERENCE_SECRET or STRIPE_WEBHOOK_SECRET is required for payment-link checkout.",
      undefined,
      "service-unavailable",
    );
  }
  return secret;
}

export function createStripeClientReferenceId(organizationId: string): string {
  const signature = createHmac("sha256", getClientReferenceSecret())
    .update(organizationId)
    .digest("base64url");
  return `${organizationId}.${signature}`;
}

export function getOrganizationIdFromStripeClientReference(
  clientReferenceId: string | null,
): string | null {
  if (!clientReferenceId) return null;

  const separatorIndex = clientReferenceId.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const organizationId = clientReferenceId.slice(0, separatorIndex);
  const suppliedSignature = clientReferenceId.slice(separatorIndex + 1);
  const expectedSignature = createHmac("sha256", getClientReferenceSecret())
    .update(organizationId)
    .digest("base64url");
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  return organizationId;
}

export function getStripePaymentLinkUrl(params: {
  organizationId: string;
  userEmail: string;
}): string | null {
  const url = getHttpsUrlFromEnv("STRIPE_PAYMENT_LINK_URL", "buy.stripe.com");
  if (!url) return null;

  url.searchParams.set(
    "client_reference_id",
    createStripeClientReferenceId(params.organizationId),
  );
  url.searchParams.set("prefilled_email", params.userEmail);
  return url.toString();
}

export function getStripeCustomerPortalUrl(): string | null {
  return (
    getHttpsUrlFromEnv("STRIPE_CUSTOMER_PORTAL_URL", "billing.stripe.com")
      ?.toString() ?? null
  );
}

export function getCheckoutSubscriptionStatus(
  paymentStatus: Stripe.Checkout.Session["payment_status"] | null,
): string | null {
  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") {
    return "active";
  }
  return paymentStatus;
}

export function isStripeCheckoutConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_PAYMENT_LINK_URL?.trim() ||
      process.env.STRIPE_SECRET_KEY?.trim(),
  );
}

export function getStripePriceId(planKey: BillingPlanKey): string {
  const plan = billingPlans[planKey];
  const priceId = process.env[plan.priceEnv]?.trim();
  if (!priceId) {
    throw new HttpError(
      503,
      `Stripe price for ${plan.name} is not configured. Set ${plan.priceEnv}.`,
      undefined,
      "service-unavailable",
    );
  }
  return priceId;
}

export function isBillingPlanKey(value: string): value is BillingPlanKey {
  return (BILLING_PLAN_KEYS as readonly string[]).includes(value);
}

export function getAppPublicUrl(): string {
  const publicUrl = process.env.APP_PUBLIC_URL?.trim();
  if (!publicUrl) {
    throw new HttpError(
      503,
      "APP_PUBLIC_URL is required before creating billing links.",
      undefined,
      "service-unavailable",
    );
  }
  return publicUrl.replace(/\/+$/, "");
}
