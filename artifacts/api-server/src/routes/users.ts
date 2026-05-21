import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  organizationMemberships,
  personalAccessTokens,
  safeUserColumns,
  userRoles,
  users,
  type User,
} from "@workspace/db/schema";
import { sendAuthResponse, toPublicUser } from "../lib/auth";
import { sendInvite, sendPasswordReset, truncateEmailError } from "../lib/email";
import { writeActivity } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { getActiveOrganizationId } from "../lib/tenant-scope";
import {
  requireAdmin,
  requireManagerOrAbove,
} from "../middleware/require-auth";

const router: IRouter = Router();

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashInviteToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function buildInvitePath(token: string) {
  return `/accept-invite?token=${encodeURIComponent(token)}`;
}

// Resolve an absolute URL for the invitee. Production sets APP_PUBLIC_URL
// (e.g. https://app.stonetrack.example) to the canonical host; in dev we
// fall back to the REPLIT_DEV_DOMAIN proxy host. We always return a URL
// with an `https://` scheme so the email is clickable from any client —
// if neither env var is set we throw, because emailing a relative path
// would silently produce a broken link.
function buildInviteUrl(token: string): string {
  const path = buildInvitePath(token);
  const explicit = process.env.APP_PUBLIC_URL?.trim();
  if (explicit) {
    const normalised = /^https?:\/\//i.test(explicit)
      ? explicit
      : `https://${explicit}`;
    return `${normalised.replace(/\/$/, "")}${path}`;
  }
  const replit = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (replit) {
    return `https://${replit.replace(/^https?:\/\//i, "").replace(/\/$/, "")}${path}`;
  }
  throw new HttpError(
    500,
    "Cannot build an invite URL: neither APP_PUBLIC_URL nor REPLIT_DEV_DOMAIN is configured.",
  );
}

type InviteEmailOutcome = {
  emailed: boolean;
  emailError: string | null;
  lastInviteEmailSentAt: string | null;
};

async function resolveInviterName(userId: string): Promise<string> {
  const [row] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.fullName?.trim() || "An administrator";
}

async function deliverInviteEmail(params: {
  userId: string;
  to: string;
  fullName: string;
  inviterName: string;
  inviteToken: string;
  inviteUrl?: string;
  /**
   * When true, the user already has a password set — this is an admin-driven
   * forced password reset, not a first-time invite. We still mint and store
   * a single-use invite token (the `accept-invite` route handles password
   * setting either way) but the email body is reworded accordingly via
   * `sendPasswordReset`.
   */
  isPasswordReset: boolean;
}): Promise<InviteEmailOutcome> {
  const inviteLink = params.inviteUrl ?? buildInviteUrl(params.inviteToken);
  const now = new Date();
  try {
    if (params.isPasswordReset) {
      await sendPasswordReset({ to: params.to, resetLink: inviteLink });
    } else {
      await sendInvite({
        to: params.to,
        inviteLink,
        inviterName: params.inviterName,
        inviteeName: params.fullName,
      });
    }
    await db
      .update(users)
      .set({
        lastInviteEmailSentAt: now,
        lastInviteEmailError: null,
        updatedAt: now,
      })
      .where(eq(users.id, params.userId));
    return {
      emailed: true,
      emailError: null,
      lastInviteEmailSentAt: now.toISOString(),
    };
  } catch (err) {
    const message = truncateEmailError(
      (err as Error)?.message ?? "Unknown email error.",
    );
    // Clear any stale `lastInviteEmailSentAt` from a previous successful
    // delivery — the *current* invite token has not been emailed, and the
    // UI must show the failure rather than a misleading old timestamp.
    await db
      .update(users)
      .set({
        lastInviteEmailSentAt: null,
        lastInviteEmailError: message,
        updatedAt: now,
      })
      .where(eq(users.id, params.userId))
      .catch(() => {});
    return { emailed: false, emailError: message, lastInviteEmailSentAt: null };
  }
}

function generateInvite() {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

async function generatePlaceholderPasswordHash() {
  const random = crypto.randomBytes(32).toString("base64url");
  return bcrypt.hash(random, 10);
}

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

const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  fullName: z.string().trim().min(2).max(255),
  role: z.enum(userRoles),
});

const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(255).optional(),
    role: z.enum(userRoles).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.role !== undefined ||
      value.isActive !== undefined,
    { message: "At least one field is required." },
  );

const userListQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(200).optional().default(100),
    offset: z.coerce.number().int().min(0).optional(),
    page: z.coerce.number().int().positive().optional(),
    includeInactive: z
      .union([z.string(), z.boolean()])
      .optional()
      .transform((value) => {
        if (typeof value === "boolean") return value;
        if (typeof value !== "string") return false;
        return value.toLowerCase() === "true" || value === "1";
      }),
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

function organizationRoleFromUserRole(role: string) {
  return role === "admin" ? "admin" : role;
}

async function findActiveUserInOrganization(id: string, organizationId: string | null) {
  if (!organizationId) {
    return findActiveUserWithPasswordHash(id);
  }

  const [row] = await db
    .select()
    .from(users)
    .innerJoin(
      organizationMemberships,
      eq(organizationMemberships.userId, users.id),
    )
    .where(
      and(
        eq(users.id, id),
        isNull(users.deletedAt),
        eq(organizationMemberships.organizationId, organizationId),
        isNull(organizationMemberships.deletedAt),
      ),
    )
    .limit(1);

  return row?.users ?? null;
}

function publicUserWithStatus(user: Pick<User,
  "id" | "email" | "fullName" | "role" | "avatarUrl" | "phone" | "createdAt" | "updatedAt"
> & {
  isActive?: boolean | null;
  passwordSetAt?: Date | null;
  inviteTokenExpiresAt?: Date | null;
  lastInviteEmailSentAt?: Date | null;
  lastInviteEmailError?: string | null;
}) {
  const base = toPublicUser(user);
  return {
    ...base,
    isActive: user.isActive ?? true,
    passwordSetAt: user.passwordSetAt ?? null,
    inviteTokenExpiresAt: user.inviteTokenExpiresAt ?? null,
    lastInviteEmailSentAt: user.lastInviteEmailSentAt
      ? user.lastInviteEmailSentAt.toISOString()
      : null,
    lastInviteEmailError: user.lastInviteEmailError ?? null,
  };
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
    const includeInactive = query.data.includeInactive;

    const isAdmin = req.auth?.role === "admin";
    // Only admins are allowed to see inactive users (the column is meaningful
    // for managing the team; managers and crew members never need that view).
    const effectiveIncludeInactive = includeInactive && isAdmin;
    const organizationId = getActiveOrganizationId(req.auth!);

    const baseConditions = [
      isNull(users.deletedAt),
      query.data.roles.length > 0 ? inArray(users.role, query.data.roles) : undefined,
      effectiveIncludeInactive ? undefined : eq(users.isActive, true),
    ];

    const [[totalRow], rows] = organizationId
      ? await Promise.all([
          db
            .select({ total: count() })
            .from(users)
            .innerJoin(
              organizationMemberships,
              eq(organizationMemberships.userId, users.id),
            )
            .where(
              and(
                ...baseConditions,
                eq(organizationMemberships.organizationId, organizationId),
                isNull(organizationMemberships.deletedAt),
              ),
            ),
          db
            .select(safeUserColumns)
            .from(users)
            .innerJoin(
              organizationMemberships,
              eq(organizationMemberships.userId, users.id),
            )
            .where(
              and(
                ...baseConditions,
                eq(organizationMemberships.organizationId, organizationId),
                isNull(organizationMemberships.deletedAt),
              ),
            )
            .orderBy(asc(users.fullName))
            .limit(limit)
            .offset(offset),
        ])
      : await Promise.all([
          db
            .select({ total: count() })
            .from(users)
            .where(and(...baseConditions)),
          db
            .select(safeUserColumns)
            .from(users)
            .where(and(...baseConditions))
            .orderBy(asc(users.fullName))
            .limit(limit)
            .offset(offset),
        ]);

    const total = Number(totalRow?.total ?? 0);
    const publicUsers = rows.map((row) =>
      isAdmin ? publicUserWithStatus(row) : toPublicUser(row),
    );

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

// Per-user notification preferences. See lib/db/schema notificationPrefs
// (migration 0017) for the JSONB shape. We accept any string-keyed
// boolean map and merge into the existing blob so partial updates from
// the UI don't clobber events we don't yet render.
const notificationPrefsSchema = z.object({
  prefs: z.record(z.boolean()),
});

router.get(
  "/me/notification-prefs",
  asyncHandler(async (req, res) => {
    const user = await findActiveUserById(req.auth!.userId);
    if (!user) {
      throw new HttpError(404, "User not found.");
    }
    const [row] = await db
      .select({ prefs: users.notificationPrefs })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    res.json({ prefs: row?.prefs ?? {} });
  }),
);

router.put(
  "/me/notification-prefs",
  asyncHandler(async (req, res) => {
    const user = await findActiveUserById(req.auth!.userId);
    if (!user) {
      throw new HttpError(404, "User not found.");
    }
    const parsed = notificationPrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid notification prefs payload.", parsed.error.flatten());
    }
    const [existing] = await db
      .select({ prefs: users.notificationPrefs })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const merged = { ...(existing?.prefs ?? {}), ...parsed.data.prefs };
    await db
      .update(users)
      .set({ notificationPrefs: merged, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    res.json({ prefs: merged });
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

    const now = new Date();
    const [updated] = await db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(users)
        .set({ passwordHash, updatedAt: now, passwordSetAt: now })
        .where(eq(users.id, user.id))
        .returning();

      await tx
        .update(personalAccessTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(personalAccessTokens.userId, user.id),
            isNull(personalAccessTokens.revokedAt),
          ),
        );

      return updatedRows;
    });

    sendAuthResponse(res, updated!);
  }),
);

