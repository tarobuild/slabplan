import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  usersPatchUsersId,
  usersPostUsers,
} from "../src/generated/api.ts";
import {
  UsersInviteUserSchemaRole,
  UsersUpdateUserSchemaRole,
} from "../src/generated/api.schemas.ts";

const originalFetch = globalThis.fetch;
const here = path.dirname(fileURLToPath(import.meta.url));
const generatedApiPath = path.resolve(here, "../src/generated/api.ts");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installJsonFetchSpy() {
  const calls: Array<{ input: RequestInfo | URL; headers: Headers }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

test("generated JSON wrappers preserve Headers instances", async () => {
  const calls = installJsonFetchSpy();

  await usersPostUsers(
    {
      email: "worker@example.com",
      fullName: "Worker Example",
      role: UsersInviteUserSchemaRole.crew_member,
    },
    {
      headers: new Headers([
        ["if-match", "etag-1"],
        ["accept-language", "en-US"],
      ]),
    },
  );

  assert.equal(calls[0]?.input.toString(), "/api/users");
  assert.equal(calls[0]?.headers.get("content-type"), "application/json");
  assert.equal(calls[0]?.headers.get("if-match"), "etag-1");
  assert.equal(calls[0]?.headers.get("accept-language"), "en-US");
});

test("generated JSON wrappers preserve tuple headers and caller content-type", async () => {
  const calls = installJsonFetchSpy();

  await usersPatchUsersId(
    "user_123",
    {
      fullName: "Updated Worker",
      role: UsersUpdateUserSchemaRole.project_manager,
      isActive: true,
    },
    {
      headers: [
        ["x-request-id", "request-1"],
        ["content-type", "application/merge-patch+json"],
      ],
    },
  );

  assert.equal(calls[0]?.input.toString(), "/api/users/user_123");
  assert.equal(calls[0]?.headers.get("content-type"), "application/merge-patch+json");
  assert.equal(calls[0]?.headers.get("x-request-id"), "request-1");
});

test("post-codegen rewrites generated JSON wrappers away from object-spread headers", async () => {
  const generatedApi = await readFile(generatedApiPath, "utf8");

  assert.match(
    generatedApi,
    /import \{ customFetch, jsonContentTypeHeaders \} from "\.\.\/custom-fetch";/,
  );
  assert.doesNotMatch(
    generatedApi,
    /headers: \{ "Content-Type": "application\/json", \.\.\.options\?\.headers \},/,
  );
  assert.match(generatedApi, /headers: jsonContentTypeHeaders\(options\?\.headers\),/);
});
