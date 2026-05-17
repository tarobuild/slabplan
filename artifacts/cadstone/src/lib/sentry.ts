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
  let serialized: string
  try {
    const seen = new WeakSet<object>()
    serialized = JSON.stringify(event, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v as object)) return "[Circular]"
        seen.add(v as object)
      }
      return v
    })
  } catch {
    return true
  }
  if (!serialized) return false
  for (const re of PII_PATTERNS) {
    if (re.test(serialized)) return true
  }
  return false
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
