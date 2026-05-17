import Stripe from "stripe";
import { HttpError } from "./http";

export const BILLING_PLAN_KEYS = ["starter", "team", "pro"] as const;
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
  starter: {
    key: "starter",
    name: "Starter",
    monthlyUsd: 79,
    maxUsers: 3,
    priceEnv: "STRIPE_PRICE_STARTER",
    features: [
      "Jobs, clients, leads, and scheduling",
      "Private file storage",
      "Basic reports",
      "Limited AI document parsing",
    ],
  },
  team: {
    key: "team",
    name: "Team",
    monthlyUsd: 149,
    maxUsers: 10,
    priceEnv: "STRIPE_PRICE_TEAM",
    features: [
      "Everything in Starter",
      "Daily logs and team activity",
      "Financial tracker workflows",
      "Standard AI assistant usage",
    ],
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthlyUsd: 249,
    maxUsers: 25,
    priceEnv: "STRIPE_PRICE_PRO",
    features: [
      "Everything in Team",
      "Advanced reports and export workflows",
      "Higher AI usage allowance",
      "Priority support",
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
