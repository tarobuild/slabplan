import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { HttpError } from "./lib/http";
import { ensureUploadRoot, uploadRoot } from "./lib/storage";

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
app.use("/uploads", express.static(uploadRoot));

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
