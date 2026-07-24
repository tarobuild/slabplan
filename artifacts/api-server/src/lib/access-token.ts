import { assertActiveAuthUser } from "./active-user";
import { attachOrganizationContext } from "./auth-organization";
import { verifyAccessToken } from "./auth";
import { resolveSupabaseAccessToken, isSupabaseAuthEnabled } from "./supabase-auth";

export async function resolveInteractiveAccessToken(
  token: string,
): Promise<NonNullable<Express.Request["auth"]>> {
  try {
    const auth = verifyAccessToken(token);
    await assertActiveAuthUser(auth);
    return attachOrganizationContext({
      ...auth,
      authProvider: "legacy",
    });
  } catch (legacyError) {
    if (!isSupabaseAuthEnabled()) {
      throw legacyError;
    }

    return attachOrganizationContext(await resolveSupabaseAccessToken(token));
  }
}
