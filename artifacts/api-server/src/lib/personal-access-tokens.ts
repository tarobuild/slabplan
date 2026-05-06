import crypto from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { personalAccessTokens, users, type PersonalAccessToken } from "@workspace/db/schema";
import { HttpError } from "./http";

export const PAT_PREFIX = "cs_pat_";
export const PAT_SCOPES = ["read", "read_write"] as const;
export type PatScope = (typeof PAT_SCOPES)[number];

export type ResolvedPat = {
  type: "pat";
  patId: string;
  patScope: PatScope;
  userId: string;
  email: string;
  role: string;
};

export function isPatToken(token: string): boolean {
  return token.startsWith(PAT_PREFIX);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateRawToken(): { secret: string; prefix: string; lastFour: string; tokenHash: string } {
  // 32 bytes of randomness → 43-char base64url body. Combined with the
  // 7-char prefix `cs_pat_`, the visible token is 50 characters.
  const random = crypto.randomBytes(32).toString("base64url");
  const secret = `${PAT_PREFIX}${random}`;
  const prefix = secret.slice(0, 11);
  const lastFour = secret.slice(-4);
  return { secret, prefix, lastFour, tokenHash: hashToken(secret) };
}

export async function resolvePersonalAccessToken(token: string): Promise<ResolvedPat> {
  if (!isPatToken(token)) {
    throw new HttpError(401, "Invalid or expired token.", undefined, "invalid-token");
  }

  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      id: personalAccessTokens.id,
      userId: personalAccessTokens.userId,
      scope: personalAccessTokens.scope,
      expiresAt: personalAccessTokens.expiresAt,
      revokedAt: personalAccessTokens.revokedAt,
      email: users.email,
      role: users.role,
      userIsActive: users.isActive,
      userDeletedAt: users.deletedAt,
    })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .where(eq(personalAccessTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.userDeletedAt || !row.userIsActive) {
    throw new HttpError(401, "Invalid or expired token.", undefined, "invalid-token");
  }

  if (row.revokedAt) {
    throw new HttpError(401, "This personal access token has been revoked.", undefined, "invalid-token");
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, "This personal access token has expired.", undefined, "invalid-token");
  }

  // Best-effort, non-blocking last_used_at bump. Don't await so that PAT-auth
  // requests don't wait on a write before doing real work.
  void db
    .update(personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalAccessTokens.id, row.id))
    .catch(() => {
      // Swallowed: last-used is informational; never break a request because
      // the bookkeeping write failed.
    });

  const scope: PatScope = row.scope === "read" ? "read" : "read_write";

  return {
    type: "pat",
    patId: row.id,
    patScope: scope,
    userId: row.userId,
    email: row.email,
    role: row.role,
  };
}

export type SafePatRow = Omit<PersonalAccessToken, "tokenHash">;

export async function listPersonalAccessTokens(userId: string): Promise<SafePatRow[]> {
  const rows = await db
    .select({
      id: personalAccessTokens.id,
      userId: personalAccessTokens.userId,
      name: personalAccessTokens.name,
      scope: personalAccessTokens.scope,
      tokenPrefix: personalAccessTokens.tokenPrefix,
      lastFour: personalAccessTokens.lastFour,
      expiresAt: personalAccessTokens.expiresAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      revokedAt: personalAccessTokens.revokedAt,
      createdAt: personalAccessTokens.createdAt,
    })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.userId, userId))
    .orderBy(sql`${personalAccessTokens.createdAt} desc`);

  return rows;
}

export async function revokeToken(userId: string, tokenId: string): Promise<boolean> {
  const result = await db
    .update(personalAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(personalAccessTokens.id, tokenId),
        eq(personalAccessTokens.userId, userId),
        isNull(personalAccessTokens.revokedAt),
      ),
    )
    .returning({ id: personalAccessTokens.id });

  return result.length > 0;
}

async function deleteExpiredOrRevokedOldTokens(): Promise<void> {
  // Housekeeping: drop tokens that have been revoked or expired for >30 days.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db
    .delete(personalAccessTokens)
    .where(
      and(
        or(
          and(sql`${personalAccessTokens.revokedAt} is not null`, sql`${personalAccessTokens.revokedAt} < ${cutoff}`),
          and(sql`${personalAccessTokens.expiresAt} is not null`, sql`${personalAccessTokens.expiresAt} < ${cutoff}`),
        )!,
      ),
    );
}
