import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
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
import { clearRateLimitBucket, createRateLimit } from "../lib/rate-limit";
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

// Per-IP login limiter — 5 failed attempts per 15-minute window by
// default, tunable via env. The bucket is cleared by the login handler
// on a successful authentication (see `clearLoginRateLimitForIp`
// below), so a legitimate user who fat-fingers their password a few
// times before getting it right is not locked out for the rest of the
// window. Failed attempts continue to accrue until they either succeed
// or the window rolls over.
const LOGIN_IP_KEY_PREFIX = "auth:login:ip";
const LOGIN_IP_MAX = Number(process.env.LOGIN_IP_MAX ?? 5);
const LOGIN_IP_WINDOW_MS = Number(
  process.env.LOGIN_IP_WINDOW_MS ?? 15 * 60 * 1000,
);

const loginRateLimitByIp = createRateLimit({
  keyPrefix: LOGIN_IP_KEY_PREFIX,
  max: LOGIN_IP_MAX,
  windowMs: LOGIN_IP_WINDOW_MS,
  message: "Too many login attempts. Try again later.",
  resolveKey: (req) => req.ip || null,
});

// Defense-in-depth: also bucket per email so credential-stuffing across
// many distinct IPs against a single victim account still trips a
// limit. Tighter window than the IP limiter; the same `clear-on-success`
// hook below resets this bucket on a valid login.
const LOGIN_EMAIL_KEY_PREFIX = "auth:login:email";
const LOGIN_EMAIL_MAX = Number(process.env.LOGIN_EMAIL_MAX ?? 5);
const LOGIN_EMAIL_WINDOW_MS = Number(
  process.env.LOGIN_EMAIL_WINDOW_MS ?? 15 * 60 * 1000,
);

const loginRateLimitByEmail = createRateLimit({
  keyPrefix: LOGIN_EMAIL_KEY_PREFIX,
  max: LOGIN_EMAIL_MAX,
  windowMs: LOGIN_EMAIL_WINDOW_MS,
  message: "Too many login attempts. Try again later.",
  resolveKey: (req) => normalizeEmailForRateLimit(req.body?.email),
});

function clearLoginRateLimitForRequest(req: {
  ip?: string;
  body?: { email?: unknown };
}): void {
  if (req.ip) {
    clearRateLimitBucket(LOGIN_IP_KEY_PREFIX, req.ip);
  }
  const email = normalizeEmailForRateLimit(req.body?.email);
  if (email) {
    clearRateLimitBucket(LOGIN_EMAIL_KEY_PREFIX, email);
  }
}

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
    .where(and(eq(users.id, id), eq(users.isActive, true), isNull(users.deletedAt)))
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

    if (!user.isActive) {
      // Constant-time-ish: still hash so we don't leak active vs inactive
      // through wall-clock timing. Same approach as the `user not found`
      // branch (which simply errors without a bcrypt call — the timing
      // gap there is intentional and existed before this check).
      await bcrypt.compare(password, user.passwordHash);
      throw new HttpError(
        401,
        "This account has been deactivated. Contact an administrator.",
      );
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      throw new HttpError(401, "Invalid email or password.");
    }

    // Reset both login limiter buckets for this IP and this email so the
    // 5-attempt budget is refreshed for legitimate users on every
    // successful sign-in.
    clearLoginRateLimitForRequest(req);

    sendAuthResponse(res, user);
  }),
);

function hashInviteToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

router.post(
  "/accept-invite",
  asyncHandler(async (req, res) => {
    const rawToken =
      typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const newPassword = req.body?.password;

    if (!rawToken) {
      throw new HttpError(400, "Setup token is required.");
    }

    if (typeof newPassword !== "string") {
      throw new HttpError(400, "Password is required.");
    }

    const password = normalizePassword(newPassword, "Password");

    const tokenHash = hashInviteToken(rawToken);
    const now = new Date();

    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.inviteTokenHash, tokenHash),
          gt(users.inviteTokenExpiresAt, now),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    if (!user) {
      throw new HttpError(401, "Setup link is invalid or has expired.");
    }

    if (!user.isActive) {
      throw new HttpError(
        401,
        "This account has been deactivated. Contact an administrator.",
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Atomic single-use: the WHERE clause repeats the token-hash so a
    // concurrent second request hitting the same token sees zero rows
    // updated and we know the token was already consumed.
    const updated = await db
      .update(users)
      .set({
        passwordHash,
        passwordSetAt: now,
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, user.id),
          eq(users.inviteTokenHash, tokenHash),
        ),
      )
      .returning();

    if (updated.length === 0) {
      throw new HttpError(401, "Setup link is invalid or has expired.");
    }

    sendAuthResponse(res, updated[0]!);
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
