import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { organizationMemberships, users } from "@workspace/db/schema";
import { HttpError } from "./http";

export async function ensureAssignableJobAssigneeIds(
  userIds: string[],
  organizationId?: string | null,
) {
  const uniqueUserIds = Array.from(new Set(userIds));

  if (uniqueUserIds.length === 0) {
    return [];
  }

  const rows = organizationId
    ? await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(
          organizationMemberships,
          eq(organizationMemberships.userId, users.id),
        )
        .where(
          and(
            inArray(users.id, uniqueUserIds),
            inArray(organizationMemberships.role, [
              "project_manager",
              "crew_member",
              "drafter",
            ]),
            eq(organizationMemberships.organizationId, organizationId),
            eq(users.isActive, true),
            isNull(organizationMemberships.deletedAt),
            isNull(users.deletedAt),
          ),
        )
    : await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, uniqueUserIds),
            inArray(users.role, ["project_manager", "crew_member", "drafter"]),
            eq(users.isActive, true),
            isNull(users.deletedAt),
          ),
        );

  if (rows.length !== uniqueUserIds.length) {
    throw new HttpError(400, "One or more assignees are invalid.");
  }

  return uniqueUserIds;
}
