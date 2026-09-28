import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

process.env.STRIPE_SECRET_KEY = "sk_live_local_fixture_not_a_real_key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_fixture_not_a_real_key";
process.env.STRIPE_PRICE_PRO = "price_local_fixture";
process.env.APP_PUBLIC_URL = "https://app.example.test";
delete process.env.STRIPE_PAYMENT_LINK_URL;
const { getStripeClient } = await import("../src/lib/stripe.ts");
const { inspectBillingReadiness, assertBillingReadyForCheckout } = await import("../src/lib/billing-readiness.ts");
const stripe = getStripeClient();
let providerFails = false;
let priceMatches = true;
let endpointMatches = true;
let linkActive = true;
let linkPriceMatches = true;
let adjustableQuantity = false;
let linkOrganizationId: string | undefined;

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
  mock.method(stripe.paymentLinks, "list", () => ({
    async *[Symbol.asyncIterator]() {
      yield { id: "plink_local_fixture", url: "https://buy.stripe.com/local-fixture", active: linkActive, livemode: true, metadata: { organizationId: linkOrganizationId } };
    },
  }));
  mock.method(stripe.paymentLinks, "listLineItems", async () => ({ has_more: false, data: [{ price: { id: linkPriceMatches ? "price_local_fixture" : "price_wrong" }, quantity: 1, adjustable_quantity: { enabled: adjustableQuantity } }] }));
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

test("a configured payment link must be live, active, fixed quantity, and scoped to the configured plan", async () => {
  process.env.STRIPE_PAYMENT_LINK_URL = "https://buy.stripe.com/local-fixture";
  try {
    assert.equal((await inspectBillingReadiness()).ready, true);
    linkActive = false;
    assert.equal((await inspectBillingReadiness()).ready, false);
    linkActive = true;
    linkPriceMatches = false;
    assert.equal((await inspectBillingReadiness()).ready, false);
    linkPriceMatches = true;
    adjustableQuantity = true;
    assert.equal((await inspectBillingReadiness()).ready, false);
    adjustableQuantity = false;
    linkOrganizationId = "another-workspace";
    assert.equal((await inspectBillingReadiness()).ready, false);
    linkOrganizationId = undefined;
    process.env.STRIPE_PAYMENT_LINK_URL = "https://buy.stripe.com/missing";
    assert.equal((await inspectBillingReadiness()).ready, false);
  } finally {
    delete process.env.STRIPE_PAYMENT_LINK_URL;
    linkActive = true;
    linkPriceMatches = true;
    adjustableQuantity = false;
    linkOrganizationId = undefined;
  }
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
