import { assertActiveAuthUser } from "./active-user";
import { attachOrganizationContext } from "./auth-organization";
import { verifyAccessToken } from "./auth";
import { resolveSupabaseAccessToken, isSupabaseAuthEnabled } from "./supabase-auth";
import { assertInteractiveSecurity, readSecurityUser } from "./account-security";
import { HttpError } from "./http";

export async function resolveInteractiveAccessToken(
  token: string,
): Promise<NonNullable<Express.Request["auth"]>> {
  try {
    const auth = verifyAccessToken(token);
    await assertActiveAuthUser(auth);
    await assertInteractiveSecurity(auth);
    return attachOrganizationContext({
      ...auth,
      authProvider: "legacy",
    });
  } catch (legacyError) {
    if (!isSupabaseAuthEnabled()) {
      throw legacyError;
    }

    const auth = await resolveSupabaseAccessToken(token);
    if ((await readSecurityUser(auth.userId)).sessionsRevokedAt) throw new HttpError(401, "Sign in again to continue.");
    await assertActiveAuthUser(auth);
    await assertInteractiveSecurity(auth);
    return attachOrganizationContext(auth);
  }
}
