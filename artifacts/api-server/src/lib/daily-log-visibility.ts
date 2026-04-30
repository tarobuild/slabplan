import { and, eq, isNull, ne, or } from "drizzle-orm";
import { dailyLogs } from "@workspace/db/schema";
import { isAdmin, type AuthContext } from "./authorization";

export function canViewDailyLogSummary(
  auth: AuthContext,
  row: {
    createdBy: string | null;
    isPrivate: boolean | null;
    shareInternalUsers: boolean | null;
  },
) {
  if (isAdmin(auth) || row.createdBy === auth.userId) {
    return true;
  }

  return !row.isPrivate && row.shareInternalUsers !== false;
}

export function buildDailyLogVisibilityFilter(auth: AuthContext) {
  if (isAdmin(auth)) {
    return undefined;
  }

  return or(
    eq(dailyLogs.createdBy, auth.userId),
    and(
      or(eq(dailyLogs.isPrivate, false), isNull(dailyLogs.isPrivate)),
      or(ne(dailyLogs.shareInternalUsers, false), isNull(dailyLogs.shareInternalUsers)),
    ),
  );
}
