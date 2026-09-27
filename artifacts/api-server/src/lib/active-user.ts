import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { HttpError } from "./http";

export async function assertActiveUserById(userId: string) {
  const [user] = await db
    .select({ id: users.id, passwordSetAt: users.passwordSetAt, sessionsRevokedAt: users.sessionsRevokedAt, emailVerificationRequired: users.emailVerificationRequired, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw new HttpError(401, "Authentication required.", undefined, "unauthorized");
  }

  return user;
}

export async function assertActiveAuthUser(auth: { userId: string; iat?: number; authTime?: number }) {
  const user = await assertActiveUserById(auth.userId);

  if (user.emailVerificationRequired && !user.emailVerifiedAt) {
    throw new HttpError(401, "Verify your email before signing in.", undefined, "email-verification-required");
  }
  const revokedBefore = Math.max(user.passwordSetAt?.getTime() ?? 0, user.sessionsRevokedAt?.getTime() ?? 0);
  if (!revokedBefore) {
    return;
  }

  const issuedAtMs =
    typeof auth.authTime === "number"
      ? auth.authTime
      : typeof auth.iat === "number"
        ? auth.iat * 1000
        : null;

  if (issuedAtMs === null) {
    throw new HttpError(401, "Authentication required.", undefined, "unauthorized");
  }

  if (issuedAtMs < revokedBefore) {
    throw new HttpError(
      401,
      "Your session has expired. Sign in again.",
      undefined,
      "session-expired",
    );
  }
}
