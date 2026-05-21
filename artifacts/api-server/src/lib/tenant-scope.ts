import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { AuthContext } from "./authorization";
import { HttpError } from "./http";

export function getActiveOrganizationId(auth: AuthContext): string {
  if (!auth.organizationId) {
    throw new HttpError(
      403,
      "An active organization is required.",
      undefined,
      "organization-required",
    );
  }

  return auth.organizationId;
}

export function organizationScopeCondition(
  auth: AuthContext,
  organizationColumn: PgColumn,
): SQL {
  const organizationId = getActiveOrganizationId(auth);

  return eq(organizationColumn, organizationId);
}
