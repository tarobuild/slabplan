# Billing Conflict Runbook

Use this when the email **"SlabPlan billing conflict needs review"** arrives,
or when a `security.billing_conflict` log line appears.

This runbook is for operators only. It changes nothing automatically. Every
cancellation or refund below is a manual action taken by someone with normal
Stripe refund authority (today the account owner). Do not change account-wide
Stripe settings to resolve a single conflict. That includes customer emails,
retry rules, the one-subscription checkout limit, and portal defaults, because
the Stripe account is shared with another product.

## What happened

Stripe sent a **signed** webhook event (the signature and live/test mode were
verified). SlabPlan refused to apply it because the event's customer or
subscription conflicts with an existing workspace binding.

- The webhook answered `409`. No workspace's plan, status, customer or
  subscription was changed, and the event was not marked as processed.
- Stripe retries the event on its normal schedule (up to about three days in
  live mode). Each retry is refused the same way until the retries end. That
  is expected; resolving the payment below does not make the retry succeed.
- Nothing was canceled or refunded, and no customer was contacted.

## Alert delivery guarantees

- **One marker per Stripe event.** A confirmed alert email is not sent again
  for that event.
- **Bounded duplicates.** A send can fail, time out, or finish without its
  result being recorded (for example, the instance stopped). The next Stripe
  retry of the event may then send the email again. An SMTP error or timeout
  does not prove the email was not accepted, so **you may receive the same
  alert more than once, at most three times per event.** Treat duplicates with
  the same Stripe event id as one incident.
- **Hourly budget.** Each send attempt is recorded before it is made and counts
  whether or not it succeeds. At most ten alert emails are attempted in any
  rolling hour. Beyond that, conflicts are still recorded, marked
  `suppressed`, and logged at error level. A suppressed event may alert on a
  later Stripe retry once the hour allows.
- **Missing recipient.** If `SECURITY_ALERT_EMAIL` is not configured, the
  conflict is recorded as `failed` / `unconfigured` without using an attempt.
  It alerts on a later retry once the recipient is configured.
- **Contents.** The email and logs contain only the Stripe event id and type, a
  reason code and the mode. They never contain customer contact details,
  amounts, workspace names or workspace ids.

## 1. Triage

1. Open the event from the email's link (`dashboard.stripe.com/events/…`, or
   `/test/events/…` for TEST mode). A TEST-mode alert is not a real charge.
   Still check why it happened.
2. Look up the private marker to find the affected workspace ids. This needs
   authorized read-only access to the production database. Run it as a
   read-only query:

   ```sql
   select id,
          payload->>'reason'          as reason,
          payload->>'delivery'        as delivery,
          payload->>'sendAttempts'    as send_attempts,
          payload->'organizationIds'  as organization_ids,
          livemode, created_at, updated_at
   from billing_events
   where provider = 'slabplan-alert'
     and type = 'billing.binding_conflict'
     and payload->>'eventId' = '<evt_… from the email>';
   ```

3. Read each affected workspace's current binding (read-only):

   ```sql
   select id, subscription_status, plan_key,
          stripe_customer_id, stripe_subscription_id
   from organizations
   where id in ('<organization id>', '<organization id>');
   ```

4. Do not copy customer names, emails, card details or amounts into GitHub
   issues, pull requests, commits, or Actions logs: the repository is public.
   Keep notes in a restricted incident record, as described in
   `docs/incident-response-runbook.md`.

## 2. Diagnose by reason

| Reason | Meaning | Usual cause |
| --- | --- | --- |
| `workspace_has_other_subscription` | The workspace already has a subscription that is not canceled. This checkout created another paid one | The same workspace completed checkout twice, for example in two browser tabs of the payment link. **Possible duplicate charge.** |
| `identifiers_bound_to_other_workspace` | The checkout's customer or subscription is already bound to a different workspace | A reused customer, or a support mistake. Treat as possible tampering until explained |
| `checkout_ownership_mismatch` | The checkout's customer or workspace does not match its subscription | Manual edits in the Stripe dashboard, or a tampered checkout |
| `identifiers_resolve_to_different_workspaces` | A subscription change names a customer bound to one workspace and a subscription bound to another | Inconsistent bindings, for example after a manual Stripe or database change |

