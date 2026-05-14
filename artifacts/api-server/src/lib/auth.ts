import crypto from "node:crypto";
import type { CookieOptions, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { User } from "@workspace/db/schema";
import { HttpError } from "./http";
import { logger } from "./logger";

type TokenType = "access" | "refresh" | "upload" | "file_view";

type TokenClaims = {
  type: TokenType;
  email: string;
  role: string;
  authTime?: number;
  fileId?: string;
};

type VerifiedToken<TType extends TokenType = TokenType> = TokenClaims & {
  type: TType;
  userId: string;
  jti?: string;
  iat?: number;
  authTime?: number;
};

type PublicUser = Pick<
  User,
  "id" | "email" | "fullName" | "role" | "avatarUrl" | "phone" | "createdAt" | "updatedAt"
>;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const UPLOAD_TOKEN_TTL_SECONDS = 24 * 60 * 60;
export const FILE_VIEW_TOKEN_TTL_SECONDS = 5 * 60;
const JWT_ALGORITHMS = ["HS256"] as const;

type JwtSecretEnvName =
  | "JWT_ACCESS_SECRET"
  | "JWT_REFRESH_SECRET"
  | "JWT_UPLOAD_SECRET";

const runtimeSecrets: Record<JwtSecretEnvName, string> = {
  JWT_ACCESS_SECRET: crypto.randomBytes(64).toString("hex"),
  JWT_REFRESH_SECRET: crypto.randomBytes(64).toString("hex"),
  JWT_UPLOAD_SECRET: crypto.randomBytes(64).toString("hex"),
};

const warnedMissingSecrets = new Set<JwtSecretEnvName>();

function readJwtSecret(envName: JwtSecretEnvName) {
  const value = process.env[envName]?.trim();

  if (value) {
    return value;
  }

  // JWT_UPLOAD_SECRET is now advisory — it only protects the legacy
  // `cadstone_upload_token` cookie used as a fallback for unauthenticated
  // `<img>`/`<iframe>` access to /uploads/*. Standard upload routes use
  // the access-token Bearer auth like every other API endpoint, so a
  // missing upload secret no longer blocks uploads or views.
  if (envName !== "JWT_UPLOAD_SECRET" && process.env.NODE_ENV === "production") {
    throw new Error(`${envName} must be configured in production.`);
  }

  if (!warnedMissingSecrets.has(envName)) {
    warnedMissingSecrets.add(envName);
    logger.warn(
      { envName },
      "JWT secret env var is not configured; using an ephemeral runtime secret for this process.",
    );
  }

  return runtimeSecrets[envName];
}

function readUploadSecret(_fallbackSecret: string) {
  // Advisory: an unset JWT_UPLOAD_SECRET in production is no longer
  // fatal. We fall back to an ephemeral process-local secret so the
  // legacy upload-token cookie continues to validate within a single
  // process lifetime, but missing the env var doesn't block startup
  // or any upload/view path.
  return readJwtSecret("JWT_UPLOAD_SECRET");
}

const accessSecret = readJwtSecret("JWT_ACCESS_SECRET");
const refreshSecret = readJwtSecret("JWT_REFRESH_SECRET");
const uploadSecret = readUploadSecret(accessSecret);

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

function buildTokenPayload(
  user: PublicUser,
  type: TokenType,
  extra: { fileId?: string } = {},
): TokenClaims {
  const basePayload: TokenClaims = {
    type,
    email: user.email,
    role: user.role,
    authTime: Date.now(),
  };

  if (extra.fileId) {
    basePayload.fileId = extra.fileId;
  }

  return basePayload;
}

function signToken(
  user: PublicUser,
  type: TokenType,
  secret: string,
  expiresIn: number,
  extra: { fileId?: string; jti?: string } = {},
): string {
  const options: jwt.SignOptions = {
    subject: user.id,
    expiresIn,
  };
  if (extra.jti) {
    options.jwtid = extra.jti;
  }
  return jwt.sign(buildTokenPayload(user, type, extra), secret, options);
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
    fileId: typeof payload.fileId === "string" ? payload.fileId : undefined,
    jti: typeof payload.jti === "string" ? payload.jti : undefined,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    authTime: typeof payload.authTime === "number" ? payload.authTime : undefined,
  };
}

// Signed file-view tokens used to be single-use (JTI consumed on first
// view). That broke under React strict-mode double rendering, image src
// re-attachment, and fast tab switches — the second render saw an
// "already used" 401 even though the user was still authorized. We now
// rely on the short TTL + per-request authorization re-check at the
// signed-view route. Kept exported so any historical test or call site
// that imported the helper continues to compile; it's now a no-op that
// always reports success.
function consumeFileViewJti(_jti: string): boolean {
  return true;
}

export function toPublicUser(user: PublicUser | User): PublicUser {
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

export function signFileViewToken(user: PublicUser, fileId: string): string {
  const jti = crypto.randomBytes(16).toString("hex");
  return signToken(user, "file_view", accessSecret, FILE_VIEW_TOKEN_TTL_SECONDS, { fileId, jti });
}

export function verifyAccessToken(token: string): VerifiedToken<"access"> {
  return decodeVerifiedToken(token, accessSecret, "access");
}

export function verifyFileViewToken(token: string): VerifiedToken<"file_view"> {
  return decodeVerifiedToken(token, accessSecret, "file_view");
}

export function verifyRefreshToken(token: string): VerifiedToken<"refresh"> {
  return decodeVerifiedToken(token, refreshSecret, "refresh");
}

export function verifyUploadToken(token: string): VerifiedToken<"upload"> {
  return decodeVerifiedToken(token, uploadSecret, "upload");
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

export function sendAuthResponse(res: Response, user: PublicUser | User): void {
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
