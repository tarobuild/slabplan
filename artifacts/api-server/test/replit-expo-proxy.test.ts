import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const testDatabaseUrl = "postgres://cadstone:cadstone@127.0.0.1:5432/cadstone_test";

let appServer: Server;
let metroServer: Server;
let appPort: number;
let metroHitCount = 0;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.DATABASE_URL ??= testDatabaseUrl;

  metroServer = createServer((req, res) => {
    metroHitCount += 1;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        proxied: true,
        url: req.url,
        host: req.headers.host,
      }),
    );
  });
  await new Promise<void>((resolve) => metroServer.listen(0, "127.0.0.1", resolve));
  const metroAddress = metroServer.address() as AddressInfo;
  process.env.CADSTONE_MOBILE_METRO_ORIGIN = `http://127.0.0.1:${metroAddress.port}`;

  const { default: app, prepareApp } = await import("../src/app.ts");
  await prepareApp();

  appServer = app.listen(0);
  await new Promise<void>((resolve) => appServer.once("listening", () => resolve()));
  const appAddress = appServer.address() as AddressInfo;
  appPort = appAddress.port;
});

after(async () => {
  delete process.env.CADSTONE_MOBILE_METRO_ORIGIN;

  await Promise.all([
    appServer
      ? new Promise<void>((resolve, reject) => {
          appServer.close((error) => (error ? reject(error) : resolve()));
        })
      : Promise.resolve(),
    metroServer
      ? new Promise<void>((resolve, reject) => {
          metroServer.close((error) => (error ? reject(error) : resolve()));
        })
      : Promise.resolve(),
  ]);

  const { pool } = await import("@workspace/db");
  await pool.end();
});

test("recognizes Replit Expo preview hosts", async () => {
  const { isReplitExpoPreviewHost } = await import("../src/app.ts");

  assert.equal(
    isReplitExpoPreviewHost("cc18f63a-dbfa-4897-b723-1f269c1f301a-00-3ic234e4ohbyx.expo.kirk.replit.dev"),
    true,
  );
  assert.equal(isReplitExpoPreviewHost("cadstonesystems.com"), false);
});

test("proxies Replit Expo preview requests to the mobile Metro server", async () => {
  const response = await requestWithHost(
    "/?platform=ios&dev=true",
    "cc18f63a-dbfa-4897-b723-1f269c1f301a-00-3ic234e4ohbyx.expo.kirk.replit.dev",
  );

  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"] ?? ""), /application\/json/);

  const body = JSON.parse(response.body) as { proxied: boolean; url: string; host: string };
  assert.equal(body.proxied, true);
  assert.equal(body.url, "/?platform=ios&dev=true");
  assert.match(body.host, /\.expo\.kirk\.replit\.dev$/);
  assert.equal(metroHitCount, 1);
});

function requestWithHost(path: string, host: string) {
  return new Promise<{
    statusCode: number | undefined;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: appPort,
        path,
        method: "GET",
        headers: {
          host,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
