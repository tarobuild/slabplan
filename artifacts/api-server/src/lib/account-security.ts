import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { personalAccessTokens, users, type User } from "@workspace/db/schema";
import { generateSecret, generateURI, verify } from "otplib";
import type { Response } from "express";
import { HttpError } from "./http";
import { APP_PUBLIC_ORIGIN } from "./brand";
import { sendEmailVerification } from "./email";
import { logger } from "./logger";
import { updateSupabaseAuthUser } from "./supabase-auth-session";
import { clearRefreshTokenCookie, clearUploadTokenCookie } from "./auth";
import { recordSecurityEvent } from "./security-events";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const activeUser = (id: string) =>
  and(eq(users.id, id), eq(users.isActive, true), isNull(users.deletedAt));

function encryptionKey(): Buffer {
  const key = process.env.ACCOUNT_SECURITY_ENCRYPTION_KEY?.trim();
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) {
    throw new HttpError(
      503,
      "Account security setup is unavailable. Please contact support.",
    );
  }
  return Buffer.from(key, "hex");
}

export function assertSecurityEnrollmentConfigured(): void {
  encryptionKey();
}

function encryptSecret(secret: string, userId: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptSecret(value: string, userId: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("Invalid encrypted factor.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function readSecurityUser(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(activeUser(id)).limit(1);
  if (!user) throw new HttpError(401, "Authentication required.");
  return user;
}

export async function assertInteractiveSecurity(auth: {
  userId: string;
  mfaVerifiedAt?: number;
}): Promise<void> {
  const user = await readSecurityUser(auth.userId);
  if (
    (user.mfaRequired && !user.mfaEnabledAt) ||
    (user.mfaEnabledAt &&
      (!auth.mfaVerifiedAt || auth.mfaVerifiedAt < user.mfaEnabledAt.getTime()))
  ) {
    throw new HttpError(
      401,
      "Two-step verification is required. Sign in again.",
      undefined,
      "mfa-required",
    );
  }
}

export async function issueEmailVerification(
  user: Pick<User, "id" | "email">,
): Promise<boolean> {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hash(token);
  const changed = await db
    .update(users)
    .set({
      emailVerificationHash: tokenHash,
      emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .where(and(activeUser(user.id), eq(users.email, user.email)))
    .returning({ id: users.id });
  if (!changed.length) return false;
  try {
    // A URL fragment keeps the secret out of server access logs and Referer headers.
    await sendEmailVerification(
      user.email,
      `${APP_PUBLIC_ORIGIN}/verify-email#token=${token}`,
    );
    logger.info(
      { event: "security.verification.sent", userId: user.id },
      "Email verification sent",
    );
    return true;
  } catch {
    logger.error(
      { event: "security.verification.delivery_failed", userId: user.id },
      "Email verification delivery failed",
    );
    return false;
  }
}

export async function verifyEmail(token: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(400, "This verification link is invalid or expired.");
  const user = await db.transaction(async (tx) => {
    const predicate = and(
      eq(users.emailVerificationHash, hash(token)),
      gt(users.emailVerificationExpiresAt, new Date()),
      eq(users.isActive, true),
      isNull(users.deletedAt),
    );
    const [candidate] = await tx
      .select({
        id: users.id,
        supabaseAuthUserId: users.supabaseAuthUserId,
        defaultOrganizationId: users.defaultOrganizationId,
      })
      .from(users)
      .where(predicate)
      .for("update");
    if (!candidate) return null;
    if (candidate.supabaseAuthUserId)
      await updateSupabaseAuthUser(candidate.supabaseAuthUserId, {
        email_confirm: true,
      });
    await tx
      .update(users)
      .set({
        emailVerifiedAt: new Date(),
        emailVerificationHash: null,
        emailVerificationExpiresAt: null,
      })
      .where(eq(users.id, candidate.id));
    await recordSecurityEvent(tx, "security.email.verified", candidate);
    return candidate;
  });
  if (!user)
    throw new HttpError(400, "This verification link is invalid or expired.");
  logger.info(
    { event: "security.email.verified", userId: user.id },
    "Email verified",
  );
}

export async function issueSecurityChallenge(
  userId: string,
  kind: "setup" | "login",
): Promise<string> {
  if (kind === "setup") assertSecurityEnrollmentConfigured();
  const token = crypto.randomBytes(32).toString("hex");
  await db
    .update(users)
    .set({
      securityChallengeHash: hash(token),
      securityChallengeKind: kind,
      securityChallengeCreatedAt: new Date(),
      securityChallengeExpiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      securityChallengeAttempts: 0,
      ...(kind === "setup"
        ? { mfaPendingSecretEncrypted: null, mfaPendingExpiresAt: null }
        : {}),
    })
    .where(activeUser(userId));
  return token;
}

export async function sendSecuritySignInStep(
  res: Response,
  userId: string,
): Promise<boolean> {
  const user = await readSecurityUser(userId);
  res.setHeader("Cache-Control", "no-store");
  if (user.emailVerificationRequired && !user.emailVerifiedAt) {
    clearRefreshTokenCookie(res);
    clearUploadTokenCookie(res);
    res.json({ verificationRequired: true, email: user.email });
    return true;
  }
  if (user.mfaEnabledAt || user.mfaRequired) {
    clearRefreshTokenCookie(res);
    clearUploadTokenCookie(res);
    const kind = user.mfaEnabledAt ? "login" : "setup";
    const challengeToken = await issueSecurityChallenge(user.id, kind);
    res.json({
      mfaRequired: kind === "login",
      setupRequired: kind === "setup",
      challengeToken,
    });
    return true;
  }
  return false;
}

function challengeIsValid(user: User): boolean {
  const now = Date.now();
  const revokedAt = Math.max(
    user.passwordSetAt?.getTime() ?? 0,
    user.sessionsRevokedAt?.getTime() ?? 0,
  );
  return (
    !!user.securityChallengeCreatedAt &&
    user.securityChallengeCreatedAt.getTime() >= revokedAt &&
    !!user.securityChallengeExpiresAt &&
    user.securityChallengeExpiresAt.getTime() > now &&
    user.securityChallengeAttempts < MAX_ATTEMPTS &&
    !(user.emailVerificationRequired && !user.emailVerifiedAt)
  );
}

function challengePredicate(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(401, "Sign-in verification expired. Sign in again.");
  return and(
    eq(users.securityChallengeHash, hash(token)),
    eq(users.isActive, true),
    isNull(users.deletedAt),
  );
}

export async function beginSecurityEnrollment(token: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(challengePredicate(token))
      .for("update");
    if (
      !user ||
      !challengeIsValid(user) ||
      user.securityChallengeKind !== "setup" ||
      user.mfaEnabledAt
    ) {
      throw new HttpError(401, "Security setup expired. Sign in again.");
    }
    const secret =
      user.mfaPendingSecretEncrypted &&
      user.mfaPendingExpiresAt &&
      user.mfaPendingExpiresAt > new Date()
        ? decryptSecret(user.mfaPendingSecretEncrypted, user.id)
        : generateSecret();
    await tx
      .update(users)
      .set({
        mfaPendingSecretEncrypted: encryptSecret(secret, user.id),
        mfaPendingExpiresAt: user.securityChallengeExpiresAt,
      })
      .where(eq(users.id, user.id));
    return {
      secret,
      uri: generateURI({ issuer: "SlabPlan", label: user.email, secret }),
      expiresAt: user.securityChallengeExpiresAt!.toISOString(),
    };
  });
}

async function checkFactor(user: User, code: string, setup: boolean) {
  const encrypted = setup
    ? user.mfaPendingSecretEncrypted
    : user.mfaSecretEncrypted;
  if (!encrypted) return null;
  if (/^\d{6}$/.test(code)) {
    const result = await verify({
      secret: decryptSecret(encrypted, user.id),
      token: code,
      epochTolerance: 30,
      afterTimeStep: user.mfaLastStep ?? undefined,
    });
    return result.valid && "timeStep" in result
      ? {
          mfaLastStep: result.timeStep,
          mfaRecoveryHashes: user.mfaRecoveryHashes,
        }
      : null;
  }
  if (setup) return null;
  const recoveryHash = hash(
    `${user.id}:${code.replaceAll("-", "").toLowerCase()}`,
  );
  const index = user.mfaRecoveryHashes.indexOf(recoveryHash);
  return index < 0
    ? null
    : {
        mfaLastStep: user.mfaLastStep,
        mfaRecoveryHashes: user.mfaRecoveryHashes.filter((_, i) => i !== index),
      };
}

export async function completeSecurityChallenge(
  token: string,
  code: string,
  kind: "setup" | "login",
) {
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(challengePredicate(token))
      .for("update");
    if (!user || !challengeIsValid(user) || user.securityChallengeKind !== kind)
      return null;
    const setup = kind === "setup";
    if (
      setup &&
      (user.mfaEnabledAt ||
        !user.mfaPendingExpiresAt ||
        user.mfaPendingExpiresAt <= new Date())
    )
      return null;
    const factor = await checkFactor(user, code, setup);
    if (!factor) {
      await tx
        .update(users)
        .set({ securityChallengeAttempts: user.securityChallengeAttempts + 1 })
        .where(eq(users.id, user.id));
      await recordSecurityEvent(tx, "security.mfa.failed", user);
      return null;
    }
    const now = new Date();
    const recoveryCodes = setup
      ? Array.from({ length: 10 }, () =>
          crypto.randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
        )
      : undefined;
    await tx
      .update(users)
      .set({
        ...factor,
        securityChallengeHash: null,
        securityChallengeKind: null,
        securityChallengeExpiresAt: null,
        ...(setup
          ? {
              mfaEnabledAt: now,
              mfaSecretEncrypted: user.mfaPendingSecretEncrypted,
              mfaPendingSecretEncrypted: null,
              mfaPendingExpiresAt: null,
              mfaRecoveryHashes: recoveryCodes!.map((value) =>
                hash(`${user.id}:${value.replaceAll("-", "")}`),
              ),
              sessionsRevokedAt: now,
            }
          : {}),
      })
      .where(eq(users.id, user.id));
    if (setup)
      await tx
        .update(personalAccessTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(personalAccessTokens.userId, user.id),
            isNull(personalAccessTokens.revokedAt),
          ),
        );
    await recordSecurityEvent(
      tx,
      setup
        ? "security.mfa.enabled"
        : /^\d{6}$/.test(code)
          ? "security.mfa.verified"
          : "security.mfa.recovery_used",
      user,
    );
    return {
      user,
      recoveryCodes,
      mfaVerifiedAt: now.getTime(),
      authTime: now.getTime(),
    };
  });
  if (!result)
    throw new HttpError(
      401,
      "Verification failed or expired. Use a fresh code, or sign in again.",
    );
  logger.info(
    {
      event:
        kind === "setup" ? "security.mfa.enabled" : "security.mfa.verified",
      userId: result.user.id,
    },
    "Account verification completed",
  );
  return result;
}

export async function revokeAccountSessions(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({
        sessionsRevokedAt: new Date(),
        securityChallengeHash: null,
        mfaPendingSecretEncrypted: null,
      })
      .where(activeUser(userId))
      .returning({
        id: users.id,
        defaultOrganizationId: users.defaultOrganizationId,
      });
    await tx
      .update(personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(personalAccessTokens.userId, userId),
          isNull(personalAccessTokens.revokedAt),
        ),
      );
    if (user) await recordSecurityEvent(tx, "security.sessions.revoked", user);
  });
  logger.info(
    { event: "security.sessions.revoked", userId },
    "All account sessions and API tokens revoked",
  );
}
