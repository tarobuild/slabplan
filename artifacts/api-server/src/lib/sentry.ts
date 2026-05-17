// Sentry initialization for the API server.
//
// Loaded from src/index.ts BEFORE any module that registers route
// handlers, so async errors raised during module evaluation are still
// captured. Initialization is a no-op (with a warning) when
// `SENTRY_DSN_API` is unset. Sentry is recommended for production, but
// it must not be a hard boot dependency for hosted environments that
// rely on platform logs during early launch.
//
// PII protection lives in the `beforeSend` hook (see ./pii-filter.ts).
// Pino remains the primary structured log; Sentry is purely additive.

import * as Sentry from "@sentry/node";
import { valueContainsPii } from "./pii-filter";
import { APP_MCP_NAME } from "./brand";

let initialized = false;

export function getRelease(): string | undefined {
  // Hosting providers often inject the current Git SHA at build/runtime;
  // fall back to generic release env vars so the same identifier can flow
  // through the source-map upload step on the web.
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.REPLIT_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    process.env.RELEASE_SHA;
  if (!sha) return undefined;
  return sha.slice(0, 12);
}

export function getEnvironment(): string {
  if (process.env.SENTRY_ENVIRONMENT) return process.env.SENTRY_ENVIRONMENT;
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}

export function initSentry(): void {
  if (initialized) return;

  const dsn = process.env.SENTRY_DSN_API?.trim();
  const environment = getEnvironment();

  if (!dsn) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sentry] SENTRY_DSN_API not set — error monitoring is disabled (env=${environment}).`,
    );
    return;
  }

  Sentry.init({
    dsn,
    environment,
    release: getRelease(),
    serverName:
      process.env.RAILWAY_SERVICE_NAME ||
      process.env.REPL_SLUG ||
      process.env.HOSTNAME ||
      `${APP_MCP_NAME}-api`,
    tracesSampleRate: 0.1,
    // Keep request bodies / headers off Sentry by default — the PII
    // filter is a defence-in-depth, not the primary control.
    sendDefaultPii: false,
    beforeSend(event, hint) {
      // Drop any event whose serialized payload contains PII patterns.
      // Tested in test/pii-filter.test.ts.
      if (valueContainsPii({ event, hint })) {
        return null;
      }
      return event;
    },
  });

  initialized = true;
}

export function isSentryInitialized(): boolean {
  return initialized;
}

// Re-export the Sentry namespace so callers don't need to take a direct
// dependency on `@sentry/node` — easier to swap or stub in tests.
export { Sentry };
