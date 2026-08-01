import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { organizations } from "@workspace/db/schema";
import { HttpError } from "./http";

const ACCESS_GRANTING_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export type BillingAccessState = {
  requiresSubscription: boolean;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
};

export function hasBillingAccess(
  state: BillingAccessState,
  now = new Date(),
): boolean {
  if (!state.requiresSubscription) return true;
  if (
    state.subscriptionStatus &&
    ACCESS_GRANTING_SUBSCRIPTION_STATUSES.has(state.subscriptionStatus)
  ) {
    return true;
  }
  return Boolean(state.trialEndsAt && state.trialEndsAt.getTime() > now.getTime());
}

export async function loadOrganizationBillingAccess(
  organizationId: string,
): Promise<BillingAccessState | null> {
  const [organization] = await db
    .select({
      requiresSubscription: organizations.requiresSubscription,
      subscriptionStatus: organizations.subscriptionStatus,
      trialEndsAt: organizations.trialEndsAt,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, organizationId),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);

  return organization ?? null;
}

export async function assertOrganizationBillingAccess(
  organizationId: string,
): Promise<void> {
  const access = await loadOrganizationBillingAccess(organizationId);
  if (access && hasBillingAccess(access)) return;

  throw new HttpError(
    402,
    "A SlabPlan subscription is required to access this workspace.",
    { subscribeUrl: "/subscribe" },
    "subscription-required",
  );
}

export function requirePaidSubscription(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!req.auth) {
    next(new HttpError(401, "Authentication required.", undefined, "unauthorized"));
    return;
  }

  const organizationId = req.auth.organizationId;
  if (!organizationId) {
    next(
      new HttpError(
        402,
        "Choose a workspace and start a SlabPlan subscription to continue.",
        { subscribeUrl: "/subscribe" },
        "subscription-required",
      ),
    );
    return;
  }

  assertOrganizationBillingAccess(organizationId).then(() => next()).catch(next);
}
