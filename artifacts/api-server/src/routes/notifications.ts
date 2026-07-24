import { and, count, desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { notifications, users } from "@workspace/db/schema";
import { HttpError, asyncHandler } from "../lib/http";
import { getActiveOrganizationId } from "../lib/tenant-scope";

const router: IRouter = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  unreadOnly: z.coerce.boolean().optional().default(false),
});

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new HttpError(400, "Invalid notifications query.", query.error.flatten());
    }

    const currentUserId = req.auth!.userId;
    const organizationId = getActiveOrganizationId(req.auth!);
    if (!organizationId) {
      throw new HttpError(400, "An active organization is required.");
    }
    const baseConditions = [
      eq(notifications.organizationId, organizationId),
      eq(notifications.recipientUserId, currentUserId),
    ];
    if (query.data.unreadOnly) {
      baseConditions.push(isNull(notifications.readAt));
    }

    const [rows, unreadRows] = await Promise.all([
      db
        .select({
          id: notifications.id,
          entityType: notifications.entityType,
          entityId: notifications.entityId,
          action: notifications.action,
          title: notifications.title,
          body: notifications.body,
          url: notifications.url,
          metadata: notifications.metadata,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
          actor: {
            id: users.id,
            fullName: users.fullName,
            email: users.email,
          },
        })
        .from(notifications)
        .leftJoin(users, eq(notifications.actorUserId, users.id))
        .where(and(...baseConditions)!)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(query.data.limit),
      db
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, currentUserId),
            eq(notifications.organizationId, organizationId),
            isNull(notifications.readAt),
          ),
        ),
    ]);

    res.json({
      notifications: rows,
      unreadCount: unreadRows[0]?.value ?? 0,
    });
  }),
);

router.patch(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const notificationId = getParam(req.params.id, "notification id");
    const currentUserId = req.auth!.userId;
    const organizationId = getActiveOrganizationId(req.auth!);
    if (!organizationId) {
      throw new HttpError(400, "An active organization is required.");
    }
    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.organizationId, organizationId),
          eq(notifications.recipientUserId, currentUserId),
        ),
      )
      .returning({
        id: notifications.id,
        readAt: notifications.readAt,
      });

    if (!updated) {
      throw new HttpError(404, "Notification not found.");
    }

    res.json({ notification: updated });
  }),
);

router.post(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    const currentUserId = req.auth!.userId;
    const organizationId = getActiveOrganizationId(req.auth!);
    if (!organizationId) {
      throw new HttpError(400, "An active organization is required.");
    }
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientUserId, currentUserId),
          eq(notifications.organizationId, organizationId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });

    res.json({ success: true, count: updated.length });
  }),
);

export default router;
