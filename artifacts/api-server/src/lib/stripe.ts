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
      "Priority onboarding and support",
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
