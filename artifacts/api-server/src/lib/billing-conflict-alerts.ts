import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { billingEvents } from "@workspace/db/schema";
import { sendBillingConflictAlertEmail } from "./email";
import { HttpError } from "./http";
import { logger } from "./logger";

/**
 * Operator alert for a signed Stripe event that the webhook refuses to bind
 * because its customer or subscription conflicts with an existing workspace
 * binding, for example a second paid subscription from a duplicate checkout.
 *
 * Failure semantics and bounds:
 * - The webhook still answers 409 and rolls back, so no workspace changes and
 *   Stripe keeps retrying on its normal schedule. The alert runs only after
 *   that rollback, only for an event that passed signature and mode checks,
 *   and it never throws or changes the response.
 * - A marker row per Stripe event in billing_events, under provider
 *   "slabplan-alert" (Stripe events use "stripe"), records the alert state.
 *   A confirmed email is not sent again for that event. An unconfirmed one
 *   (send error, timeout, or a lost settlement) may be retried on a later
 *   delivery of the event, at most three send attempts per event. Because
 *   an SMTP error or timeout does not prove the message was not accepted,
 *   the operator can receive the same alert more than once, never more than
 *   three times per event.
 * - Every send attempt first inserts its own insert-only attempt row under a
 *   cross-instance lock, and a new attempt is allowed only while fewer than
 *   ten attempt rows exist from the last hour of database time. Attempts
 *   count whatever their outcome, so no rolling hour can hold more than ten
 *   alert email sends. Above that the marker records "suppressed" and a
 *   later delivery may still send once the hour allows.
 * - The webhook response waits at most a few seconds for the alert.
 * - Emails and logs carry only the Stripe event id and type, a fixed reason
 *   code and the mode. Workspace ids stay in the private marker row.
 *   Provider, SMTP and database error text is never recorded.
 */

const conflictDescriptions = {
  checkout_ownership_mismatch:
    "The checkout's customer or workspace does not match its subscription.",
  identifiers_bound_to_other_workspace:
    "The customer or subscription is already bound to another workspace.",
  workspace_has_other_subscription:
    "The workspace already has another subscription that is not canceled, so this may be a duplicate charge.",
  identifiers_resolve_to_different_workspaces:
    "The customer and the subscription resolve to different workspaces.",
} as const;

export type BillingConflictReason = keyof typeof conflictDescriptions;

/**
 * A 409 for a Stripe binding conflict. The response is identical to the
 * plain HttpError it replaces; the reason and workspace ids exist only for
 * the operator alert and are never serialized into the response.
 */
export class BillingBindingConflictError extends HttpError {
  readonly reason: BillingConflictReason;
  readonly organizationIds: readonly string[];

  constructor(
    reason: BillingConflictReason,
    message: string,
    options: {
      organizationIds: ReadonlyArray<string | null | undefined>;
      details?: unknown;
      type?: string;
    },
  ) {
    super(409, message, options.details, options.type);
    this.reason = reason;
    this.organizationIds = [
      ...new Set(
        options.organizationIds.filter((id): id is string => Boolean(id)),
      ),
    ];
  }
}

type StripeEventRef = { id: string; type: string; livemode: boolean };
type AlertDelivery = "claimed" | "sent" | "failed" | "suppressed";
type AlertFailure = "unconfigured" | "send_failed";
type AlertMarker = {
  eventId: string;
  eventType: string;
  reason: BillingConflictReason;
  livemode: boolean;
  organizationIds: string[];
  delivery: AlertDelivery;
  sendAttempts: number;
  failure?: AlertFailure;
};
type Claim =
  | { action: "send"; marker: AlertMarker }
  | { action: "suppressed" }
  | { action: "unconfigured" }
  | { action: "already_handled" };

const ALERT_PROVIDER = "slabplan-alert";
const ALERT_TYPE = "billing.binding_conflict";
const ALERT_ATTEMPT_TYPE = "billing.binding_conflict.send_attempt";
const MAX_SEND_ATTEMPTS = 3;
const DEFAULT_MAX_EMAILS_PER_HOUR = 10;
const DEFAULT_DELIVERY_WAIT_MS = 5_000;
const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9_-]{1,200}$/;
const STRIPE_EVENT_TYPE = /^[a-z_]+(?:\.[a-z_]+){1,4}$/;

let maxEmailsPerHour = DEFAULT_MAX_EMAILS_PER_HOUR;
let deliveryWaitMs = DEFAULT_DELIVERY_WAIT_MS;

