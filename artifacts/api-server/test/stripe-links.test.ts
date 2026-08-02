import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createStripeClientReferenceId,
  getCheckoutSubscriptionStatus,
  getOrganizationIdFromStripeClientReference,
  getStripeCustomerPortalUrl,
  getStripePaymentLinkUrl,
  isStripeCheckoutConfigured,
} from "../src/lib/stripe";

const originalPaymentLink = process.env.STRIPE_PAYMENT_LINK_URL;
const originalPortalUrl = process.env.STRIPE_CUSTOMER_PORTAL_URL;
const originalSecretKey = process.env.STRIPE_SECRET_KEY;
const originalReferenceSecret =
  process.env.STRIPE_CLIENT_REFERENCE_SECRET;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv("STRIPE_PAYMENT_LINK_URL", originalPaymentLink);
  restoreEnv("STRIPE_CUSTOMER_PORTAL_URL", originalPortalUrl);
  restoreEnv("STRIPE_SECRET_KEY", originalSecretKey);
  restoreEnv("STRIPE_CLIENT_REFERENCE_SECRET", originalReferenceSecret);
});

test("payment links carry tenant and authenticated email context", () => {
  process.env.STRIPE_PAYMENT_LINK_URL =
    "https://buy.stripe.com/example?locale=en";
  process.env.STRIPE_CLIENT_REFERENCE_SECRET = "test-reference-secret";

  const url = new URL(
    getStripePaymentLinkUrl({
      organizationId: "org_123",
      userEmail: "owner+slabplan@example.com",
    })!,
  );

  assert.equal(url.origin, "https://buy.stripe.com");
  assert.equal(url.searchParams.get("locale"), "en");
  assert.equal(
    getOrganizationIdFromStripeClientReference(
      url.searchParams.get("client_reference_id"),
    ),
    "org_123",
  );
  assert.equal(
    url.searchParams.get("prefilled_email"),
    "owner+slabplan@example.com",
  );
});

test("payment-link checkout is configured without a secret key", () => {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_PAYMENT_LINK_URL = "https://buy.stripe.com/example";

  assert.equal(isStripeCheckoutConfigured(), true);
});

test("customer portal requires an HTTPS URL", () => {
  process.env.STRIPE_CUSTOMER_PORTAL_URL = "http://billing.example.com";

  assert.throws(
    () => getStripeCustomerPortalUrl(),
    /STRIPE_CUSTOMER_PORTAL_URL must be a valid https:\/\/billing\.stripe\.com URL/,
  );
});

test("tampered client references cannot select another tenant", () => {
  process.env.STRIPE_CLIENT_REFERENCE_SECRET = "test-reference-secret";
  const reference = createStripeClientReferenceId("org_123");

  assert.equal(
    getOrganizationIdFromStripeClientReference(reference),
    "org_123",
  );
  assert.equal(
    getOrganizationIdFromStripeClientReference(reference.replace("org_123", "org_456")),
    null,
  );
});

test("only completed checkout payments grant immediate access", () => {
  assert.equal(getCheckoutSubscriptionStatus("paid"), "active");
  assert.equal(getCheckoutSubscriptionStatus("no_payment_required"), "active");
  assert.equal(getCheckoutSubscriptionStatus("unpaid"), "unpaid");
  assert.equal(getCheckoutSubscriptionStatus(null), null);
});
