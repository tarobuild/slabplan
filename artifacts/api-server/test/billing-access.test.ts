import assert from "node:assert/strict";
import test from "node:test";
import { hasBillingAccess } from "../src/lib/billing-access.ts";
import {
  BILLING_PLAN_KEYS,
  billingPlans,
  getConfiguredBillingPlans,
} from "../src/lib/stripe.ts";

test("SlabPlan exposes one $250 Full Access plan", () => {
  assert.deepEqual(BILLING_PLAN_KEYS, ["pro"]);
  assert.equal(billingPlans.pro.name, "Full Access");
  assert.equal(billingPlans.pro.monthlyUsd, 250);
  assert.equal(billingPlans.pro.maxUsers, 25);
  assert.deepEqual(
    getConfiguredBillingPlans().map((plan) => plan.key),
    ["pro"],
  );
});

test("grandfathered organizations retain access without a subscription", () => {
  assert.equal(
    hasBillingAccess({
      requiresSubscription: false,
      subscriptionStatus: null,
      trialEndsAt: null,
    }),
    true,
  );
});

test("new organizations require an active or trialing subscription", () => {
  for (const subscriptionStatus of [null, "incomplete", "past_due", "unpaid", "canceled"]) {
    assert.equal(
      hasBillingAccess({
        requiresSubscription: true,
        subscriptionStatus,
        trialEndsAt: null,
      }),
      false,
    );
  }

  for (const subscriptionStatus of ["active", "trialing"]) {
    assert.equal(
      hasBillingAccess({
        requiresSubscription: true,
        subscriptionStatus,
        trialEndsAt: null,
      }),
      true,
    );
  }
});

test("a time-limited workspace trial grants access only before it expires", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  assert.equal(
    hasBillingAccess(
      {
        requiresSubscription: true,
        subscriptionStatus: null,
        trialEndsAt: new Date("2026-08-02T12:00:00.000Z"),
      },
      now,
    ),
    true,
  );
  assert.equal(
    hasBillingAccess(
      {
        requiresSubscription: true,
        subscriptionStatus: null,
        trialEndsAt: new Date("2026-07-31T12:00:00.000Z"),
      },
      now,
    ),
    false,
  );
});
