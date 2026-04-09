import crypto from "node:crypto";
import type { CookieOptions, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { User } from "@workspace/db/schema";
import { HttpError } from "./http";

type TokenType = "access" | "refresh" | "reset" | "upload";

type TokenClaims = {
  type: TokenType;
  email: string;
  role: string;
  version?: string;
};

type VerifiedToken<TType extends TokenType = TokenType> = TokenClaims & {
  type: TType;
  userId: string;
};

type PublicUser = Pick<
  User,
  "id" | "email" | "fullName" | "role" | "avatarUrl" | "phone" | "createdAt" | "updatedAt"
>;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const UPLOAD_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const RESET_TOKEN_TTL_SECONDS = 60 * 60;
const JWT_ALGORITHMS = ["HS256"] as const;

type JwtSecretEnvName =
  | "JWT_ACCESS_SECRET"
  | "JWT_REFRESH_SECRET"
  | "JWT_RESET_SECRET"
  | "JWT_UPLOAD_SECRET";

const runtimeSecrets: Record<JwtSecretEnvName, string> = {
  JWT_ACCESS_SECRET: crypto.randomBytes(64).toString("hex"),
  JWT_REFRESH_SECRET: crypto.randomBytes(64).toString("hex"),
  JWT_RESET_SECRET: crypto.randomBytes(64).toString("hex"),
  JWT_UPLOAD_SECRET: crypto.randomBytes(64).toString("hex"),
};

const warnedMissingSecrets = new Set<JwtSecretEnvName>();

function readJwtSecret(envName: JwtSecretEnvName) {
  const value = process.env[envName]?.trim();

  if (value) {
    return value;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${envName} must be configured in production.`);
  }

  if (!warnedMissingSecrets.has(envName)) {
    warnedMissingSecrets.add(envName);
    console.warn(
      "[auth] " + envName + " is not configured; using an ephemeral runtime secret for this process.",
    );
  }

  return runtimeSecrets[envName];
}

const accessSecret = readJwtSecret("JWT_ACCESS_SECRET");
const refreshSecret = readJwtSecret("JWT_REFRESH_SECRET");
const resetSecret = readJwtSecret("JWT_RESET_SECRET");
const uploadSecret = readJwtSecret("JWT_UPLOAD_SECRET");

export const refreshCookieName = "cadstone_refresh_token";
export const uploadCookieName = "cadstone_upload_token";

const secureCookies = process.env.NODE_ENV === "production";

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: secureCookies,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
};

const uploadCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: secureCookies,
  path: "/uploads",
  maxAge: UPLOAD_TOKEN_TTL_SECONDS * 1000,
};

function buildTokenPayload(user: PublicUser, type: TokenType): TokenClaims {
  const basePayload: TokenClaims = {
    type,
    email: user.email,
    role: user.role,
  };

  if (type === "reset") {
    basePayload.version = String(user.updatedAt?.getTime() ?? 0);
  }

  return basePayload;
}

function signToken(
  user: PublicUser,
  type: TokenType,
  secret: string,
  expiresIn: number,
): string {
  return jwt.sign(buildTokenPayload(user, type), secret, {
    subject: user.id,
    expiresIn,
  });
}

function decodeVerifiedToken<TType extends TokenType>(
  token: string,
  secret: string,
  type: TType,
): VerifiedToken<TType> {
  let payload: JwtPayload | string;

  try {
    payload = jwt.verify(token, secret, {
      algorithms: [...JWT_ALGORITHMS],
    });
  } catch {
    throw new HttpError(401, "Invalid or expired token.");
  }

  if (typeof payload === "string") {
    throw new HttpError(401, "Invalid token payload.");
  }

  if (payload.type !== type || typeof payload.sub !== "string") {
    throw new HttpError(401, "Invalid token payload.");
  }

  if (typeof payload.email !== "string" || typeof payload.role !== "string") {
    throw new HttpError(401, "Invalid token payload.");
  }

  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role,
    type: payload.type,
    version: typeof payload.version === "string" ? payload.version : undefined,
  };
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function signAccessToken(user: PublicUser): string {
  return signToken(user, "access", accessSecret, ACCESS_TOKEN_TTL_SECONDS);
}

export function signRefreshToken(user: PublicUser): string {
  return signToken(user, "refresh", refreshSecret, REFRESH_TOKEN_TTL_SECONDS);
}

export function signUploadToken(user: PublicUser): string {
  return signToken(user, "upload", uploadSecret, UPLOAD_TOKEN_TTL_SECONDS);
}

export function signResetToken(user: PublicUser): string {
  return signToken(user, "reset", resetSecret, RESET_TOKEN_TTL_SECONDS);
}

export function verifyAccessToken(token: string): VerifiedToken<"access"> {
  return decodeVerifiedToken(token, accessSecret, "access");
}

export function verifyRefreshToken(token: string): VerifiedToken<"refresh"> {
  return decodeVerifiedToken(token, refreshSecret, "refresh");
}

export function verifyUploadToken(token: string): VerifiedToken<"upload"> {
  return decodeVerifiedToken(token, uploadSecret, "upload");
}

export function verifyResetToken(token: string): VerifiedToken<"reset"> {
  return decodeVerifiedToken(token, resetSecret, "reset");
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(refreshCookieName, token, refreshCookieOptions);
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(refreshCookieName, refreshCookieOptions);
}

export function setUploadTokenCookie(res: Response, token: string): void {
  res.cookie(uploadCookieName, token, uploadCookieOptions);
}

export function clearUploadTokenCookie(res: Response): void {
  res.clearCookie(uploadCookieName, uploadCookieOptions);
}

export function sendAuthResponse(res: Response, user: User): void {
  const publicUser = toPublicUser(user);
  const accessToken = signAccessToken(publicUser);
  const refreshToken = signRefreshToken(publicUser);
  const uploadToken = signUploadToken(publicUser);

  setRefreshTokenCookie(res, refreshToken);
  setUploadTokenCookie(res, uploadToken);

  res.json({
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: publicUser,
  });
}
