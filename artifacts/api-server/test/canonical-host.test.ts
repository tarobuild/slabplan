import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectConfiguredProductionHosts,
  isAllowedProductionHost,
  isCanonicalHostBypassPath,
  normalizeHostHeader,
} from "../src/lib/canonical-host.ts";

test("normalizeHostHeader strips ports from host headers", () => {
  assert.equal(normalizeHostHeader("slabplan.replit.app:443"), "slabplan.replit.app");
  assert.equal(normalizeHostHeader("127.0.0.1:8080"), "127.0.0.1");
  assert.equal(normalizeHostHeader("[::1]:8080"), "::1");
});

test("production canonical host guard allows public canonical hosts", () => {
  assert.equal(
    isAllowedProductionHost(
      "slabplan.replit.app",
      "203.0.113.10",
    ),
    true,
  );
  assert.equal(
    isAllowedProductionHost(
      "www.slabplan.replit.app",
      "203.0.113.10",
    ),
    true,
  );
});

test("production canonical host guard allows configured deployment hosts", () => {
  const env = {
    APP_ORIGIN: "https://slabplan.replit.app",
    REPLIT_DOMAINS: "preview.example.replit.app, other.example.replit.app",
  };

  assert.deepEqual(collectConfiguredProductionHosts(env).sort(), [
    "other.example.replit.app",
    "preview.example.replit.app",
    "slabplan.replit.app",
  ]);
  assert.equal(
    isAllowedProductionHost(
      "slabplan.replit.app",
      "203.0.113.10",
      env,
    ),
    true,
  );
});

test("production canonical host guard allows loopback hosts only from loopback sockets", () => {
  assert.equal(isAllowedProductionHost("127.0.0.1:8080", "::ffff:127.0.0.1"), true);
  assert.equal(isAllowedProductionHost("localhost:8080", "::1"), true);
  assert.equal(isAllowedProductionHost("[::1]:8080", "::1"), true);
  assert.equal(isAllowedProductionHost("127.0.0.1:8080", "203.0.113.10"), false);
});

test("production canonical host guard rejects non-canonical public hosts", () => {
  assert.equal(isAllowedProductionHost("cadstone.example.com", "203.0.113.10"), false);
});

test("production canonical host guard bypasses deployment health probes", () => {
  assert.equal(isCanonicalHostBypassPath("/api/livez"), true);
  assert.equal(isCanonicalHostBypassPath("/api/healthz"), true);
  assert.equal(isCanonicalHostBypassPath("/api/livez/extra"), false);
  assert.equal(isCanonicalHostBypassPath("/api/jobs"), false);
});
