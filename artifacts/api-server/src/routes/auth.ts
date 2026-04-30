import bcrypt from "bcrypt";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { safeUserColumns, users } from "@workspace/db/schema";
import {
  clearRefreshTokenCookie,
  clearUploadTokenCookie,
  refreshCookieName,
  toPublicUser,
  sendAuthResponse,
  verifyRefreshToken,
} from "../lib/auth";
import { HttpError, asyncHandler } from "../lib/http";
import { createRateLimit } from "../lib/rate-limit";
import { requireAdmin, requireAuth } from "../middleware/require-auth";

// NOTE: There is intentionally no `/forgot-password` or `/reset-password` route.
// The team is small (single-digit users) and the admin manages passwords directly
// out of band — no transactional email provider is wired up. See `replit.md`
// ("Auth & password management") for the rationale.

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

async function findActiveUserByEmailWithPasswordHash(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  return user ?? null;
}

async function findActiveUserById(id: string) {
  const [user] = await db
    .select(safeUserColumns)
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

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        fullName,
      })
      .onConflictDoNothing({
        target: users.email,
        where: sql`${users.deletedAt} IS NULL`,
      })
      .returning();

    if (!user) {
      throw new HttpError(409, "An account with that email already exists.");
    }

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

    const user = await findActiveUserByEmailWithPasswordHash(email);

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

export default router;
