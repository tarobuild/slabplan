import bcrypt from "bcrypt";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { requireAuth } from "../middleware/require-auth";
import { asyncHandler, HttpError } from "../lib/http";
import { clearRateLimitBucket, createRateLimit } from "../lib/rate-limit";
import {
  beginSecurityEnrollment,
  completeSecurityChallenge,
  issueEmailVerification,
  issueSecurityChallenge,
  readSecurityUser,
  revokeAccountSessions,
  verifyEmail,
} from "../lib/account-security";
import {
  clearRefreshTokenCookie,
  clearUploadTokenCookie,
  sendAuthResponse,
} from "../lib/auth";
import {
  isSupabasePasswordLoginEnabled,
  signInWithSupabasePassword,
} from "../lib/supabase-auth-session";

const router: IRouter = Router();
const verificationLimit = createRateLimit({
  keyPrefix: "auth:security:ip",
  max: 20,
  windowMs: 15 * 60 * 1000,
  message: "Too many verification attempts. Try again later.",
  resolveKey: (req) => req.ip || null,
});
const resendIpLimit = createRateLimit({
  keyPrefix: "auth:verify-resend:ip",
  max: 8,
  windowMs: 60 * 60 * 1000,
  message: "Too many email requests. Try again later.",
  resolveKey: (req) => req.ip || null,
});
const resendEmailLimit = createRateLimit({
  keyPrefix: "auth:verify-resend:email",
  max: 3,
  windowMs: 60 * 60 * 1000,
  message: "Too many email requests. Try again later.",
  resolveKey: (req) =>
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase().slice(0, 255)
      : null,
});

function readString(value: unknown, label: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, `${label} is required.`);
  return value.trim();
}

router.post(
  "/verify-email",
  verificationLimit,
  asyncHandler(async (req, res) => {
    await verifyEmail(readString(req.body?.token, "Verification token"));
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true });
  }),
);

router.post(
  "/resend-verification",
  resendIpLimit,
  resendEmailLimit,
  asyncHandler(async (req, res) => {
    const email = readString(req.body?.email, "Email", 255).toLowerCase();
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.isActive, true),
          isNull(users.emailVerifiedAt),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    if (user && !(await issueEmailVerification(user)))
      throw new HttpError(
        503,
        "Verification email delivery is unavailable. Please try again later.",
      );
    res.status(202).json({ success: true });
  }),
);

router.get(
  "/security",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await readSecurityUser(req.auth!.userId);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
      mfaEnabled: !!user.mfaEnabledAt,
      mfaRequired: user.mfaRequired,
      recoveryCodesRemaining: user.mfaRecoveryHashes.length,
    });
  }),
);

router.post(
  "/security/setup",
  requireAuth,
  verificationLimit,
  asyncHandler(async (req, res) => {
    if (req.auth!.authProvider === "pat")
      throw new HttpError(
        403,
        "Use an interactive session to change account security.",
      );
    const user = await readSecurityUser(req.auth!.userId);
    if (user.mfaEnabledAt)
      throw new HttpError(409, "Two-step verification is already enabled.");
    readString(req.body?.password, "Current password", 1024);
    const password: string = req.body.password;
    if (isSupabasePasswordLoginEnabled())
      await signInWithSupabasePassword(user.email, password);
    else if (!(await bcrypt.compare(password, user.passwordHash)))
      throw new HttpError(401, "Current password is incorrect.");
    const challengeToken = await issueSecurityChallenge(user.id, "setup");
    res.setHeader("Cache-Control", "no-store");
    res.json({ setupRequired: true, challengeToken });
  }),
);

router.post(
  "/security/enroll",
  verificationLimit,
  asyncHandler(async (req, res) => {
    const result = await beginSecurityEnrollment(
      readString(req.body?.challengeToken, "Setup token"),
    );
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  }),
);

for (const [path, kind] of [
  ["/security/confirm", "setup"],
  ["/mfa/verify", "login"],
] as const) {
  router.post(
    path,
    verificationLimit,
    asyncHandler(async (req, res) => {
      const result = await completeSecurityChallenge(
        readString(req.body?.challengeToken, "Verification token"),
        readString(req.body?.code, "Verification code", 64),
        kind,
      );
      if (req.ip) await clearRateLimitBucket("auth:login:ip", req.ip);
      await clearRateLimitBucket("auth:login:email", result.user.email);
      sendAuthResponse(res, result.user, {
        ...result,
        includeRefreshToken: req.get("x-cadstone-client") === "mobile",
      });
    }),
  );
}

router.post(
  "/security/revoke-sessions",
  requireAuth,
  verificationLimit,
  asyncHandler(async (req, res) => {
    if (req.auth!.authProvider === "pat")
      throw new HttpError(
        403,
        "Use an interactive session to revoke account access.",
      );
    await revokeAccountSessions(req.auth!.userId);
    clearRefreshTokenCookie(res);
    clearUploadTokenCookie(res);
    res.json({ success: true });
  }),
);

export default router;
