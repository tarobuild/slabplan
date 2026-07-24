import { and, eq, isNull } from "drizzle-orm";
import type { Response as ExpressResponse } from "express";
import { db } from "@workspace/db";
import { safeUserColumns, users, type User } from "@workspace/db/schema";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  setRefreshTokenCookie,
  setUploadTokenCookie,
  signUploadToken,
  toPublicUser,
} from "./auth";
import { HttpError } from "./http";
import { resolveSupabaseUrl } from "./supabase-url";

type SupabaseSessionUser = {
  id?: unknown;
  email?: unknown;
};

type SupabaseSessionResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  user?: SupabaseSessionUser;
};

type SupabaseAdminUserResponse = {
  id?: unknown;
  email?: unknown;
};

type LocalUser = Pick<
  User,
  "id" | "email" | "fullName" | "role" | "avatarUrl" | "phone" | "createdAt" | "updatedAt"
>;

export function isSupabasePasswordLoginEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.SUPABASE_AUTH_LOGIN_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function readSupabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = resolveSupabaseUrl(env);
  if (!value) {
    throw new Error(
      "CADSTONE_SUPABASE_URL or SUPABASE_URL must be configured when Supabase Auth login is enabled.",
    );
  }
  return normalizeUrl(value);
}

function readServiceRoleKey(env: NodeJS.ProcessEnv): string {
  const value = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must be configured for Supabase Auth admin operations.",
    );
  }
  return value;
}

function readAuthApiKey(env: NodeJS.ProcessEnv): string {
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (anonKey) {
    return anonKey;
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRoleKey) {
    return serviceRoleKey;
  }

  throw new Error(
    "SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY must be configured when Supabase Auth login is enabled.",
  );
}

function authHeaders(env: NodeJS.ProcessEnv, accessToken?: string) {
  const apiKey = readAuthApiKey(env);
  return {
    apikey: apiKey,
    authorization: `Bearer ${accessToken || apiKey}`,
    "content-type": "application/json",
  };
}

function serviceRoleHeaders(env: NodeJS.ProcessEnv) {
  const serviceRoleKey = readServiceRoleKey(env);
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

function tokenEndpoint(env: NodeJS.ProcessEnv, grantType: "password" | "refresh_token") {
  return `${readSupabaseUrl(env)}/auth/v1/token?grant_type=${grantType}`;
}

function assertSupabaseSession(body: SupabaseSessionResponse): {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  supabaseUserId: string;
  email: string;
} {
  if (
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string" ||
    typeof body.user?.id !== "string" ||
    typeof body.user?.email !== "string"
  ) {
    throw new HttpError(401, "Supabase Auth did not return a valid session.");
  }

  return {
    accessToken: body.access_token,
    expiresIn:
      typeof body.expires_in === "number"
        ? body.expires_in
        : ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: body.refresh_token,
    supabaseUserId: body.user.id,
    email: body.user.email.trim().toLowerCase(),
  };
}

async function readSupabaseError(response: globalThis.Response): Promise<string> {
  try {
    const body = (await response.json()) as { msg?: unknown; message?: unknown; error_description?: unknown };
    const message = body.msg || body.message || body.error_description;
    return typeof message === "string" && message.trim()
      ? message
      : "Supabase Auth request failed.";
  } catch {
    return "Supabase Auth request failed.";
  }
}

async function requestSupabaseSession(
  url: string,
  payload: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Promise<ReturnType<typeof assertSupabaseSession>> {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new HttpError(401, "Invalid email or password.");
    }
    throw new Error(await readSupabaseError(response));
  }

  return assertSupabaseSession((await response.json()) as SupabaseSessionResponse);
}

async function findLinkedUser(supabaseUserId: string) {
  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(
      and(
        eq(users.supabaseAuthUserId, supabaseUserId),
        eq(users.isActive, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  return user ?? null;
}

async function linkLocalUserByEmail(email: string, supabaseUserId: string) {
  const now = new Date();
  const [user] = await db
    .update(users)
    .set({ supabaseAuthUserId: supabaseUserId, updatedAt: now })
    .where(
      and(
        eq(users.email, email),
        eq(users.isActive, true),
        isNull(users.deletedAt),
      ),
    )
    .returning(safeUserColumns);

  return user ?? null;
}

async function resolveLocalUserForSupabaseSession(session: {
  email: string;
  supabaseUserId: string;
}): Promise<LocalUser> {
  const linked = await findLinkedUser(session.supabaseUserId);
  if (linked) {
    return linked;
  }

  const linkedByEmail = await linkLocalUserByEmail(session.email, session.supabaseUserId);
  if (linkedByEmail) {
    return linkedByEmail;
  }

  throw new HttpError(401, "Supabase Auth user is not linked to an active SlabPlan user.");
}

export async function signInWithSupabasePassword(
  email: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; user: LocalUser }> {
  const session = await requestSupabaseSession(
    tokenEndpoint(env, "password"),
    { email, password },
    env,
  );
  const user = await resolveLocalUserForSupabaseSession(session);
  return { ...session, user };
}

export async function refreshSupabaseSession(
  refreshToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; user: LocalUser }> {
  const session = await requestSupabaseSession(
    tokenEndpoint(env, "refresh_token"),
    { refresh_token: refreshToken },
    env,
  );
  const user = await resolveLocalUserForSupabaseSession(session);
  return { ...session, user };
}

export async function revokeSupabaseSession(
  accessToken: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!accessToken) {
    return;
  }

  const response = await fetch(`${readSupabaseUrl(env)}/auth/v1/logout`, {
    method: "POST",
    headers: authHeaders(env, accessToken),
  });

  if (!response.ok && response.status !== 401) {
    throw new Error(await readSupabaseError(response));
  }
}

export async function updateSupabaseAuthUser(
  supabaseAuthUserId: string,
  body: {
    email?: string;
    email_confirm?: boolean;
    password?: string;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const response = await fetch(
    `${readSupabaseUrl(env)}/auth/v1/admin/users/${encodeURIComponent(supabaseAuthUserId)}`,
    {
      method: "PUT",
      headers: serviceRoleHeaders(env),
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(await readSupabaseError(response));
  }
}

export async function createSupabaseAuthUser(
  body: {
    email: string;
    password: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ id: string; email: string | null }> {
  const response = await fetch(`${readSupabaseUrl(env)}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceRoleHeaders(env),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readSupabaseError(response));
  }

  const created = (await response.json()) as SupabaseAdminUserResponse;
  if (typeof created.id !== "string") {
    throw new Error("Supabase Auth did not return a user id.");
  }

  return {
    id: created.id,
    email: typeof created.email === "string" ? created.email : null,
  };
}

export function sendSupabaseAuthResponse(
  res: ExpressResponse,
  session: { accessToken: string; expiresIn: number; refreshToken: string; user: LocalUser },
  options: { includeRefreshToken?: boolean } = {},
): void {
  const publicUser = toPublicUser(session.user);
  setRefreshTokenCookie(res, session.refreshToken);
  setUploadTokenCookie(res, signUploadToken(publicUser));

  res.json({
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    ...(options.includeRefreshToken ? { refreshToken: session.refreshToken } : {}),
    user: publicUser,
  });
}
