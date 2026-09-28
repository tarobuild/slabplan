import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import helmet from "helmet";
import { resolveSupabaseResumableUploadUrl, supabaseBrowserConnectSources } from "../src/lib/supabase-url";

const source = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

test("production responses enable HSTS while local development remains unaffected", () => {
  assert.match(source, /hsts: isProd/);
  assert.match(source, /maxAge: 31_536_000/);
  assert.match(source, /includeSubDomains: false/);
});

test("the application CSP uses the same exact host as signed direct uploads", async () => {
  assert.match(source, /connectSrc:.*\.\.\.supabaseBrowserConnectSources\(\)/);
  const env = { NODE_ENV: "production", SUPABASE_URL: "https://upload-project.supabase.co" };
  const endpoint = resolveSupabaseResumableUploadUrl(env);
  assert.equal(endpoint, "https://upload-project.storage.supabase.co");
  const app = express();
  app.use(helmet({ contentSecurityPolicy: { directives: { connectSrc: ["'self'", ...supabaseBrowserConnectSources(env)] } } }));
  app.get("/", (_req, res) => res.send("ok"));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    assert.equal(response.status, 200);
    const connect = response.headers.get("content-security-policy")?.split(";").find((directive) => directive.startsWith("connect-src "));
    assert.equal(connect, `connect-src 'self' ${new URL(endpoint).origin}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("custom and already-direct storage URLs share exact CSP origins without broad provider wildcards", () => {
  for (const env of [
    { NODE_ENV: "production", SUPABASE_URL: "https://upload-project.storage.supabase.co/" },
    { NODE_ENV: "production", CADSTONE_SUPABASE_URL: "https://legacy-project.supabase.co", SUPABASE_URL: "https://ignored-project.supabase.co" },
    { NODE_ENV: "production", SUPABASE_URL: "https://storage.example.test/prefix/" },
    { NODE_ENV: "production", SUPABASE_URL: "https://upload-project.supabase.co", SUPABASE_STORAGE_DIRECT_URL: "https://uploads.example.test/prefix/" },
  ]) {
    const sources = supabaseBrowserConnectSources(env);
    assert.deepEqual(sources, [new URL(resolveSupabaseResumableUploadUrl(env)).origin]);
    assert.equal(sources.length, 1);
    assert.ok(!sources[0].includes("*"));
  }
  assert.deepEqual(supabaseBrowserConnectSources({ CADSTONE_SUPABASE_URL: "https://legacy-project.supabase.co", SUPABASE_URL: "https://ignored-project.supabase.co" }), ["https://legacy-project.storage.supabase.co"]);
  assert.deepEqual(supabaseBrowserConnectSources({ SUPABASE_STORAGE_DIRECT_URL: "https://uploads.example.test/prefix/" }), ["https://uploads.example.test"]);
});

test("local storage does not add remote origins and development HTTP endpoints remain supported", () => {
  assert.deepEqual(supabaseBrowserConnectSources({ CADSTONE_STORAGE_BACKEND: "local", SUPABASE_URL: "https://ignored.supabase.co" }), []);
  assert.deepEqual(supabaseBrowserConnectSources({}), []);
  assert.deepEqual(supabaseBrowserConnectSources({ NODE_ENV: "test", SUPABASE_URL: "http://127.0.0.1:54321" }), ["http://127.0.0.1:54321"]);
});

test("production storage configuration cannot inject unsafe CSP sources or expose URL secrets", () => {
  for (const url of [
    "http://upload-project.supabase.co",
    "https://user:secret@example.test",
    "https://example.test?token=secret",
    "https://example.test#fragment",
    "https://*.supabase.co",
    "data:text/plain,test",
    "not a URL",
  ]) {
    assert.throws(() => supabaseBrowserConnectSources({ NODE_ENV: "production", SUPABASE_STORAGE_DIRECT_URL: url }), /Supabase upload URL/);
  }
});
