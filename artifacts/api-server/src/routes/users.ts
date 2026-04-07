import bcrypt from "bcrypt";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { toPublicUser } from "../lib/auth";
import { HttpError, asyncHandler } from "../lib/http";

const router: IRouter = Router();

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  avatarUrl: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

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

    const body = updateProfileSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid profile payload.", body.error.flatten());
    }

    const email = body.data.email?.toLowerCase() ?? user.email;

    if (email !== user.email) {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ne(users.id, user.id), isNull(users.deletedAt)))
        .limit(1);

      if (existing) {
        throw new HttpError(409, "That email address is already in use.");
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        fullName: body.data.fullName ?? user.fullName,
        email,
        phone: body.data.phone ?? user.phone,
        avatarUrl: body.data.avatarUrl ?? user.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    res.json({ user: toPublicUser(updated) });
  }),
);

router.post(
  "/me/password",
  asyncHandler(async (req, res) => {
    const user = await findActiveUserById(req.auth.userId);

    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    const body = changePasswordSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, body.error.errors[0]?.message ?? "Invalid password payload.");
    }

    const isValid = await bcrypt.compare(body.data.currentPassword, user.passwordHash);

    if (!isValid) {
      throw new HttpError(400, "Current password is incorrect.");
    }

    const passwordHash = await bcrypt.hash(body.data.newPassword, 10);

    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    res.json({ success: true });
  }),
);

export default router;
