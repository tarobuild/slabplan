// Unit tests for the Sentry PII filter (Task #348).
//
// These exercise the pure helpers in src/lib/pii-filter.ts without
// booting the app or touching the network. The Sentry `beforeSend`
// hook delegates to `valueContainsPii(event)` and drops the event
// when it returns true.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  containsPii,
  findPii,
  valueContainsPii,
} from "../src/lib/pii-filter";

test("findPii detects email addresses", () => {
  const match = findPii("contact alice@example.com for details");
  assert.ok(match, "expected a match");
  assert.equal(match?.name, "email");
});

test("findPii detects phone numbers (NANP with separators)", () => {
  for (const phone of ["555-867-5309", "(212) 555-1212", "+1 415 555 0199"]) {
    const match = findPii(`call ${phone}`);
    assert.ok(match, `expected match for ${phone}`);
    assert.equal(match?.name, "phone");
  }
});

test("findPii detects US street addresses", () => {
  const match = findPii("Job site at 123 Main Street, Brooklyn");
  assert.ok(match, "expected match");
  assert.equal(match?.name, "street_address");
});

test("findPii returns null for clean text", () => {
  assert.equal(findPii("Database connection refused"), null);
  assert.equal(findPii("HTTP 500 in /api/jobs/abc-123"), null);
  assert.equal(findPii("user_id=00000000-0000-0000-0000-000000000000"), null);
});

test("containsPii returns true for PII-bearing strings", () => {
  assert.equal(containsPii("Reach me at bob@cadstone.test"), true);
  assert.equal(containsPii("phone +14155550199"), true);
  assert.equal(containsPii("safe error: ECONNRESET"), false);
});

test("valueContainsPii walks nested objects and arrays", () => {
  const event = {
    extra: {
      requestPath: "/api/jobs",
      breadcrumbs: [
        { message: "loaded job" },
        { message: "User reported issue: contact me at carol@example.com" },
      ],
    },
  };
  assert.equal(valueContainsPii(event), true);
});

test("valueContainsPii returns false for clean events", () => {
  const event = {
    message: "Internal server error",
    tags: { route: "/api/jobs/:id", status: 500 },
    user: { id: "u_abc123", role: "project_manager" },
  };
  assert.equal(valueContainsPii(event), false);
});

test("valueContainsPii survives circular references without throwing", () => {
  const event: Record<string, unknown> = { name: "circular" };
  event.self = event;
  assert.equal(valueContainsPii(event), false);
});

test("valueContainsPii drops events with phone numbers in stack frames", () => {
  const event = {
    exception: {
      values: [
        {
          stacktrace: {
            frames: [
              {
                filename: "app.ts",
                vars: { input: "555-123-4567" },
              },
            ],
          },
        },
      ],
    },
  };
  assert.equal(valueContainsPii(event), true);
});
