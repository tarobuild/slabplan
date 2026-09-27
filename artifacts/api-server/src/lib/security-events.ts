import { db } from "@workspace/db";
import { securityEvents } from "@workspace/db/schema";

type SecurityEvent =
  | "security.email.verified"
  | "security.mfa.enabled"
  | "security.mfa.verified"
  | "security.mfa.failed"
  | "security.mfa.recovery_used"
  | "security.sessions.revoked";

export async function recordSecurityEvent(
  database: Pick<typeof db, "insert">,
  event: SecurityEvent,
  user: { id: string; defaultOrganizationId?: string | null },
): Promise<void> {
  // A narrow schema prevents accidentally persisting credentials or request
  // bodies. Call inside the same transaction as the protected state change.
  await database.insert(securityEvents).values({
    event,
    userId: user.id,
    organizationId: user.defaultOrganizationId ?? null,
  });
}
