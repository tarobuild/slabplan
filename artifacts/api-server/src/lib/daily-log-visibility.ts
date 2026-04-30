import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { dailyLogs } from "@workspace/db/schema";
import { isAdmin, type AuthContext } from "./authorization";

export function buildDailyLogVisibilityFilter(auth: AuthContext) {
  if (isAdmin(auth)) {
    return undefined;
  }

  return or(
    eq(dailyLogs.createdBy, auth.userId),
    and(
      isNotNull(dailyLogs.publishedAt),
      or(eq(dailyLogs.isPrivate, false), isNull(dailyLogs.isPrivate)),
      or(ne(dailyLogs.shareInternalUsers, false), isNull(dailyLogs.shareInternalUsers)),
    ),
  );
}
