import { and, eq, exists, isNull, ne, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { scheduleItemAssignees, scheduleItems } from "@workspace/db/schema";
import { isAdmin, type AuthContext } from "./authorization";

// Mirrors the schedule item visibility contract used by direct schedule routes.
export function buildScheduleListVisibilityFilter(auth: AuthContext) {
  const userId = auth.userId;

  const personalTodoFilter = or(
    eq(scheduleItems.isPersonalTodo, false),
    isNull(scheduleItems.isPersonalTodo),
    eq(scheduleItems.createdBy, userId),
  );

  if (isAdmin(auth)) {
    return personalTodoFilter;
  }

  const assignedToCurrentUser = exists(
    db
      .select({ marker: scheduleItemAssignees.id })
      .from(scheduleItemAssignees)
      .where(
        and(
          eq(scheduleItemAssignees.scheduleItemId, scheduleItems.id),
          eq(scheduleItemAssignees.userId, userId),
        ),
      ),
  );

  const roleVisibility =
    auth.role === "project_manager"
      ? or(
          ne(scheduleItems.visibleToOfficeStaff, false),
          isNull(scheduleItems.visibleToOfficeStaff),
          ne(scheduleItems.visibleToEstimators, false),
          isNull(scheduleItems.visibleToEstimators),
        )
      : or(
          ne(scheduleItems.visibleToInstallers, false),
          isNull(scheduleItems.visibleToInstallers),
        );

  return and(
    personalTodoFilter,
    or(
      eq(scheduleItems.createdBy, userId),
      assignedToCurrentUser,
      roleVisibility,
    ),
  );
}
