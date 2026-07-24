const SUPABASE_URL_ENV_KEYS = ["CADSTONE_SUPABASE_URL", "SUPABASE_URL"] as const;

export function resolveSupabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  for (const key of SUPABASE_URL_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }

  return undefined;
}

export function getRequiredSupabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const value = resolveSupabaseUrl(env);
  if (!value) {
    throw new Error("CADSTONE_SUPABASE_URL or SUPABASE_URL is not set.");
  }
  return value;
}