/** Test-only overrides. **Never call this from production code.** */
export function __setBillingConflictAlertLimitsForTests(
  overrides: { maxEmailsPerHour?: number; deliveryWaitMs?: number } | null,
) {
  maxEmailsPerHour = overrides?.maxEmailsPerHour ?? DEFAULT_MAX_EMAILS_PER_HOUR;
  deliveryWaitMs = overrides?.deliveryWaitMs ?? DEFAULT_DELIVERY_WAIT_MS;
}

export function billingConflictAlertMarkerId(eventId: string) {
  return `${ALERT_PROVIDER}:binding-conflict:${eventId}`;
}

function sendAttemptId(eventId: string, attempt: number) {
  return `${billingConflictAlertMarkerId(eventId)}:send-attempt:${attempt}`;
}

/** Every billing_events row the alert can write for one Stripe event. */
export function billingConflictAlertRowIds(eventId: string) {
  return [
    billingConflictAlertMarkerId(eventId),
    ...Array.from({ length: MAX_SEND_ATTEMPTS }, (_, index) =>
      sendAttemptId(eventId, index + 1),
    ),
  ];
}

function alertRecipient(): string | null {
  const recipient = process.env.SECURITY_ALERT_EMAIL?.trim();
  return recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    ? recipient
    : null;
}

async function claimAlert(
  alert: Omit<AlertMarker, "delivery" | "sendAttempts" | "failure">,
  canSend: boolean,
): Promise<Claim> {
  const markerId = billingConflictAlertMarkerId(alert.eventId);
  return db.transaction(async (tx): Promise<Claim> => {
    // One lock for every alert claim keeps the per-event state and the
    // hourly send budget consistent across autoscale instances. Times come
    // from the database clock, never an instance clock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('slabplan-billing-conflict-alerts'))`,
    );
    const [existing] = await tx
      .select({
        payload: billingEvents.payload,
        leaseExpired: sql<boolean>`${billingEvents.updatedAt} < now() - interval '5 minutes'`,
      })
      .from(billingEvents)
      .where(
        and(
          eq(billingEvents.id, markerId),
          eq(billingEvents.provider, ALERT_PROVIDER),
        ),
      )
      .limit(1);
    const previous = existing?.payload as Partial<AlertMarker> | undefined;
    const sendAttempts = Number(previous?.sendAttempts) || 0;
    if (existing) {
      // A claim whose instance stopped mid-send is retried after its lease.
      const retryable =
        previous?.delivery === "failed" ||
        previous?.delivery === "suppressed" ||
        (previous?.delivery === "claimed" && existing.leaseExpired);
      if (!retryable || sendAttempts >= MAX_SEND_ATTEMPTS)
        return { action: "already_handled" };
    }

    let delivery: AlertDelivery = "failed";
    if (canSend) {
      const [lastHour] = await tx
        .select({ attempts: sql<number>`count(*)::int` })
        .from(billingEvents)
        .where(
          and(
            eq(billingEvents.provider, ALERT_PROVIDER),
            eq(billingEvents.type, ALERT_ATTEMPT_TYPE),
            gte(billingEvents.createdAt, sql`now() - interval '1 hour'`),
          ),
        );
      delivery =
        (lastHour?.attempts ?? 0) >= maxEmailsPerHour ? "suppressed" : "claimed";
    }
    const marker: AlertMarker = {
      ...alert,
      delivery,
      sendAttempts: delivery === "claimed" ? sendAttempts + 1 : sendAttempts,
      ...(canSend ? {} : { failure: "unconfigured" as const }),
    };
    if (existing) {
      await tx
        .update(billingEvents)
        .set({ payload: marker, updatedAt: sql`now()` })
        .where(eq(billingEvents.id, markerId));
    } else {
      await tx.insert(billingEvents).values({
        id: markerId,
        provider: ALERT_PROVIDER,
        type: ALERT_TYPE,
        livemode: alert.livemode,
        payload: marker,
      });
    }
    if (delivery === "suppressed") return { action: "suppressed" };
    if (delivery !== "claimed") return { action: "unconfigured" };
    // The attempt is spent before the email is sent and is never updated or
    // released, whatever the outcome.
    await tx.insert(billingEvents).values({
      id: sendAttemptId(alert.eventId, marker.sendAttempts),
      provider: ALERT_PROVIDER,
      type: ALERT_ATTEMPT_TYPE,
      livemode: alert.livemode,
      payload: { eventId: alert.eventId, sendAttempt: marker.sendAttempts },
    });
    return { action: "send", marker };
  });
}

