const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:21903",
  "http://127.0.0.1:21903",
];

function splitCandidates(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string) {
  const candidate = value.includes("://") ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function collectAllowedOrigins() {
  const origins = new Set<string>();

  for (const value of [
    ...splitCandidates(process.env.CORS_ALLOWED_ORIGINS),
    ...splitCandidates(process.env.APP_ORIGIN),
    ...splitCandidates(process.env.FRONTEND_ORIGIN),
    ...splitCandidates(process.env.PUBLIC_APP_ORIGIN),
    ...splitCandidates(process.env.CUSTOM_DOMAIN_ORIGIN),
    ...splitCandidates(process.env.REPLIT_DEV_DOMAIN),
    ...splitCandidates(process.env.REPLIT_DOMAINS),
  ]) {
    const normalized = normalizeOrigin(value);

    if (normalized) {
      origins.add(normalized);
    }
  }

  if (process.env.NODE_ENV !== "production") {
    for (const origin of LOCAL_DEV_ORIGINS) {
      origins.add(origin);
    }
  }

  return Array.from(origins);
}

export const allowedCorsOrigins = collectAllowedOrigins();

export function isAllowedCorsOrigin(origin: string) {
  const normalized = normalizeOrigin(origin);
  return normalized ? allowedCorsOrigins.includes(normalized) : false;
}

export function corsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) {
  if (!origin) {
    callback(null, true);
    return;
  }

  callback(null, isAllowedCorsOrigin(origin));
}
