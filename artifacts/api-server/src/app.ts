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
import { readBearerToken } from "./middleware/require-auth";
import { ensureUploadRoot, streamStoredFileToResponse } from "./lib/storage";

const isProd = process.env.NODE_ENV === "production";

const app: Express = express();

app.set("trust proxy", 1);

export async function prepareApp() {
  await ensureUploadRoot();
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
        connectSrc: ["'self'", "wss:", "ws:"],
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
app.use((req, _res, next) => {
  const method = req.method.toUpperCase();

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }

  if (req.get("X-Requested-With") !== "XMLHttpRequest") {
    next(new HttpError(403, "State-changing requests must include X-Requested-With: XMLHttpRequest."));
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

app.use("/api", router);

// Serve the compiled React frontend whenever the build output is present.
// In production the build is always present. In the dev workflow the build
// step also copies the frontend before starting the server, so this works
// for the workspace preview too.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(currentDir, "public");
if (existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      message: err.message,
      details: err.details ?? null,
    });
    return;
  }

  logger.error({ err }, "Unhandled request error");
  res.status(500).json({
    message: "Internal server error",
  });
});

export default app;
