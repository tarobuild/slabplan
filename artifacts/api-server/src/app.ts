import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import pinoHttp from "pino-http";
import { db } from "@workspace/db";
import { files } from "@workspace/db/schema";
import router from "./routes";
import { uploadCookieName, verifyAccessToken, verifyUploadToken } from "./lib/auth";
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
import { ensureUploadRoot, streamStoredFileToResponse } from "./lib/storage";
import { ensureTempUploadDir } from "./lib/uploads";
import { assertActiveAuthUser } from "./lib/active-user";

const isProd = process.env.NODE_ENV === "production";

const app: Express = express();

app.set("trust proxy", 1);

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

app.use((req, _res, next) => {
  const method = req.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
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
    next(new HttpError(403, "State-changing requests must include X-Requested-With: XMLHttpRequest.", undefined, "csrf"));
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
      ? verifyAccessToken(bearerToken)
      : uploadToken
        ? verifyUploadToken(uploadToken)
        : null;

    if (!auth) {
      throw new HttpError(401, "Authentication required.");
    }

    await assertActiveAuthUser(auth);

    const pathname = typeof req.params[0] === "string" ? req.params[0] : "";

    if (!pathname) {
      throw new HttpError(404, "Stored file missing.");
    }

    const fileUrl = `/uploads/${pathname}`;
    await assertCanAccessUploadPath(auth, fileUrl);
    const [storedFile] = await db
      .select({
        originalName: files.originalName,
        mimeType: files.mimeType,
      })
      .from(files)
      .where(eq(files.fileUrl, fileUrl))
      .limit(1);

    if (!storedFile) {
      throw new HttpError(404, "Stored file missing.");
    }

    const safeName = sanitizeDownloadFilename(storedFile.originalName);

    await streamStoredFileToResponse(res, fileUrl, {
      disposition: "attachment",
      filename: safeName,
      contentType: storedFile.mimeType,
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
// In production the build is always present (build:prod runs the cadstone
// vite build and copies its dist into ./public). In development this is a
// no-op: the api-server dev script intentionally skips the cadstone build
// to avoid racing with `check-api-codegen`, and the cadstone vite dev
// server runs as its own workflow to serve the SPA.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(currentDir, "public");
if (existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    sendProblem(res, req, err);
    return;
  }

  sendUnknownErrorProblem(res, req, err);
});

export default app;
