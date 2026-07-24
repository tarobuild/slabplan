import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  notifications,
  organizationMemberships,
  users,
} from "@workspace/db/schema";
import { logger } from "./logger";

export type NotificationInput = {
  organizationId: string;
  recipientUserIds: string[];
  actorUserId: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  title: string;
  body?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function createUserNotifications(input: NotificationInput) {
  const uniqueRecipientIds = Array.from(new Set(input.recipientUserIds)).filter(Boolean);
  if (uniqueRecipientIds.length === 0) {
    return [];
  }

  const activeRecipients = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      organizationMemberships,
      eq(organizationMemberships.userId, users.id),
    )
    .where(
      and(
        inArray(users.id, uniqueRecipientIds),
        eq(organizationMemberships.organizationId, input.organizationId),
        isNull(organizationMemberships.deletedAt),
        eq(users.isActive, true),
        isNull(users.deletedAt),
      ),
    );

  if (activeRecipients.length === 0) {
    return [];
  }

  const rows = activeRecipients.map((recipient) => ({
    organizationId: input.organizationId,
    recipientUserId: recipient.id,
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    metadata: input.metadata ?? null,
  }));

  const created = await db.insert(notifications).values(rows).returning({
    id: notifications.id,
    recipientUserId: notifications.recipientUserId,
    entityType: notifications.entityType,
    entityId: notifications.entityId,
    action: notifications.action,
    title: notifications.title,
    body: notifications.body,
    url: notifications.url,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
  });

  logger.info(
    {
      count: created.length,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
    },
    "Notifications created",
  );

  return created;
}

export async function createUserNotificationsBestEffort(input: NotificationInput) {
  try {
    return await createUserNotifications(input);
  } catch (error) {
    logger.warn(
      {
        err: error,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        action: input.action,
      },
      "Failed to create notifications",
    );
    return [];
  }
}
