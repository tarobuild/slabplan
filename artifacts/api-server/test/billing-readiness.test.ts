import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

process.env.STRIPE_SECRET_KEY = "sk_live_local_fixture_not_a_real_key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_fixture_not_a_real_key";
process.env.STRIPE_PRICE_PRO = "price_local_fixture";
process.env.APP_PUBLIC_URL = "https://app.example.test";
const { getStripeClient } = await import("../src/lib/stripe.ts");
const { inspectBillingReadiness, assertBillingReadyForCheckout } = await import("../src/lib/billing-readiness.ts");
const stripe = getStripeClient();
let providerFails = false;
let priceMatches = true;
let endpointMatches = true;

before(() => {
  mock.method(stripe.accounts, "retrieve", async () => {
    if (providerFails) throw new Error("sensitive-provider-response");
    return { charges_enabled: true };
  });
  mock.method(stripe.prices, "retrieve", async () => ({ active: true, livemode: true, currency: "usd", unit_amount: priceMatches ? 25000 : 100, type: "recurring", recurring: { interval: "month", interval_count: 1 } }));
  mock.method(stripe.webhookEndpoints, "list", () => ({
    async *[Symbol.asyncIterator]() {
      yield { url: endpointMatches ? "https://app.example.test/api/billing/stripe/webhook" : "https://different.example.test/webhook", status: "enabled", livemode: true, enabled_events: ["*"] };
    },
  }));
});
after(() => mock.restoreAll());

test("billing readiness verifies live provider configuration without returning sensitive values", async () => {
  const result = await inspectBillingReadiness();
  assert.equal(result.ready, true);
  assert.equal(result.scope, "configuration_only");
  assert.ok(Object.values(result.checks).every(value => typeof value === "boolean"));
  assert.ok(!JSON.stringify(result).includes("sk_live_"));
});
test("wrong price or wrong webhook URL is not ready", async () => {
  priceMatches = false;
  assert.equal((await inspectBillingReadiness()).ready, false);
  priceMatches = true;
  endpointMatches = false;
  assert.equal((await inspectBillingReadiness()).ready, false);
  endpointMatches = true;
});
test("provider failure fails closed without leaking the provider response", async () => {
  providerFails = true;
  const result = await inspectBillingReadiness();
  assert.equal(result.ready, false);
  assert.equal(result.checks.providerReachable, false);
  assert.ok(!JSON.stringify(result).includes("sensitive-provider-response"));
  providerFails = false;
});

test("production checkout fails closed before a customer is sent to an unverified payment setup", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assertBillingReadyForCheckout();
    endpointMatches = false;
    await assert.rejects(assertBillingReadyForCheckout(), /checkout is temporarily unavailable/);
  } finally {
    endpointMatches = true;
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
