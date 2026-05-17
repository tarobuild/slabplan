import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  organizationMemberships,
  organizations,
  users,
} from "@workspace/db/schema";
import { HttpError } from "./http";

export type OrganizationAuthContext = {
  organizationId: string;
  organizationRole: string;
  organizationMembershipId: string;
  organizationStatus: string;
};

type AuthWithOptionalOrganization = {
  userId: string;
  organizationId?: string;
};

const allowedAuthOrganizationStatuses = new Set(["active", "trialing"]);

export async function resolveOrganizationContextForUser(
  userId: string,
  requestedOrganizationId?: string | null,
): Promise<OrganizationAuthContext | null> {
  const [user] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw new HttpError(401, "Authentication required.", undefined, "unauthorized");
  }

  const memberships = await db
    .select({
      id: organizationMemberships.id,
      organizationId: organizationMemberships.organizationId,
      organizationRole: organizationMemberships.role,
      isDefault: organizationMemberships.isDefault,
      organizationStatus: organizations.status,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        isNull(organizationMemberships.deletedAt),
        isNull(organizations.deletedAt),
      ),
    );

  if (memberships.length === 0) {
    if (requestedOrganizationId) {
      throw new HttpError(
        403,
        "You do not have access to this organization.",
        undefined,
        "forbidden",
      );
    }
    return null;
  }

  const selectedOrganizationId = requestedOrganizationId ?? user.defaultOrganizationId;
  const selected =
    (selectedOrganizationId
      ? memberships.find((membership) => membership.organizationId === selectedOrganizationId)
      : null) ??
    memberships.find((membership) => membership.isDefault) ??
    memberships[0] ??
    null;

  if (!selected) {
    return null;
  }

  if (requestedOrganizationId && selected.organizationId !== requestedOrganizationId) {
    throw new HttpError(
      403,
      "You do not have access to this organization.",
      undefined,
      "forbidden",
    );
  }

  if (!allowedAuthOrganizationStatuses.has(selected.organizationStatus)) {
    throw new HttpError(
      403,
      "This organization is not active.",
      undefined,
      "organization-inactive",
    );
  }

  return {
    organizationId: selected.organizationId,
    organizationRole: selected.organizationRole,
    organizationMembershipId: selected.id,
    organizationStatus: selected.organizationStatus,
  };
}

export async function attachOrganizationContext<TAuth extends AuthWithOptionalOrganization>(
  auth: TAuth,
): Promise<TAuth & Partial<OrganizationAuthContext>> {
  const organization = await resolveOrganizationContextForUser(
    auth.userId,
    auth.organizationId,
  );

  return organization ? { ...auth, ...organization } : auth as TAuth & Partial<OrganizationAuthContext>;
}
