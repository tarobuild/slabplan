// Sentry initialization for the SlabPlan web app.
//
// Initialized in src/main.tsx BEFORE React renders so the
// `Sentry.ErrorBoundary` (and our existing class-based ErrorBoundary)
// see a configured client. Replay is intentionally disabled — it
// captures form data which routinely contains client
// emails, addresses, and phone numbers (PII risk). Performance
// tracing runs at 10% to match the API server.
//
// In development the absence of `SENTRY_DSN_WEB` is a warning and the
// app continues; in production an unset DSN is also a warning (we
// don't want to break the user-facing app over a missing observability
// channel — the server is the boot-blocking side of this contract).

import * as Sentry from "@sentry/react"

// These globals are injected by Vite's `define` config (see
// artifacts/cadstone/vite.config.ts). They're the ONLY Sentry-related
// values the browser bundle is allowed to see — never the
// SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT_WEB used by the
// build-time source-map upload.
declare const __SENTRY_DSN_WEB__: string
declare const __SENTRY_RELEASE__: string
declare const __SENTRY_ENVIRONMENT__: string

let initialized = false

const PII_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|\+\d{10,15}\b/,
  /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9\s.'-]{0,60}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pkwy|Parkway|Hwy|Highway|Pl|Place|Ter|Terrace)\b/i,
]

function eventContainsPii(event: unknown): boolean {
  const seen = new WeakSet<object>()

  function isIdentifierKey(key: string): boolean {
    return /(^|_)(id|uuid|hash)$/i.test(key)
  }

  function isSensitiveKey(key: string): boolean {
    return /(^|_)(token|secret|key|api[_-]?key|dsn|password|credential|authorization)$/i.test(key)
  }

  function urlContainsPii(text: string): boolean {
    try {
      const url = new URL(text)
      for (const [name, rawValue] of url.searchParams.entries()) {
        if (isSensitiveKey(name)) continue
        if (PII_PATTERNS.some((re) => re.test(name) || re.test(rawValue))) return true
      }
      return PII_PATTERNS.some((re) => re.test(`${url.origin}${url.pathname}`))
    } catch {
      return PII_PATTERNS.some((re) => re.test(text))
    }
  }

  function visit(value: unknown, key = ""): boolean {
    if (value === null || value === undefined) return false
    if (typeof value === "string") {
      if (isSensitiveKey(key)) return true
      if (isIdentifierKey(key)) return false
      if (/url$/i.test(key)) return urlContainsPii(value)
      return PII_PATTERNS.some((re) => re.test(value))
    }
    if (typeof value !== "object") return false
    if (seen.has(value as object)) return false
    seen.add(value as object)

    if (value instanceof Error) {
      return PII_PATTERNS.some((re) => re.test(value.message))
    }

    if (Array.isArray(value)) return value.some((item) => visit(item, key))

    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isSensitiveKey(childKey) && childValue !== null && childValue !== undefined) return true
      if (isIdentifierKey(childKey)) continue
      if (visit(childValue, childKey)) return true
    }
    return false
  }

  try {
    return visit(event)
  } catch {
    return true
  }
}

export function initSentry(): void {
  if (initialized) return

  const dsn =
    typeof __SENTRY_DSN_WEB__ === "string" && __SENTRY_DSN_WEB__.trim()
      ? __SENTRY_DSN_WEB__.trim()
      : ""
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.warn(
      "[sentry] SENTRY_DSN_WEB not set — error monitoring is disabled.",
    )
    return
  }

  const release =
    typeof __SENTRY_RELEASE__ === "string" && __SENTRY_RELEASE__
      ? __SENTRY_RELEASE__
      : undefined

  const explicitEnv =
    typeof __SENTRY_ENVIRONMENT__ === "string" && __SENTRY_ENVIRONMENT__
      ? __SENTRY_ENVIRONMENT__
      : ""
  const mode = (
    import.meta as unknown as { env?: { MODE?: string } }
  ).env?.MODE
  const environment =
    explicitEnv || (mode === "production" ? "production" : "development")

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: 0.1,
    // Replay disabled by design — captures form input (PII).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      if (eventContainsPii(event)) {
        return null
      }
      return event
    },
  })

  initialized = true
}

export function setSentryUser(user: { id: string; role?: string } | null): void {
  if (!initialized) return
  if (!user) {
    Sentry.setUser(null)
    return
  }
  // ID + role only — never email or name (PII).
  Sentry.setUser({ id: user.id, ...(user.role ? { role: user.role } : {}) })
}

export { Sentry }
