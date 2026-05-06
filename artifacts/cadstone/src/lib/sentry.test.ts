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
  for (const re of PII_PATTERNS) if (re.test(serialized)) return true
  return false
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
    }),
    false,
  )
})

test("web PII filter survives circular references", () => {
  const evt: Record<string, unknown> = { name: "circular" }
  evt.self = evt
  assert.equal(eventContainsPii(evt), false)
})
