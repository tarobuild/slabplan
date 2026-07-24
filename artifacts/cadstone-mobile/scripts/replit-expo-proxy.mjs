#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_PUBLIC_PORT = 22477;

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getHeader(headers, name) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : (value ?? "");
}

export function resolveExpoPlatform({ url, headers }) {
  const requestUrl = new URL(url, "http://replit.local");
  const queryPlatform = requestUrl.searchParams.get("platform");
  if (queryPlatform === "ios" || queryPlatform === "android") {
    return queryPlatform;
  }

  const headerPlatform = getHeader(headers, "expo-platform").toLowerCase();
  if (headerPlatform === "ios" || headerPlatform === "android") {
    return headerPlatform;
  }

  const userAgent = getHeader(headers, "user-agent").toLowerCase();
  if (userAgent.includes("android")) return "android";
  return "ios";
}

export function shouldForceNativeManifest({ method = "GET", url, headers }) {
  if (method !== "GET") return false;

  const requestUrl = new URL(url, "http://replit.local");
  if (requestUrl.pathname !== "/") return false;
  if (requestUrl.searchParams.get("platform") === "web") return false;

  const hasExpoHeader =
    getHeader(headers, "expo-platform") ||
    getHeader(headers, "expo-protocol-version") ||
    getHeader(headers, "expo-updates-environment");
  if (hasExpoHeader) return true;

  const accept = getHeader(headers, "accept").toLowerCase();
  if (accept.includes("application/expo+json")) return true;

  const userAgent = getHeader(headers, "user-agent").toLowerCase();
  const secFetchMode = getHeader(headers, "sec-fetch-mode").toLowerCase();
  const looksLikeBrowser =
    userAgent.includes("mozilla") ||
    secFetchMode === "navigate" ||
    accept.includes("text/html");

  return !looksLikeBrowser;
}

function startMetro({ metroPort, publicPort }) {
  const childEnv = {
    ...process.env,
    BROWSER: "none",
    EXPO_NO_TELEMETRY: "1",
    PORT: String(metroPort),
  };

  const child = spawn(
    "pnpm",
    ["exec", "expo", "start", "--clear", "--port", String(metroPort)],
    {
      env: childEnv,
      stdio: "inherit",
    },
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Expo Metro exited with signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  console.log(
    `Replit Expo proxy listening on ${publicPort} and forwarding to Metro ${metroPort}`,
  );
}

function proxyRequest({ req, res, metroPort }) {
  const target = new URL(req.url ?? "/", `http://127.0.0.1:${metroPort}`);
  const headers = { ...req.headers };

  if (
    shouldForceNativeManifest({
      method: req.method,
      url: req.url ?? "/",
      headers: req.headers,
    })
  ) {
    const platform = resolveExpoPlatform({
      url: req.url ?? "/",
      headers: req.headers,
    });

    target.searchParams.set("platform", platform);
    target.searchParams.set("dev", target.searchParams.get("dev") ?? "true");
    target.searchParams.set(
      "minify",
      target.searchParams.get("minify") ?? "false",
    );
    headers.accept = "application/expo+json,application/json";
    headers["expo-platform"] = platform;
    headers["expo-protocol-version"] = "1";
    headers["expo-updates-environment"] = "EXPO_GO";
  }

  headers.host = `127.0.0.1:${metroPort}`;

  const upstream = httpRequest(
    target,
    {
      method: req.method,
      headers,
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Expo Metro is starting: ${error.message}`);
  });

  req.pipe(upstream);
}

export function startProxy({
  publicPort = parsePort(process.env.PORT, DEFAULT_PUBLIC_PORT),
  metroPort = parsePort(
    process.env.EXPO_METRO_PORT,
    publicPort === DEFAULT_PUBLIC_PORT ? 22478 : publicPort + 1,
  ),
} = {}) {
  startMetro({ metroPort, publicPort });

  const server = createServer((req, res) => {
    proxyRequest({ req, res, metroPort });
  });

  server.listen(publicPort, "0.0.0.0");
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProxy();
}
