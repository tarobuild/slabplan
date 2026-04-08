import bcrypt from "bcrypt";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import {
  clearRefreshTokenCookie,
  clearUploadTokenCookie,
  refreshCookieName,
  signResetToken,
  toPublicUser,
  sendAuthResponse,
  verifyRefreshToken,
  verifyResetToken,
} from "../lib/auth";
import { HttpError, asyncHandler } from "../lib/http";
import { logger } from "../lib/logger";
import { createRateLimit } from "../lib/rate-limit";
import { requireAdmin, requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailForRateLimit(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return emailPattern.test(normalized) ? normalized : null;
}

const loginRateLimitByIp = createRateLimit({
  keyPrefix: "auth:login:ip",
  max: 10,
  windowMs: 10 * 60 * 1000,
  message: "Too many login attempts. Try again later.",
  resolveKey: (req) => req.ip || null,
});

const loginRateLimitByEmail = createRateLimit({
  keyPrefix: "auth:login:email",
  max: 5,
  windowMs: 10 * 60 * 1000,
  message: "Too many login attempts. Try again later.",
  resolveKey: (req) => normalizeEmailForRateLimit(req.body?.email),
});

const forgotPasswordRateLimitByIp = createRateLimit({
  keyPrefix: "auth:forgot-password:ip",
  max: 5,
  windowMs: 15 * 60 * 1000,
  message: "Too many password reset requests. Try again later.",
  resolveKey: (req) => req.ip || null,
});

const forgotPasswordRateLimitByEmail = createRateLimit({
  keyPrefix: "auth:forgot-password:email",
  max: 3,
  windowMs: 15 * 60 * 1000,
  message: "Too many password reset requests. Try again later.",
  resolveKey: (req) => normalizeEmailForRateLimit(req.body?.email),
});

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Email is required.");
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized || !emailPattern.test(normalized)) {
    throw new HttpError(400, "A valid email is required.");
  }

  return normalized;
}

function normalizePassword(value: unknown, label = "Password"): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${label} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length < 8) {
    throw new HttpError(400, `${label} must be at least 8 characters.`);
  }

  return trimmed;
}

function normalizeLoginPassword(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Password is required.");
  }
  return value.trim();
}

function normalizeFullName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Full name is required.");
  }

  const trimmed = value.trim();

  if (trimmed.length < 2) {
    throw new HttpError(400, "Full name must be at least 2 characters.");
  }

  return trimmed;
}

async function findActiveUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  return user ?? null;
}

async function findActiveUserById(id: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);

  return user ?? null;
}

router.post(
  "/register",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = normalizePassword(req.body.password);
    const fullName = normalizeFullName(req.body.full_name);

    const existing = await findActiveUserByEmail(email);

    if (existing) {
      throw new HttpError(409, "An account with that email already exists.");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        fullName,
      })
      .returning();

    res.status(201).json({ user: toPublicUser(user) });
  }),
);

router.post(
  "/login",
  loginRateLimitByIp,
  loginRateLimitByEmail,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = normalizeLoginPassword(req.body.password);

    const user = await findActiveUserByEmail(email);

    if (!user) {
      throw new HttpError(401, "Invalid email or password.");
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      throw new HttpError(401, "Invalid email or password.");
    }

    sendAuthResponse(res, user);
  }),
);

router.post("/logout", (_req, res) => {
  clearRefreshTokenCookie(res);
  clearUploadTokenCookie(res);
  res.json({ success: true });
});

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[refreshCookieName];

    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      throw new HttpError(401, "Refresh token missing.");
    }

    const claims = verifyRefreshToken(refreshToken);
    const user = await findActiveUserById(claims.userId);

    if (!user) {
      clearRefreshTokenCookie(res);
      clearUploadTokenCookie(res);
      throw new HttpError(401, "Refresh token invalid.");
    }

    sendAuthResponse(res, user);
  }),
);

router.post(
  "/forgot-password",
  forgotPasswordRateLimitByIp,
  forgotPasswordRateLimitByEmail,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const user = await findActiveUserByEmail(email);

    if (!user) {
      res.json({
        success: true,
        message: "If an account exists for that email, a reset link has been sent.",
      });
      return;
    }

    const resetToken = signResetToken(toPublicUser(user));
    logger.info(
      {
        email,
      },
      "Generated password reset token",
    );

    res.json({
      success: true,
      message: "Password reset instructions generated.",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : {
            previewToken: resetToken,
          }),
    });
  }),
);

router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token.trim() : "";
    const newPassword = normalizePassword(req.body.newPassword, "New password");

    if (!token) {
      throw new HttpError(400, "Reset token is required.");
    }

    const claims = verifyResetToken(token);
    const user = await findActiveUserById(claims.userId);

    if (!user) {
      throw new HttpError(404, "User account not found.");
    }

    if (claims.version !== String(user.updatedAt?.getTime() ?? 0)) {
      throw new HttpError(401, "Reset token invalid.");
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await db
      .update(users)
      .set({
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    clearRefreshTokenCookie(res);
    clearUploadTokenCookie(res);
    res.json({ success: true });
  }),
);

export default router;
