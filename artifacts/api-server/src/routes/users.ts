import bcrypt from "bcrypt";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { safeUserColumns, users } from "@workspace/db/schema";
import { toPublicUser } from "../lib/auth";
import { HttpError, asyncHandler } from "../lib/http";
import { requireManagerOrAbove } from "../middleware/require-auth";

const router: IRouter = Router();

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  currentPassword: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
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

const userListQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(200).optional().default(100),
    offset: z.coerce.number().int().min(0).optional(),
    page: z.coerce.number().int().positive().optional(),
    roles: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => {
        if (!value) {
          return [];
        }

        const items = Array.isArray(value)
          ? value.flatMap((item) => item.split(","))
          : value.split(",");

        return items
          .map((item) => item.trim())
          .filter((item): item is "admin" | "project_manager" | "crew_member" =>
            item === "admin" || item === "project_manager" || item === "crew_member",
          );
      }),
  })
  .superRefine((value, ctx) => {
    if (value.page !== undefined && value.offset !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either page or offset, not both.",
        path: ["page"],
      });
    }
  });

async function findActiveUserById(id: string) {
  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);

  return user ?? null;
}

async function findActiveUserWithPasswordHash(id: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);

  return user ?? null;
}

router.get(
  "/",
  requireManagerOrAbove,
  asyncHandler(async (req, res) => {
    const query = userListQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw new HttpError(400, "Invalid user list query.", query.error.flatten());
    }

    const limit = query.data.limit;
    const page = query.data.page ?? (query.data.offset !== undefined ? Math.floor(query.data.offset / limit) + 1 : 1);
    const offset = query.data.offset ?? (page - 1) * limit;

    const [[totalRow], rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            query.data.roles.length > 0 ? inArray(users.role, query.data.roles) : undefined,
          ),
        ),
      db
        .select(safeUserColumns)
        .from(users)
        .where(
          and(
            isNull(users.deletedAt),
            query.data.roles.length > 0 ? inArray(users.role, query.data.roles) : undefined,
          ),
        )
        .orderBy(asc(users.fullName))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(totalRow?.total ?? 0);
    const publicUsers = rows.map(toPublicUser);

    res.json({
      data: publicUsers,
      users: publicUsers,
      pagination: {
        page,
        limit,
        offset,
        total,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }),
);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await findActiveUserById(req.auth!.userId);

    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    res.json({ user: toPublicUser(user) });
  }),
);

router.put(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await findActiveUserWithPasswordHash(req.auth!.userId);

    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    const body = updateProfileSchema.safeParse(req.body);

    if (!body.success) {
      throw new HttpError(400, "Invalid profile payload.", body.error.flatten());
    }

    const email = body.data.email?.toLowerCase() ?? user.email;

    if (email !== user.email) {
      if (!body.data.currentPassword) {
        throw new HttpError(400, "Current password is required to change your email.");
      }

      const isValid = await bcrypt.compare(body.data.currentPassword, user.passwordHash);

      if (!isValid) {
        throw new HttpError(400, "Current password is incorrect.");
      }

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
    const user = await findActiveUserWithPasswordHash(req.auth!.userId);

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
