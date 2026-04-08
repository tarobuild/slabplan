import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { verifyAccessToken, verifyRefreshToken, uploadCookieName } from "./lib/auth";
import { assertCanAccessUploadPath } from "./lib/authorization";
import { logger } from "./lib/logger";
import { HttpError } from "./lib/http";
import { readBearerToken } from "./middleware/require-auth";
import { ensureUploadRoot, resolveAbsolutePathFromFileUrl } from "./lib/storage";

const app: Express = express();

void ensureUploadRoot();

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
  cors({
    origin: true,
    credentials: true,
  }),
);
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
        ? {
            ...verifyRefreshToken(uploadToken),
            type: "access" as const,
          }
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
    const absolutePath = resolveAbsolutePathFromFileUrl(fileUrl);

    res.sendFile(absolutePath, (error) => {
      if (!error) {
        return;
      }

      if ("statusCode" in error && error.statusCode === 404) {
        next(new HttpError(404, "Stored file missing."));
        return;
      }

      next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", router);

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
