import { billingPlans, getAppPublicUrl, getStripeClient, getStripePriceId } from "./stripe";

export async function inspectBillingReadiness() {
  const checks: Record<string, boolean> = {
    liveKeyConfigured: /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY?.trim() ?? ""),
    signingSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
    providerReachable: false,
    chargesEnabled: false,
    priceActive: false,
    priceMatchesPlan: false,
    webhookEnabled: false,
    webhookEventsConfigured: false,
  };
  try {
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(null);
    checks.providerReachable = true;
    checks.chargesEnabled = account.charges_enabled === true;
    const price = await stripe.prices.retrieve(getStripePriceId("pro"));
    checks.priceActive = price.active && price.livemode;
    checks.priceMatchesPlan = price.currency === "usd" && price.unit_amount === billingPlans.pro.monthlyUsd * 100 &&
      price.type === "recurring" && price.recurring?.interval === "month" && price.recurring.interval_count === 1;
    const expectedUrl = new URL("/api/billing/stripe/webhook", getAppPublicUrl()).toString();
    const required = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (endpoint.url !== expectedUrl || endpoint.status !== "enabled" || !endpoint.livemode) continue;
      checks.webhookEnabled = true;
      checks.webhookEventsConfigured ||= required.every((type) => endpoint.enabled_events.some((enabled) => enabled === type || enabled === "*"));
    }
  } catch {
    // Provider errors can contain account details. Return only bounded booleans;
    // this health check does not expose credentials, customers, or raw errors.
  }
  return { ready: Object.values(checks).every(Boolean), checks, scope: "configuration_only" as const };
}
