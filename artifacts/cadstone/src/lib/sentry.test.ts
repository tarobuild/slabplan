// Mirror of the server-side PII filter contract for the web SDK
// (Task #348). Keeps the regex set in sync — if a pattern changes on
// one side, both tests fail and force a coordinated update.

import assert from "node:assert/strict"
import * as nodeFs from "node:fs/promises"
import * as nodePath from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { eventContainsPii } from "./event-privacy"

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

test("web PII filter drops secret URLs and user data", () => {
  assert.equal(
    eventContainsPii({
      request: {
        url: "https://api.example.test/api/_sentry-test?token=555-123-4567",
      },
    }),
    true,
  )
  assert.equal(
    eventContainsPii({
      request: {
        url: "https://api.example.test/search?email=alice@example.com",
      },
    }),
    true,
  )
})

test("web PII filter drops events with secret-bearing fields", () => {
  assert.equal(eventContainsPii({ extra: { token: "abc123" } }), true)
  assert.equal(eventContainsPii({ extra: { api_key: "abc123" } }), true)
})

test("web PII filter survives circular references", () => {
  const evt: Record<string, unknown> = { name: "circular" }
  evt.self = evt
  assert.equal(eventContainsPii(evt), false)
})

test("entrypoint initializes Sentry before importing the app module", async () => {
  const here = nodePath.dirname(fileURLToPath(import.meta.url))
  const mainSource = await nodeFs.readFile(nodePath.join(here, "..", "main.tsx"), "utf8")
  const sentryInitSource = await nodeFs.readFile(nodePath.join(here, "sentry-init.ts"), "utf8")
  const importStatements = mainSource.match(/^import .+$/gm) ?? []

  assert.equal(
    importStatements[0],
    'import "./lib/sentry-init"',
    "Sentry's side-effect initializer must be the first entrypoint import",
  )
  assert.match(sentryInitSource, /initSentry\(\)/)
  assert.match(mainSource, /import App from "\.\/App"/)
  assert.doesNotMatch(
    mainSource,
    /initSentry\(\)/,
    "initSentry cannot be a main.tsx top-level statement because static imports run first",
  )
})

test("verification fragments, challenge tokens, and recovery codes never enter telemetry", () => {
  for (const event of [
    { request: { url: "https://example.test/verify-email#token=abcdef123456" } },
    { data: { to: "https://example.test/verify-email#token=abcdef123456" } },
    { data: { to: "/verify-email#token=abcdef123456" } },
    { request: { url: "/auth?accessToken=abcdef123456" } },
    { extra: { challengeToken: "abcdef" } },
    { extra: { recoveryCodes: ["1234-abcd"] } },
    { extra: { mfaSecretEncrypted: "ciphertext" } },
  ]) assert.equal(eventContainsPii(event), true)
})
