export const DEFAULT_CANONICAL_HOST =
  "slabplan-api-production.up.railway.app";
export const CANONICAL_HOST =
  process.env.CANONICAL_HOST?.trim().toLowerCase() || DEFAULT_CANONICAL_HOST;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const CONFIGURED_HOST_ENV_KEYS = [
  "CANONICAL_HOST",
  "APP_PUBLIC_URL",
  "APP_ORIGIN",
  "FRONTEND_ORIGIN",
  "PUBLIC_APP_ORIGIN",
  "CUSTOM_DOMAIN_ORIGIN",
  "REPLIT_DOMAINS",
  "RAILWAY_PUBLIC_DOMAIN",
  "RAILWAY_STATIC_URL",
];

export function normalizeHostHeader(hostHeader: string | undefined): string {
  const raw = hostHeader?.trim().toLowerCase() ?? "";
  if (!raw) return "";

  if (raw.startsWith("[")) {
    const closingBracket = raw.indexOf("]");
    return closingBracket > 0 ? raw.slice(1, closingBracket) : raw;
  }

  return raw.split(":")[0] ?? raw;
}

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  const normalized = remoteAddress?.replace(/^::ffff:/, "") ?? "";
  return LOOPBACK_HOSTS.has(normalized);
}

function splitCandidates(value: string | undefined) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function normalizeOriginHost(value: string): string | null {
  const candidate = value.includes("://") ? value : `https://${value}`;

  try {
    return new URL(candidate).host.toLowerCase().split(":")[0] ?? null;
  } catch {
    return null;
  }
}

export function collectConfiguredProductionHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const hosts = new Set<string>();

  for (const key of CONFIGURED_HOST_ENV_KEYS) {
    for (const value of splitCandidates(env[key])) {
      const host = normalizeOriginHost(value);
      if (host) hosts.add(host);
    }
  }

  return Array.from(hosts);
}

export function isAllowedProductionHost(
  hostHeader: string | undefined,
  remoteAddress: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const host = normalizeHostHeader(hostHeader);
  const canonicalHost =
    env.CANONICAL_HOST?.trim().toLowerCase() || DEFAULT_CANONICAL_HOST;

  if (
    host === canonicalHost ||
    host === `www.${canonicalHost}`
  ) {
    return true;
  }

  if (collectConfiguredProductionHosts(env).includes(host) && !LOOPBACK_HOSTS.has(host)) {
    return true;
  }

  return LOOPBACK_HOSTS.has(host) && isLoopbackAddress(remoteAddress);
}