For `workspace_has_other_subscription`:

1. In Stripe, open the checkout session from the event. Note its subscription
   and customer. A payment-link checkout usually creates a **new** customer.
2. Compare them with the workspace's bound `stripe_subscription_id` and
   `stripe_customer_id` from step 3 of triage. **The bound subscription is the
   one SlabPlan uses for access. Do not touch it.**
3. Confirm the new subscription is really a duplicate. Check that it is on the
   SlabPlan price, that it was paid, and that its created time is close to the
   bound one.

For the other three reasons, do not cancel or refund anything until the owner
has reviewed the cause. Never rebind a workspace by editing the
`organizations` table by hand. If a binding truly needs to change, that is a
reviewed code or owner decision.

## 3. Resolve a confirmed duplicate charge

This is a manual, authorized action by the Stripe account owner, or by someone
the owner explicitly delegates refund authority to.

1. **Contact the customer** through the workspace's normal billing or support
   contact. Confirm they intended only one subscription, and which one to keep.
   Normally they keep the bound subscription, which already grants access.
2. **Cancel the duplicate subscription immediately**, not at period end, in the
   Stripe dashboard. Before confirming, check that its id is the duplicate's
   id and **not** the workspace's bound `stripe_subscription_id`.
3. **Refund the duplicate's payment in full.** Use the refund option in the
   cancellation dialog, or open the duplicate's payment and choose Refund with
   reason "Duplicate". Confirm the refunded amount equals the full charge,
   including any tax. Dashboard labels can differ slightly; the checks that
   matter are the subscription id, the payment id, and the full amount.
4. **Change nothing else.** Leave the bound subscription, the workspace row,
   the payment link, the portal configuration, and account-wide settings
   unchanged.
5. **Verify**:
   - the workspace's billing status in SlabPlan still shows access through
     the bound subscription;
   - in Stripe, the duplicate is canceled and its payment shows as refunded;
   - no other subscription or payment changed.
6. **Record** in the restricted incident record:
   - the date;
   - the Stripe event id and reason code;
   - the duplicate subscription id and refund id;
   - who authorized the refund and when the customer was told.

   No card data and no customer contact details.

If the customer instead wants the new subscription and not the old one, do not
change bindings yourself. Escalate to the owner, because moving a workspace
between subscriptions needs a reviewed procedure.

## 4. If alerts were suppressed or failed

- **Suppressed:** list them with
  `select payload->>'eventId', payload->>'reason', updated_at from billing_events where provider = 'slabplan-alert' and type = 'billing.binding_conflict' and payload->>'delivery' = 'suppressed' order by updated_at desc;`.
  More than ten conflicts in an hour is unusual. Treat it as a possible
  incident: check for a misconfigured price, payment link or webhook, or for
  abuse. Follow `docs/incident-response-runbook.md`.
- **Failed:** check `payload->>'failure'`.
  - `unconfigured` means `SECURITY_ALERT_EMAIL` is missing or invalid.
  - `send_failed` means the SMTP provider rejected or timed out the send.

  Fix the configuration. Later Stripe retries of the same event try again, up
  to three send attempts per event. Until then, diagnose from the markers and
  the `security.billing_conflict` log lines.

## Scope

- Alerts are sent only for binding conflicts in signed, mode-matching Stripe
  events:
  - `checkout.session.completed` and `checkout.session.async_payment_succeeded`;
  - `customer.subscription.created`, `.updated` and `.deleted`.
- Unsigned or wrongly signed requests are rejected before any alert logic runs.
- A checkout that contains no configured SlabPlan price is refused with `409`
  but does not raise this alert. It is a configuration problem, reviewed
  separately.
- Alert markers live in `billing_events` under provider `slabplan-alert`, next
  to Stripe's own processed-event rows (provider `stripe`). A per-event marker
  has type `billing.binding_conflict`. Each send attempt has an insert-only row
  of type `billing.binding_conflict.send_attempt`.
