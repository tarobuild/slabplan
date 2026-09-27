# Billing Release Verification

Do not consider a returned checkout URL proof that paid onboarding works.
The application, Stripe account configuration, webhook delivery, and access
decisions must all be verified before opening paid self-service enrollment.

## Application Controls

- Signed webhooks must match the test/live mode of the configured API key.
- Checkout must be a completed subscription session for the configured price.
- Workspace references are provider metadata or an HMAC-protected reference.
- Customer and subscription bindings cannot be claimed by another workspace.
- Webhook IDs are processed transactionally once. Provider failures roll back
  processing and remain retryable.
- Subscription state is retrieved from Stripe under a database transaction
  lock. Delayed events cannot overwrite newer provider state or replace a
  workspace's newer subscription with an older one.
- Unrecognized prices revoke paid access rather than granting a plan based
  solely on metadata. An existing subscription must be managed in the portal
  instead of starting a second subscription from the application.
- Stored billing events retain identifiers and event timing, not full customer
  payloads. Historical payloads from older releases are not rewritten silently.

## Provider Checks

Verify the correct Taro Build Stripe account, live key, live active recurring
price, currency/amount/interval, webhook signing secret, and enabled delivery
endpoint. Never expose those secrets in screenshots, tickets, logs, or Git.
Required events are `checkout.session.completed` and
`customer.subscription.created`, `customer.subscription.updated`, and
`customer.subscription.deleted`. Subscribe to
`checkout.session.async_payment_succeeded` before enabling delayed methods.

An operator can read `/api/internal/billing-readiness` using the existing
`x-backup-secret` operational credential. It makes read-only Stripe API calls
using the deployment's own key and returns only readiness booleans. It checks
live mode, charges enabled, the expected active monthly price, the exact
canonical application webhook URL, and subscribed events. Missing credentials
or failed checks return 503; incorrect operational authentication returns 401.
Responses are not cacheable. This is configuration evidence only: it does not
prove that the stored signing secret matches Stripe or that payment succeeds.
Production checkout checks this configuration before returning a payment URL;
if the deployment cannot verify it, the customer receives a temporary
unavailability error instead of being sent to pay through an unverified setup.

## End-To-End Evidence

Use an isolated Stripe sandbox with matching test credentials and a TEST
workspace. Do not put test payment data into live checkout or charge a real
card to simulate a sandbox test.

1. Verify email and enroll MFA for a fresh workspace owner.
2. Complete sandbox checkout and confirm provider webhook delivery succeeds.
3. Confirm the correct workspace gains access and no other workspace changes.
4. Exercise decline/incomplete payment and confirm access remains denied.
5. Exercise cancellation, failed renewal, and recovery through the billing
   portal; confirm application access follows the current subscription state.
6. Replay a delivery and deliver an older update; confirm state and bindings
   stay correct. Confirm unknown prices do not grant paid access.
7. Check portal settings, receipts, tax handling, cancellation/refund terms,
   support contact, and business activation before enabling live purchases.

Automated local tests stub provider reads only inside the test process. They
verify application behavior but do not replace the provider/sandbox checks.
