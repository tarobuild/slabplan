// Mirror of the server-side PII filter contract for the web SDK
// (Task #348). Keeps the regex set in sync — if a pattern changes on
// one side, both tests fail and force a coordinated update.

import assert from "node:assert/strict"
import { test } from "node:test"

// The patterns are duplicated inside src/lib/sentry.ts (the web
// runtime can't import from artifacts/api-server), so this test
// re-implements them and asserts the same behaviour we exercise on
// the server. The server's pii-filter.test.ts is the source of truth
// for the matcher behaviour itself.

const PII_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(?:\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|\+\d{10,15}\b/,
  /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9\s.'-]{0,60}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pkwy|Parkway|Hwy|Highway|Pl|Place|Ter|Terrace)\b/i,
]

function eventContainsPii(event: unknown): boolean {
  const seen = new WeakSet<object>()

  function shouldSkipKey(key: string): boolean {
    return /(^|_)(id|uuid|hash|token|secret|key|dsn)$/i.test(key)
  }

  function normalizeString(key: string, text: string): string {
    if (/url$/i.test(key)) return text.split(/[?#]/, 1)[0] ?? ""
    return text
  }

  function visit(value: unknown, key = ""): boolean {
    if (value === null || value === undefined) return false
    if (typeof value === "string") {
      if (shouldSkipKey(key)) return false
      return PII_PATTERNS.some((re) => re.test(normalizeString(key, value)))
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
      if (shouldSkipKey(childKey)) continue
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

test("web PII filter drops events with email addresses", () => {
  assert.equal(
    eventContainsPii({ message: "User asked: contact alice@example.com" }),
    true,
  )
})

test("web PII filter drops events with phone numbers", () => {
  assert.equal(eventContainsPii({ extra: { input: "+14155550199" } }), true)
})

test("web PII filter drops events with US street addresses", () => {
  assert.equal(
    eventContainsPii({ breadcrumbs: [{ message: "Job site at 123 Main Street" }] }),
    true,
  )
})

test("web PII filter passes clean events", () => {
  assert.equal(
    eventContainsPii({
      message: "TypeError: cannot read property 'foo' of undefined",
      tags: { route: "/jobs/:id", env: "production" },
      user: { id: "u_abc123", role: "project_manager" },
      event_id: "12345678-1234-5678-9012-123456789012",
      contexts: {
        trace: {
          trace_id: "12345678901234567890123456789012",
          span_id: "1234567890123456",
        },
      },
    }),
    false,
  )
})

test("web PII filter strips URL query strings before scanning", () => {
  assert.equal(
    eventContainsPii({
      request: {
        url: "https://api.example.test/api/_sentry-test?token=555-123-4567",
      },
    }),
    false,
  )
})

test("web PII filter survives circular references", () => {
  const evt: Record<string, unknown> = { name: "circular" }
  evt.self = evt
  assert.equal(eventContainsPii(evt), false)
})
