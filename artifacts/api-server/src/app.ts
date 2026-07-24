import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "node:path";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import pinoHttp from "pino-http";
import { db } from "@workspace/db";
import { files } from "@workspace/db/schema";
import router from "./routes";
import { uploadCookieName, verifyUploadToken } from "./lib/auth";
import { resolveInteractiveAccessToken } from "./lib/access-token";
import { assertCanAccessUploadPath } from "./lib/authorization";
import { corsOrigin } from "./lib/cors";
import { sanitizeDownloadFilename } from "./lib/downloads";
import { logger } from "./lib/logger";
import { HttpError } from "./lib/http";
import { sendProblem, sendUnknownErrorProblem } from "./lib/problem-json";
import { isPatToken } from "./lib/personal-access-tokens";
import { createGlobalApiRateLimit } from "./lib/rate-limit";
import { readBearerToken } from "./middleware/require-auth";
import publicSpecRouter from "./routes/public-spec";
import sentryTestRouter from "./routes/sentry-test";
import stripeWebhookRouter from "./routes/stripe-webhook";
import {
  ensureUploadRoot,
  streamPreparedStoredFileToResponse,
} from "./lib/storage";
import { ensureTempUploadDir } from "./lib/uploads";
import { assertActiveAuthUser } from "./lib/active-user";
import { attachOrganizationContext } from "./lib/auth-organization";
import { CANONICAL_HOST, isAllowedProductionHost } from "./lib/canonical-host";
import { organizationScopeCondition } from "./lib/tenant-scope";

const isProd = process.env.NODE_ENV === "production";

const app: Express = express();

app.set("trust proxy", 1);

const DEFAULT_MOBILE_METRO_PORT = 22477;
const ONE_YEAR_SECONDS = 31_536_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function isReplitExpoPreviewHost(hostHeader: string | undefined): boolean {
  const host = hostHeader?.split(",")[0]?.trim().toLowerCase().split(":")[0] ?? "";
  return host.endsWith(".expo.kirk.replit.dev") || host.endsWith(".expo.replit.dev");
}

function resolveMobileMetroOrigin(): string {
  const configuredOrigin = process.env.CADSTONE_MOBILE_METRO_ORIGIN?.trim();
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, "");
  }

  const configuredPort = process.env.CADSTONE_MOBILE_METRO_PORT?.trim() || String(DEFAULT_MOBILE_METRO_PORT);
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid CADSTONE_MOBILE_METRO_PORT value: "${configuredPort}"`);
  }

  return `http://127.0.0.1:${port}`;
}

export function frontendCacheControlForFile(filePath: string): string {
  const basename = path.basename(filePath);
  if (basename === "index.html") {
    return "no-store, max-age=0, must-revalidate";
  }

  const normalized = filePath.split(path.sep).join("/");
  if (normalized.includes("/assets/")) {
    return `public, max-age=${ONE_YEAR_SECONDS}, immutable`;
  }

  return "no-cache, max-age=0, must-revalidate";
}

app.use((req, res, next) => {
  const forwardedHost = req.get("x-forwarded-host");
  const host = forwardedHost ?? req.get("host");
  if (!isReplitExpoPreviewHost(host)) {
    next();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ error: "Unsupported Expo preview proxy method." });
    return;
  }

  try {
    const targetUrl = new URL(req.originalUrl || "/", resolveMobileMetroOrigin());
    const headers = Object.fromEntries(
      Object.entries(req.headers)
        .filter(([name, value]) => value != null && !HOP_BY_HOP_HEADERS.has(name.toLowerCase()))
        .map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : value]),
    );

    const upstream = httpRequest(targetUrl, {
      method: req.method,
      headers,
    }, (upstreamRes) => {
      res.status(upstreamRes.statusCode ?? 502);
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value != null && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
          res.setHeader(name, value);
        }
      }

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      upstreamRes.pipe(res);
    });

    upstream.on("error", (error) => {
      logger.warn({ err: error }, "Replit Expo preview proxy failed");
      if (!res.headersSent) {
        res.status(502).json({ error: "Expo preview bundler is not reachable." });
      } else {
        res.end();
      }
    });

    upstream.end();
  } catch (error) {
    logger.warn({ err: error }, "Replit Expo preview proxy failed");
    res.status(502).json({ error: "Expo preview bundler is not reachable." });
  }
});

app.use((req, res, next) => {
  if (!isProd) {
    next();
    return;
  }
  if (!CANONICAL_HOST) {
    next();
    return;
  }
  if (req.path === "/api/healthz") {
    next();
    return;
  }
  if (isAllowedProductionHost(req.get("host"), req.socket.remoteAddress)) {
    next();
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    res.redirect(308, `https://${CANONICAL_HOST}${req.originalUrl}`);
    return;
  }
  res.status(404).json({ error: "Not found" });
});

