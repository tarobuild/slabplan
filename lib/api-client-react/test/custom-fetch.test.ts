import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES } from "@workspace/api-zod";

import {
  ApiError,
  customFetch,
  setAuthFailureHandler,
  setAuthRefreshHandler,
  setAuthTokenGetter,
  setBaseUrl,
  setForbiddenHandler,
} from "../src/custom-fetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setAuthFailureHandler(null);
  setAuthRefreshHandler(null);
  setAuthTokenGetter(null);
  setBaseUrl(null);
  setForbiddenHandler(null);
});

function installFetchSpy() {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  return calls;
}

function authHeaderFor(call: { init?: RequestInit }) {
  return new Headers(call.init?.headers).get("authorization");
}

test("customFetch attaches bearer token to relative API URLs", async () => {
  const calls = installFetchSpy();
  setAuthTokenGetter(() => "secret-token");

  await customFetch("/api/users", { method: "GET" });

  assert.equal(authHeaderFor(calls[0]), "Bearer secret-token");
});

test("customFetch attaches bearer token to URLs under the configured base URL", async () => {
  const calls = installFetchSpy();
  setBaseUrl("https://api.cadstone.test");
  setAuthTokenGetter(() => "secret-token");

  await customFetch("/api/users", { method: "GET" });
  await customFetch("https://api.cadstone.test/api/jobs", { method: "GET" });

  assert.equal(authHeaderFor(calls[0]), "Bearer secret-token");
  assert.equal(authHeaderFor(calls[1]), "Bearer secret-token");
});

test("customFetch does not send bearer token to arbitrary absolute URLs", async () => {
  const calls = installFetchSpy();
  setBaseUrl("https://api.cadstone.test");
  setAuthTokenGetter(() => "secret-token");

  await customFetch("https://example.invalid/pixel", { method: "GET" });

  assert.equal(authHeaderFor(calls[0]), null);
});

test("customFetch does not refresh auth for arbitrary absolute URL 401s", async () => {
  let refreshes = 0;
  let failures = 0;
  const calls = installFetchSpy();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ error: "external expired" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  setBaseUrl("https://api.cadstone.test");
  setAuthRefreshHandler(async () => {
    refreshes += 1;
    return "fresh-token";
  });
  setAuthFailureHandler(() => {
    failures += 1;
  });

  await assert.rejects(
    () => customFetch("https://example.invalid/pixel", { method: "GET" }),
    ApiError,
  );

  assert.equal(calls.length, 1);
  assert.equal(refreshes, 0);
  assert.equal(failures, 0);
});

test("customFetch refreshes auth and retries generated-client 401s once", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  setAuthTokenGetter(() => "expired-token");
  setAuthRefreshHandler(async () => "fresh-token");

  const result = await customFetch<{ ok: boolean }>("/api/users", {
    method: "GET",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(authHeaderFor(calls[0]), "Bearer expired-token");
  assert.equal(authHeaderFor(calls[1]), "Bearer fresh-token");
});

test("customFetch replaces an explicit same-origin authorization header after refresh", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  setBaseUrl("https://api.cadstone.test");
  setAuthRefreshHandler(async () => "fresh-token");

  const result = await customFetch<{ ok: boolean }>("/api/users", {
    method: "GET",
    headers: { authorization: "Bearer expired-token" },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(authHeaderFor(calls[0]), "Bearer expired-token");
  assert.equal(authHeaderFor(calls[1]), "Bearer fresh-token");
});

test("customFetch notifies auth failure when generated-client 401 cannot refresh", async () => {
  let failures = 0;
  const calls = installFetchSpy();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ error: "expired" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  setAuthRefreshHandler(async () => null);
  setAuthFailureHandler(() => {
    failures += 1;
  });

  await assert.rejects(
    () => customFetch("/api/users", { method: "GET" }),
    ApiError,
  );

  assert.equal(calls.length, 1);
  assert.equal(failures, 1);
});

test("customFetch does not refresh generated-client auth endpoint 401s", async () => {
  let refreshes = 0;
  const calls = installFetchSpy();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ error: "invalid" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  setAuthRefreshHandler(async () => {
    refreshes += 1;
    return "fresh-token";
  });

  await assert.rejects(
    () => customFetch("/api/auth/login", { method: "POST" }),
    ApiError,
  );

  assert.equal(calls.length, 1);
  assert.equal(refreshes, 0);
});

test("customFetch forwards generated-client 403s to the forbidden handler", async () => {
  const forbidden: Array<{ method: string; url: string }> = [];

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  setForbiddenHandler((context) => {
    forbidden.push(context);
  });

  await assert.rejects(
    () => customFetch("/api/reports/revenue", { method: "GET" }),
    ApiError,
  );

  assert.deepEqual(forbidden, [{ method: "GET", url: "/api/reports/revenue" }]);
});

test("customFetch does not notify forbidden handler for arbitrary absolute URL 403s", async () => {
  const forbidden: Array<{ method: string; url: string }> = [];

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  setBaseUrl("https://api.cadstone.test");
  setForbiddenHandler((context) => {
    forbidden.push(context);
  });

  await assert.rejects(
    () => customFetch("https://example.invalid/pixel", { method: "GET" }),
    ApiError,
  );

  assert.deepEqual(forbidden, []);
});

test("customFetch blocks oversized direct lead attachment multipart before fetch", async () => {
  const calls = installFetchSpy();
  const body = new FormData();
  body.append(
    "files",
    new Blob([new Uint8Array(DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES + 1)], {
      type: "application/pdf",
    }),
    "too-large.pdf",
  );

  await assert.rejects(
    () =>
      customFetch("/api/leads/f8aa285e-d5dc-498d-bbba-4cc22d5d83b5/attachments", {
        method: "POST",
        body,
      }),
    (error) =>
      error instanceof ApiError &&
      error.status === 413 &&
      typeof error.data === "object" &&
      error.data !== null &&
      (error.data as { errors?: { code?: string } }).errors?.code ===
        "LEAD_ATTACHMENT_USE_CHUNKED_UPLOAD",
  );

  assert.equal(calls.length, 0);
});
