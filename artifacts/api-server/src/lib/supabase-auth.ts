import crypto from "node:crypto";
import jwt, { type JwtHeader, type JwtPayload } from "jsonwebtoken";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { safeUserColumns, users } from "@workspace/db/schema";
import { HttpError } from "./http";
import { logger } from "./logger";
import { resolveSupabaseUrl } from "./supabase-url";

type SupabaseJwtClaims = JwtPayload & {
  sub?: string;
  email?: string;
  role?: string;
  session_id?: string;
};

type Jwk = Record<string, unknown> & {
  kid?: string;
  alg?: string;
};

type JwksCache = {
  expiresAt: number;
  keys: Jwk[];
  url: string;
};

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const HMAC_ALGORITHMS = ["HS256"] as const;
const ASYMMETRIC_ALGORITHMS = ["RS256", "ES256"] as const;

let jwksCache: JwksCache | null = null;

export function isSupabaseAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SUPABASE_AUTH_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function readIssuer(env: NodeJS.ProcessEnv): string {
  const explicit = env.SUPABASE_AUTH_ISSUER?.trim();
  if (explicit) {
    return normalizeUrl(explicit);
  }

  const supabaseUrl = resolveSupabaseUrl(env);
  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_AUTH_ISSUER, CADSTONE_SUPABASE_URL, or SUPABASE_URL must be configured when SUPABASE_AUTH_ENABLED is true.",
    );
  }

  return `${normalizeUrl(supabaseUrl)}/auth/v1`;
}

function readAudience(env: NodeJS.ProcessEnv): string {
  return env.SUPABASE_AUTH_AUDIENCE?.trim() || "authenticated";
}

function readJwksUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.SUPABASE_AUTH_JWKS_URL?.trim();
  if (explicit) {
    return explicit;
  }

  return `${readIssuer(env)}/.well-known/jwks.json`;
}

function decodeHeader(token: string): JwtHeader {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string" || !decoded.header) {
    throw new HttpError(401, "Invalid token payload.");
  }
  return decoded.header;
}

function verifyClaimsShape(payload: string | JwtPayload): SupabaseJwtClaims {
  if (typeof payload === "string") {
    throw new HttpError(401, "Invalid token payload.");
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new HttpError(401, "Invalid token payload.");
  }

  return payload as SupabaseJwtClaims;
}

async function loadJwks(url: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.url === url && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Supabase JWKS request failed with status ${response.status}.`);
  }

  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) {
    throw new Error("Supabase JWKS response did not include a keys array.");
  }

  const keys = body.keys.filter((key): key is Jwk => key !== null && typeof key === "object");
  jwksCache = {
    expiresAt: now + JWKS_CACHE_TTL_MS,
    keys,
    url,
  };
  return keys;
}

async function readVerificationKey(token: string, env: NodeJS.ProcessEnv): Promise<jwt.Secret> {
  const header = decodeHeader(token);
  const algorithm = typeof header.alg === "string" ? header.alg : null;

  if (algorithm && HMAC_ALGORITHMS.includes(algorithm as (typeof HMAC_ALGORITHMS)[number])) {
    const secret = env.SUPABASE_JWT_SECRET?.trim();
    if (!secret) {
      throw new Error("SUPABASE_JWT_SECRET must be configured for HS256 Supabase Auth tokens.");
    }
    return secret;
  }

  if (!algorithm || !ASYMMETRIC_ALGORITHMS.includes(algorithm as (typeof ASYMMETRIC_ALGORITHMS)[number])) {
    throw new HttpError(401, "Invalid token payload.");
  }

  const kid = typeof header.kid === "string" ? header.kid : null;
  if (!kid) {
    throw new HttpError(401, "Invalid token payload.");
  }

  const keys = await loadJwks(readJwksUrl(env));
  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk) {
    throw new HttpError(401, "Invalid token payload.");
  }

  return crypto.createPublicKey({ key: jwk as crypto.webcrypto.JsonWebKey, format: "jwk" });
}

async function verifySupabaseJwt(token: string, env: NodeJS.ProcessEnv): Promise<SupabaseJwtClaims> {
  const key = await readVerificationKey(token, env);

  try {
    const payload = jwt.verify(token, key, {
      algorithms: [...HMAC_ALGORITHMS, ...ASYMMETRIC_ALGORITHMS],
      audience: readAudience(env),
      issuer: readIssuer(env),
    });
    return verifyClaimsShape(payload);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(401, "Invalid or expired token.");
  }
}

export async function resolveSupabaseAccessToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NonNullable<Express.Request["auth"]>> {
  if (!isSupabaseAuthEnabled(env)) {
    throw new HttpError(401, "Supabase Auth is not enabled.");
  }

  let claims: SupabaseJwtClaims;
  try {
    claims = await verifySupabaseJwt(token, env);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      logger.error({ err: error }, "Supabase Auth token verification failed");
      throw new HttpError(401, "Invalid or expired token.");
    }
    throw error;
  }

  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(
      and(
        eq(users.supabaseAuthUserId, claims.sub!),
        eq(users.isActive, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (!user) {
    throw new HttpError(401, "Supabase Auth user is not linked to an active SlabPlan user.");
  }

  return {
    type: "access",
    userId: user.id,
    supabaseAuthUserId: claims.sub,
    email: user.email,
    role: user.role,
    iat: typeof claims.iat === "number" ? claims.iat : undefined,
    authTime: typeof claims.iat === "number" ? claims.iat * 1000 : undefined,
    authProvider: "supabase",
  };
}