async function recordDelivery(
  marker: AlertMarker,
  delivery: "sent" | "failed",
  failure?: AlertFailure,
) {
  const next: AlertMarker = { ...marker, delivery, ...(failure ? { failure } : {}) };
  // Only the claim that sent the email may settle it.
  await db
    .update(billingEvents)
    .set({ payload: next, updatedAt: sql`now()` })
    .where(
      and(
        eq(billingEvents.id, billingConflictAlertMarkerId(marker.eventId)),
        sql`${billingEvents.payload}->>'delivery' = 'claimed'`,
        sql`(${billingEvents.payload}->>'sendAttempts')::int = ${marker.sendAttempts}`,
      ),
    );
}

async function deliverAlert(
  event: StripeEventRef,
  conflict: BillingBindingConflictError,
): Promise<void> {
  const eventId = STRIPE_EVENT_ID.test(event.id) ? event.id : null;
  const eventType = STRIPE_EVENT_TYPE.test(event.type) ? event.type : "unrecognized";
  const context = {
    event: "security.billing_conflict",
    stripeEventId: eventId,
    stripeEventType: eventType,
    reason: conflict.reason,
    livemode: event.livemode,
  };
  if (!eventId) {
    logger.error(
      { ...context, delivery: "skipped" },
      "Billing binding conflict: alert skipped for an unrecognized event id",
    );
    return;
  }

  const recipient = alertRecipient();
  let claim: Claim;
  try {
    claim = await claimAlert(
      {
        eventId,
        eventType,
        reason: conflict.reason,
        livemode: event.livemode,
        organizationIds: [...conflict.organizationIds],
      },
      Boolean(recipient),
    );
  } catch {
    // Database error text can quote query parameters, so only a fixed stage
    // is logged. A later Stripe retry of this event claims again.
    logger.error(
      { ...context, delivery: "error", stage: "claim" },
      "Billing binding conflict: alert could not be recorded",
    );
    return;
  }

  if (claim.action === "already_handled") {
    logger.warn(
      { ...context, delivery: "already_handled" },
      "Billing binding conflict: repeated delivery, alert already handled",
    );
    return;
  }
  if (claim.action === "suppressed") {
    logger.error(
      { ...context, delivery: "suppressed" },
      "Billing binding conflict: hourly alert email limit reached",
    );
    return;
  }
  if (claim.action === "unconfigured" || !recipient) {
    logger.error(
      { ...context, delivery: "failed", failure: "unconfigured" },
      "Billing binding conflict: SECURITY_ALERT_EMAIL is not configured",
    );
    return;
  }

  let failure: AlertFailure | undefined;
  try {
    await sendBillingConflictAlertEmail(recipient, {
      eventId,
      eventType,
      reason: conflict.reason,
      reasonDescription: conflictDescriptions[conflict.reason],
      livemode: event.livemode,
      dashboardUrl: `https://dashboard.stripe.com/${event.livemode ? "" : "test/"}events/${eventId}`,
    });
  } catch {
    // SMTP errors can echo addresses; record only the fixed failure code.
    failure = "send_failed";
  }

  try {
    await recordDelivery(claim.marker, failure ? "failed" : "sent", failure);
  } catch {
    logger.error(
      { ...context, delivery: "error", stage: "record" },
      "Billing binding conflict: alert outcome could not be recorded",
    );
  }
  if (failure) {
    logger.error(
      { ...context, delivery: "failed", failure, sendAttempt: claim.marker.sendAttempts },
      "Billing binding conflict: operator alert email failed",
    );
  } else {
    logger.warn(
      { ...context, delivery: "sent", sendAttempt: claim.marker.sendAttempts },
      "Billing binding conflict: operator alert email sent",
    );
  }
}

/**
 * Alert the operator about a verified Stripe event that hit a binding
 * conflict. Never throws, and waits at most a few seconds; a slower email
 * finishes in the background and still settles the marker.
 */
export async function alertBillingBindingConflict(
  event: StripeEventRef,
  conflict: BillingBindingConflictError,
): Promise<void> {
  let settled = false;
  const delivery = deliverAlert(event, conflict)
    .catch(() => {
      logger.error(
        { event: "security.billing_conflict", reason: conflict.reason, delivery: "error", stage: "unexpected" },
        "Billing binding conflict: alert failed unexpectedly",
      );
    })
    .finally(() => {
      settled = true;
    });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deliveryWaitMs);
    timer.unref();
  });
  try {
    await Promise.race([delivery, timeout]);
  } finally {
    clearTimeout(timer);
  }
  if (!settled) {
    logger.warn(
      { event: "security.billing_conflict", reason: conflict.reason, delivery: "pending" },
      "Billing binding conflict: alert still being delivered after the webhook response",
    );
  }
}
