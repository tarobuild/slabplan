import { and, asc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { toPublicUser } from "../lib/auth";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

async function findActiveUserById(id: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);

  return user ?? null;
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select()
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(asc(users.fullName));

    res.json({
      users: rows.map(toPublicUser),
    });
  }),
);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await findActiveUserById(req.auth.userId);

    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    res.json({ user: toPublicUser(user) });
  }),
);

router.put(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await findActiveUserById(req.auth.userId);

    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    const fullName =
      typeof req.body.fullName === "string" && req.body.fullName.trim().length >= 2
        ? req.body.fullName.trim()
        : user.fullName;
    const phone =
      typeof req.body.phone === "string" ? req.body.phone.trim() || null : user.phone;
    const avatarUrl =
      typeof req.body.avatarUrl === "string"
        ? req.body.avatarUrl.trim() || null
        : user.avatarUrl;

    const [updated] = await db
      .update(users)
      .set({
        fullName,
        phone,
        avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    res.json({ user: toPublicUser(updated) });
  }),
);

export default router;