// Admin: invite a new worker. We create the user with a random unguessable
// placeholder password and a single-use setup token. The raw token is returned
// exactly once in the response and email pipeline; only its sha256 hash is
// stored server-side. The admin hands the `invitePath` to the new worker; the
// worker exchanges it for a real password via POST /auth/accept-invite.
router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = inviteUserSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new HttpError(400, "Invalid invite payload.", parsed.error.flatten());
    }

    const { email, fullName, role } = parsed.data;

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (existing) {
      throw new HttpError(409, "An account with that email already exists.");
    }

    const placeholderHash = await generatePlaceholderPasswordHash();
    const invite = generateInvite();
    const inviteUrl = buildInviteUrl(invite.token);
    const organizationId = getActiveOrganizationId(req.auth!);

    const [created] = await db.transaction(async (tx) => {
      const createdRows = await tx
        .insert(users)
        .values({
          email,
          fullName,
          role,
          defaultOrganizationId: organizationId,
          passwordHash: placeholderHash,
          isActive: true,
          inviteTokenHash: invite.tokenHash,
          inviteToken: null,
          inviteTokenExpiresAt: invite.expiresAt,
          passwordSetAt: null,
        })
        .returning();

      const createdUser = createdRows[0];
      if (createdUser && organizationId) {
        await tx.insert(organizationMemberships).values({
          organizationId,
          userId: createdUser.id,
          role: organizationRoleFromUserRole(role),
          isDefault: true,
          invitedBy: req.auth!.userId,
        });
      }

      return createdRows;
    });

    if (!created) {
      throw new HttpError(500, "Failed to create user.");
    }

    await writeActivity({
      entityType: "user",
      entityId: created.id,
      action: "user.invited",
      userId: req.auth!.userId,
      jobId: null,
      description: `Invited ${created.fullName} (${created.email}) as ${created.role}`,
      extra: { invitedRole: created.role, invitedEmail: created.email },
    }).catch((error) => {
      // Activity logging must never block the invite from being returned.
      req.log.warn({ err: error }, "users: failed to record invite activity");
    });

    const inviterName = await resolveInviterName(req.auth!.userId);
    const delivery = await deliverInviteEmail({
      userId: created.id,
      to: created.email,
      fullName: created.fullName,
      inviterName,
      inviteToken: invite.token,
      inviteUrl,
      // First-time invite by definition — the row was just inserted with a
      // placeholder password and no `passwordSetAt`.
      isPasswordReset: false,
    });

    res.status(201).json({
      user: {
        ...publicUserWithStatus(created),
        lastInviteEmailSentAt: delivery.lastInviteEmailSentAt,
        lastInviteEmailError: delivery.emailError,
      },
      inviteToken: invite.token,
      invitePath: buildInvitePath(invite.token),
      inviteUrl,
      inviteTokenExpiresAt: invite.expiresAt.toISOString(),
      emailDelivery: {
        emailed: delivery.emailed,
        emailError: delivery.emailError,
        lastInviteEmailSentAt: delivery.lastInviteEmailSentAt,
      },
    });
  }),
);