export async function prepareApp() {
  await ensureUploadRoot();
  await ensureTempUploadDir();
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  helmet({
    hsts: false,
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "wss:", "ws:", "blob:"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: isProd
          ? ["'none'"]
          : ["'self'", "https://*.replit.dev", "https://*.kirk.replit.dev", "https://*.repl.co"],
      },
    },
  }),
);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);

// Mount the global IP-based API rate limiter BEFORE the CSRF gate so
// X-RateLimit-* headers appear on EVERY /api response — including 403s
// synthesised by the CSRF gate or 401s from missing auth, not just on
// successful requests. A second per-user limiter is mounted after
// `requireAuth` inside the API router (see routes/index.ts); when both
// fire, the visible headers reflect the stricter (binding) constraint.
app.use("/api", createGlobalApiRateLimit());

// Stripe signs the exact raw JSON bytes. Mount this before the CSRF gate and
// before express.json() so webhook verification is possible.
app.use("/api/billing/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookRouter);

app.use((req, _res, next) => {
  const method = req.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  if (req.path === "/api/internal/run-db-backup") {
    next();
    return;
  }

  // Personal access tokens are an explicit programmatic-access channel that
  // does not depend on the browser's cookie+CSRF model. Skip the
  // X-Requested-With gate for PAT-bearing requests so script/MCP/CLI clients
  // can call the API without faking a browser header.
  const bearer = readBearerToken(req);
  if (bearer && isPatToken(bearer)) {
    next();
    return;
  }

  if (req.get("X-Requested-With") !== "XMLHttpRequest") {
    next(
      new HttpError(
        403,
        "State-changing requests must include X-Requested-With: XMLHttpRequest.",
        {
          code: "CSRF_HEADER_REQUIRED",
          header: "X-Requested-With",
          requiredValue: "XMLHttpRequest",
          retryable: true,
        },
        "csrf",
      ),
    );
    return;
  }

  next();
});
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get(/^\/uploads\/(.+)$/, async (req, res, next) => {
  try {
    const bearerToken = readBearerToken(req);
    const uploadToken = typeof req.cookies?.[uploadCookieName] === "string"
      ? req.cookies[uploadCookieName]
      : null;

    const auth = bearerToken
      ? await resolveInteractiveAccessToken(bearerToken)
      : uploadToken
        ? verifyUploadToken(uploadToken)
        : null;

    if (!auth) {
      throw new HttpError(401, "Authentication required.");
    }

    if (!bearerToken) {
      await assertActiveAuthUser(auth);
    }
    const authWithOrganization = bearerToken
      ? auth
      : await attachOrganizationContext(auth);

    const pathname = typeof req.params[0] === "string" ? req.params[0] : "";

    if (!pathname) {
      throw new HttpError(404, "Stored file missing.");
    }

    const fileUrl = `/uploads/${pathname}`;
    await assertCanAccessUploadPath(authWithOrganization, fileUrl);
    const [storedFile] = await db
      .select({
        originalName: files.originalName,
        mimeType: files.mimeType,
      })
      .from(files)
      .where(
        and(
          eq(files.fileUrl, fileUrl),
          organizationScopeCondition(authWithOrganization, files.organizationId),
        ),
      )
      .limit(1);

    if (!storedFile) {
      throw new HttpError(404, "Stored file missing.");
    }

    const safeName = sanitizeDownloadFilename(storedFile.originalName);

    await streamPreparedStoredFileToResponse(res, fileUrl, {
      disposition: "attachment",
      filename: safeName,
      contentType: storedFile.mimeType,
      rangeHeader: req.headers.range ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// Public, unauthenticated, CORS-friendly endpoints for AI-agent discovery.
// Mounted before the `/api` router so they bypass auth and the CSRF gate above
// (which already lets through GET).
app.use(publicSpecRouter);

// Token-gated Sentry smoke-test endpoint (Task #348). No-op unless
// SENTRY_TEST_TOKEN is set, so it stays inert in production by default.
app.use("/api", sentryTestRouter);

app.use("/api", router);

// Any /api/* path that did not match a router above produces a problem+json
// 404 instead of falling through to the SPA static handler below. This keeps
// the API surface RFC 7807 end-to-end for unknown routes too.
app.use("/api", (req, _res, next) => {
  next(
    new HttpError(
      404,
      `Unknown API endpoint: ${req.method} ${req.originalUrl.split("?")[0]}`,
      undefined,
      "not-found",
    ),
  );
});

// Serve the compiled React frontend whenever the build output is present.
// In production the build is always present (build:prod runs the web
// Vite build and copies its dist into ./public). In development this is a
// no-op: the api-server dev script intentionally skips the web build
// to avoid racing with `check-api-codegen`, and the Vite dev
// server runs as its own workflow to serve the SPA.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(currentDir, "public");
if (existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      res.setHeader("Cache-Control", frontendCacheControlForFile(filePath));
    },
  }));
  app.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", frontendCacheControlForFile("index.html"));
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) {
    return;
  }

  if (err instanceof HttpError) {
    sendProblem(res, req, err);
    return;
  }

  sendUnknownErrorProblem(res, req, err);
});

export default app;
