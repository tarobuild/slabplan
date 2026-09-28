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

export function resolveSupabaseResumableUploadUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SUPABASE_STORAGE_DIRECT_URL?.trim();
  let url: URL;
  try {
    url = new URL(explicit || getRequiredSupabaseUrl(env));
  } catch {
    throw new Error("A valid Supabase upload URL is required.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (env.NODE_ENV === "production" && url.protocol !== "https:") ||
    url.username || url.password || url.search || url.hash ||
    url.hostname.includes("*")
  ) {
    throw new Error("Supabase upload URLs must use HTTPS in production and cannot contain credentials, query parameters, fragments, or wildcard hosts.");
  }
  if (!explicit && url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
    return url.origin;
  }
  return url.toString().replace(/\/+$/, "");
}

export function supabaseBrowserConnectSources(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.CADSTONE_STORAGE_BACKEND?.trim().toLowerCase() === "local") return [];
  if (!resolveSupabaseUrl(env) && !env.SUPABASE_STORAGE_DIRECT_URL?.trim()) return [];
  return [new URL(resolveSupabaseResumableUploadUrl(env)).origin];
}