// Admin: reissue an invite token. Useful when the original setup link was
// lost or expired, OR when the admin needs to force a password reset for
// a worker (since the team has no email-based forgot-password flow).
router.post(
  "/:id/invite",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      throw new HttpError(400, "Invalid user id.");
    }

    const organizationId = getActiveOrganizationId(req.auth!);
    const target = await findActiveUserInOrganization(id.data, organizationId);

    if (!target) {
      throw new HttpError(404, "User not found.");
    }

    const invite = generateInvite();
    const inviteUrl = buildInviteUrl(invite.token);
    const now = new Date();
    const isPasswordReset = target.passwordSetAt !== null;

    const [updated] = await db.transaction(async (tx) => {
      const updatedRows = await tx
        .update(users)
        .set({
          inviteTokenHash: invite.tokenHash,
          inviteToken: null,
          inviteTokenExpiresAt: invite.expiresAt,
          passwordSetAt: isPasswordReset ? now : target.passwordSetAt,
          updatedAt: now,
        })
        .where(eq(users.id, target.id))
        .returning();

      if (isPasswordReset) {
        await tx
          .update(personalAccessTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(personalAccessTokens.userId, target.id),
              isNull(personalAccessTokens.revokedAt),
            ),
          );
      }

      return updatedRows;
    });

    await writeActivity({
      entityType: "user",
      entityId: target.id,
      action: "user.invite_reissued",
      userId: req.auth!.userId,
      jobId: null,
      description: `Reissued setup link for ${target.fullName} (${target.email})`,
    }).catch((error) => {
      req.log.warn({ err: error }, "users: failed to record reissue activity");
    });

    const inviterName = await resolveInviterName(req.auth!.userId);
    // If the user already finished setup (passwordSetAt is non-null), this
    // reissue is functioning as an admin-driven password reset. Send the
    // reworded password-reset email instead of the first-time invite email.
    const delivery = await deliverInviteEmail({
      userId: target.id,
      to: target.email,
      fullName: target.fullName,
      inviterName,
      inviteToken: invite.token,
      inviteUrl,
      isPasswordReset,
    });

    res.json({
      user: {
        ...publicUserWithStatus(updated!),
        lastInviteEmailSentAt: delivery.lastInviteEmailSentAt,
        lastInviteEmailError: delivery.emailError,
      },
      inviteToken: invite.token,
      invitePath: buildInvitePath(invite.token),
      inviteUrl,
      inviteTokenExpiresAt: invite.expiresAt.toISOString(),
      emailDelivery: {
        emailed: delivery.emailed,
        emailError: delivery.emailError,
        lastInviteEmailSentAt: delivery.lastInviteEmailSentAt,
      },
    });
  }),
);

// Admin: resend a pending invite email. Raw invite tokens are never stored, so
// resend mints a fresh single-use token and invalidates any previous pending
// setup link. Password resets still go through the reissue endpoint above.
router.post(
  "/:id/invite/resend",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      throw new HttpError(400, "Invalid user id.");
    }

    const organizationId = getActiveOrganizationId(req.auth!);
    const target = await findActiveUserInOrganization(id.data, organizationId);

    if (!target) {
      throw new HttpError(404, "User not found.");
    }

    if (target.passwordSetAt !== null) {
      throw new HttpError(
        400,
        "This user has already completed setup. Use reissue to send a new password reset link.",
      );
    }

    if (!target.inviteTokenHash || !target.inviteTokenExpiresAt) {
      throw new HttpError(
        400,
        "There is no pending invite to resend. Use reissue to generate a new setup link.",
      );
    }

    if (target.inviteTokenExpiresAt.getTime() < Date.now()) {
      throw new HttpError(
        400,
        "The invite link has expired. Use reissue to generate a new one.",
      );
    }

    const invite = generateInvite();
    const inviteUrl = buildInviteUrl(invite.token);
    const [updated] = await db
      .update(users)
      .set({
        inviteTokenHash: invite.tokenHash,
        inviteToken: null,
        inviteTokenExpiresAt: invite.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id))
      .returning();

    await writeActivity({
      entityType: "user",
      entityId: target.id,
      action: "user.invite_resent",
      userId: req.auth!.userId,
      jobId: null,
      description: `Resent setup email for ${target.fullName} (${target.email})`,
    }).catch((error) => {
      req.log.warn({ err: error }, "users: failed to record invite resend activity");
    });

    const inviterName = await resolveInviterName(req.auth!.userId);
    const delivery = await deliverInviteEmail({
      userId: target.id,
      to: target.email,
      fullName: target.fullName,
      inviterName,
      inviteToken: invite.token,
      inviteUrl,
      isPasswordReset: false,
    });

    const [refreshed] = await db
      .select()
      .from(users)
      .where(eq(users.id, target.id))
      .limit(1);

    res.json({
      user: {
        ...publicUserWithStatus(refreshed ?? updated!),
        lastInviteEmailSentAt: delivery.lastInviteEmailSentAt,
        lastInviteEmailError: delivery.emailError,
      },
      inviteToken: invite.token,
      invitePath: buildInvitePath(invite.token),
      inviteUrl,
      inviteTokenExpiresAt: invite.expiresAt.toISOString(),
      emailDelivery: {
        emailed: delivery.emailed,
        emailError: delivery.emailError,
        lastInviteEmailSentAt: delivery.lastInviteEmailSentAt,
      },
    });
  }),
);

