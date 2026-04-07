import type { CookieOptions, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { User } from "@workspace/db/schema";
import { HttpError } from "./http";

type TokenType = "access" | "refresh" | "reset";

type TokenClaims = {
  type: TokenType;
  email: string;
  role: string;
};

type VerifiedToken<TType extends TokenType = TokenType> = TokenClaims & {
  type: TType;
  userId: string;
};

type PublicUser = Pick<
  User,
  "id" | "email" | "fullName" | "role" | "avatarUrl" | "phone" | "createdAt" | "updatedAt"
>;

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

const accessSecret =
  process.env.JWT_ACCESS_SECRET ?? "cadstone-dev-access-secret-change-me";
const refreshSecret =
  process.env.JWT_REFRESH_SECRET ?? "cadstone-dev-refresh-secret-change-me";
const resetSecret =
  process.env.JWT_RESET_SECRET ?? "cadstone-dev-reset-secret-change-me";

export const refreshCookieName = "cadstone_refresh_token";

const secureCookies = process.env.NODE_ENV === "production";

const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: secureCookies,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
};

function buildTokenPayload(user: PublicUser, type: TokenType): TokenClaims {
  return {
    type,
    email: user.email,
    role: user.role,
  };
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
    payload = jwt.verify(token, secret);
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

export function signResetToken(user: PublicUser): string {
  return signToken(user, "reset", resetSecret, RESET_TOKEN_TTL_SECONDS);
}

export function verifyAccessToken(token: string): VerifiedToken<"access"> {
  return decodeVerifiedToken(token, accessSecret, "access");
}

export function verifyRefreshToken(token: string): VerifiedToken<"refresh"> {
  return decodeVerifiedToken(token, refreshSecret, "refresh");
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

export function sendAuthResponse(res: Response, user: User): void {
  const publicUser = toPublicUser(user);
  const accessToken = signAccessToken(publicUser);
  const refreshToken = signRefreshToken(publicUser);

  setRefreshTokenCookie(res, refreshToken);

  res.json({
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: publicUser,
  });
}
