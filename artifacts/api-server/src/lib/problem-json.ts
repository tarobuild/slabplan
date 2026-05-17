import type { Request, Response } from "express";
import { HttpError } from "./http";
import { logger } from "./logger";
import { Sentry, isSentryInitialized } from "./sentry";
import { APP_PROBLEM_TYPE_BASE } from "./brand";

export const PROBLEM_TYPE_BASE = APP_PROBLEM_TYPE_BASE;

const STATUS_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

const DEFAULT_TYPE_BY_STATUS: Record<number, string> = {
  400: "validation",
  401: "unauthorized",
  403: "forbidden",
  404: "not-found",
  405: "method-not-allowed",
  409: "conflict",
  413: "payload-too-large",
  415: "unsupported-media-type",
  422: "validation",
  429: "rate-limited",
  500: "internal-server-error",
  502: "upstream-error",
  503: "service-unavailable",
};

function titleForStatus(status: number): string {
  return STATUS_TITLES[status] ?? "Error";
}

function defaultTypeSlug(status: number): string {
  return DEFAULT_TYPE_BY_STATUS[status] ?? "error";
}

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  // Legacy aliases — many existing API consumers (frontend included) read
  // `message`, so keep it populated for backwards-compatibility.
  message: string;
  // Some clients (and the audit-fixes regression suite) expect a nested
  // `{ error: { message } }` envelope, so emit that alongside the
  // problem-json fields. Cheap to include and keeps callers decoupled
  // from the response shape.
  error: { message: string; type?: string };
  errors?: unknown;
};

export function buildProblem(
  err: HttpError,
  req: Request,
): ProblemDetails {
  const slug = err.type ?? defaultTypeSlug(err.statusCode);
  return {
    type: `${PROBLEM_TYPE_BASE}/${slug}`,
    title: titleForStatus(err.statusCode),
    status: err.statusCode,
    detail: err.message,
    instance: req.originalUrl ?? req.url ?? "",
    message: err.message,
    error: { message: err.message, type: slug },
    errors: err.details ?? undefined,
  };
}

export function sendProblem(
  res: Response,
  req: Request,
  err: HttpError,
): void {
  const body = buildProblem(err, req);
  res
    .status(err.statusCode)
    .type("application/problem+json")
    .json(body);
}

export function sendUnknownErrorProblem(
  res: Response,
  req: Request,
  err: unknown,
): void {
  logger.error({ err }, "Unhandled request error");

  // Forward 5xx-class unhandled errors to Sentry. HttpError 4xx are
  // routed through `sendProblem` instead and are intentionally NOT
  // captured (avoid noise — see Task #348).
  if (isSentryInitialized()) {
    const requestId =
      typeof (req as unknown as { id?: unknown }).id === "string"
        ? ((req as unknown as { id: string }).id)
        : undefined;
    const route =
      (req.route && typeof req.route === "object" && "path" in req.route
        ? String((req.route as { path?: unknown }).path ?? "")
        : null) || (req.originalUrl ?? req.url ?? "").split("?")[0];
    const userId = (req as unknown as { auth?: { userId?: string; role?: string } }).auth?.userId;
    const role = (req as unknown as { auth?: { userId?: string; role?: string } }).auth?.role;

    Sentry.withScope((scope) => {
      if (userId) {
        scope.setUser({ id: userId, ...(role ? { role } : {}) });
      }
      scope.setTag("route", route || "unknown");
      scope.setTag("method", req.method);
      Sentry.captureException(err, {
        extra: {
          requestId,
          route,
          method: req.method,
        },
      });
    });
  }

  const wrapped = new HttpError(500, "Internal server error", undefined, "internal-server-error");
  sendProblem(res, req, wrapped);
}