// Admin: change a worker's name, role, or active flag. Admins can never
// flip their OWN isActive to false through this endpoint — that has to be
// done by another admin so the team can never lock itself out by accident.
router.patch(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);

    if (!id.success) {
      throw new HttpError(400, "Invalid user id.");
    }

    const parsed = updateUserSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new HttpError(400, "Invalid user payload.", parsed.error.flatten());
    }

    const organizationId = getActiveOrganizationId(req.auth!);
    const target = await findActiveUserInOrganization(id.data, organizationId);

    if (!target) {
      throw new HttpError(404, "User not found.");
    }

    if (
      parsed.data.isActive === false &&
      target.id === req.auth!.userId
    ) {
      throw new HttpError(400, "You cannot deactivate your own account.");
    }

    const nextRole = parsed.data.role ?? target.role;
    const nextIsActive = parsed.data.isActive ?? target.isActive;

    if (target.id === req.auth!.userId && nextRole !== target.role) {
      throw new HttpError(400, "You cannot change your own role.");
    }

    const [updated] = await db.transaction(async (tx) => {
      if (
        target.role === "admin" &&
        target.isActive &&
        (nextRole !== "admin" || nextIsActive === false)
      ) {
        const [remainingAdmin] = organizationId
          ? await tx
              .select({ total: count() })
              .from(users)
              .innerJoin(
                organizationMemberships,
                eq(organizationMemberships.userId, users.id),
              )
              .where(
                and(
                  eq(users.role, "admin"),
                  eq(users.isActive, true),
                  isNull(users.deletedAt),
                  ne(users.id, target.id),
                  eq(organizationMemberships.organizationId, organizationId),
                  isNull(organizationMemberships.deletedAt),
                ),
              )
          : await tx
              .select({ total: count() })
              .from(users)
              .where(
                and(
                  eq(users.role, "admin"),
                  eq(users.isActive, true),
                  isNull(users.deletedAt),
                  ne(users.id, target.id),
                ),
              );

        if (Number(remainingAdmin?.total ?? 0) === 0) {
          throw new HttpError(400, "Cannot demote or deactivate the last active admin.");
        }
      }

      const now = new Date();
      const updatedRows = await tx
        .update(users)
        .set({
          fullName: parsed.data.fullName ?? target.fullName,
          role: nextRole,
          isActive: nextIsActive,
          updatedAt: now,
        })
        .where(eq(users.id, target.id))
        .returning();

      if (organizationId && parsed.data.role) {
        await tx
          .update(organizationMemberships)
          .set({
            role: organizationRoleFromUserRole(nextRole),
            updatedAt: now,
          })
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.userId, target.id),
              isNull(organizationMemberships.deletedAt),
            ),
          );
      }

      if (target.isActive && nextIsActive === false) {
        await tx
          .update(personalAccessTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(personalAccessTokens.userId, target.id),
              isNull(personalAccessTokens.revokedAt),
            ),
          );
      }

      return updatedRows;
    });

    if (!updated) {
      throw new HttpError(500, "Failed to update user.");
    }

    const description: string[] = [];
    if (parsed.data.fullName && parsed.data.fullName !== target.fullName) {
      description.push(`renamed to ${parsed.data.fullName}`);
    }
    if (parsed.data.role && parsed.data.role !== target.role) {
      description.push(`role changed from ${target.role} to ${parsed.data.role}`);
    }
    if (parsed.data.isActive !== undefined && parsed.data.isActive !== target.isActive) {
      description.push(parsed.data.isActive ? "reactivated" : "deactivated");
    }

    if (description.length > 0) {
      await writeActivity({
        entityType: "user",
        entityId: target.id,
        action: "user.updated",
        userId: req.auth!.userId,
        jobId: null,
        description: `${target.fullName}: ${description.join(", ")}`,
        extra: parsed.data,
      }).catch((error) => {
        req.log.warn({ err: error }, "users: failed to record update activity");
      });
    }

    res.json({ user: publicUserWithStatus(updated) });
  }),
);

export default router;
