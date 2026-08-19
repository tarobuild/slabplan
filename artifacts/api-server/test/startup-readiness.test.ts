import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const apiServerDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("startup listener binds before Sentry and application imports", async () => {
  const source = await readFile(
    path.join(apiServerDir, "src", "index.ts"),
    "utf8",
  );

  const listenIndex = source.indexOf("server.listen(port, host, resolve)");
  const sentryIndex = source.indexOf('await import("./lib/sentry")');
  const appIndex = source.indexOf('await import("./app")');

  assert.notEqual(listenIndex, -1);
  assert.notEqual(sentryIndex, -1);
  assert.notEqual(appIndex, -1);
  assert.ok(
    listenIndex < sentryIndex,
    "Sentry must not delay the startup port",
  );
  assert.ok(
    sentryIndex < appIndex,
    "Sentry must initialize before route imports",
  );
});

test("temporary startup handler accepts every Replit health probe", async () => {
  const source = await readFile(
    path.join(apiServerDir, "src", "index.ts"),
    "utf8",
  );
  const handlerStart = source.indexOf("let requestHandler: RequestListener");
  const handlerEnd = source.indexOf(
    "const server = createServer",
    handlerStart,
  );
  const startupHandler = source.slice(handlerStart, handlerEnd);

  assert.match(startupHandler, /pathname === "\/"/);
  assert.match(startupHandler, /pathname === "\/api\/livez"/);
  assert.match(startupHandler, /pathname === "\/api\/healthz"/);
  assert.match(startupHandler, /res\.statusCode = isStartupProbe \? 200 : 503/);
});
