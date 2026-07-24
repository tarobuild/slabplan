import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error The Replit proxy is a runtime .mjs script exercised directly here.
import { resolveExpoPlatform, shouldForceNativeManifest } from "../scripts/replit-expo-proxy.mjs";

test("Replit Expo proxy forces manifest JSON for native root requests", () => {
  assert.equal(
    shouldForceNativeManifest({
      method: "GET",
      url: "/",
      headers: {
        "user-agent": "Expo/55 CFNetwork Darwin",
      },
    }),
    true,
  );

  assert.equal(
    shouldForceNativeManifest({
      method: "GET",
      url: "/",
      headers: {
        accept: "*/*",
      },
    }),
    true,
  );
});

test("Replit Expo proxy leaves browser web preview requests alone", () => {
  assert.equal(
    shouldForceNativeManifest({
      method: "GET",
      url: "/",
      headers: {
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        "user-agent": "Mozilla/5.0",
      },
    }),
    false,
  );

  assert.equal(
    shouldForceNativeManifest({
      method: "GET",
      url: "/?platform=web",
      headers: {
        accept: "*/*",
      },
    }),
    false,
  );
});

test("Replit Expo proxy resolves iOS and Android manifest platforms", () => {
  assert.equal(
    resolveExpoPlatform({
      url: "/?platform=android",
      headers: {},
    }),
    "android",
  );

  assert.equal(
    resolveExpoPlatform({
      url: "/",
      headers: {
        "expo-platform": "ios",
      },
    }),
    "ios",
  );

  assert.equal(
    resolveExpoPlatform({
      url: "/",
      headers: {
        "user-agent": "okhttp Android",
      },
    }),
    "android",
  );
});
