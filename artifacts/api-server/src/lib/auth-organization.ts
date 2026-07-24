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
const LEGACY_TEST_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

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
    // The imported CAD regression suites predate organizations and seed users
    // and business rows directly. The guarded local test-database setup gives
    // those rows one dedicated tenant default; attach its membership lazily so
    // production never receives a tenant bypass and tenant-aware tests can
    // continue using their explicit organizations.
    if (
      process.env.NODE_ENV === "test" &&
      user.defaultOrganizationId === LEGACY_TEST_ORGANIZATION_ID
    ) {
      const legacyUsers = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(
          and(
            eq(users.defaultOrganizationId, LEGACY_TEST_ORGANIZATION_ID),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        );

      await db
        .insert(organizationMemberships)
        .values(
          legacyUsers.map((legacyUser) => ({
            organizationId: LEGACY_TEST_ORGANIZATION_ID,
            userId: legacyUser.id,
            role: legacyUser.role,
            isDefault: true,
          })),
        )
        .onConflictDoNothing();

      const [membership] = await db
        .select({
          id: organizationMemberships.id,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, LEGACY_TEST_ORGANIZATION_ID),
            eq(organizationMemberships.userId, userId),
            isNull(organizationMemberships.deletedAt),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new HttpError(500, "Failed to provision the local test tenant.");
      }

      return {
        organizationId: LEGACY_TEST_ORGANIZATION_ID,
        organizationRole: membership.role,
        organizationMembershipId: membership.id,
        organizationStatus: "active",
      };
    }

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
