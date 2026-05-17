import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { AuthContext } from "./authorization";

export function getActiveOrganizationId(auth: AuthContext): string | null {
  return auth.organizationId ?? null;
}

export function organizationScopeCondition(
  auth: AuthContext,
  organizationColumn: PgColumn,
): SQL | undefined {
  const organizationId = getActiveOrganizationId(auth);
  return organizationId ? eq(organizationColumn, organizationId) : undefined;
}
