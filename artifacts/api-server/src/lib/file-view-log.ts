import type { ErrorRequestHandler, Request } from "express";
import { HttpError } from "./http";
import { logger } from "./logger";
import type {
  StreamStoredFileProgress,
  StreamStoredFileResult,
} from "./storage";

/**
 * Stable child logger for file-view events. Operators filter on
 * `name=file-view` (or on the `event` field directly) to investigate
 * "user can't open the file" reports the same way they filter on
 * `upload.fail` for upload incidents.
 */
const viewLogger = logger.child({ name: "file-view" });

export interface FileViewContext {
  /** Express route pattern, e.g. `/api/files/:id/view`. */
  route: string;
  /** Database id of the file the user tried to open. */
  fileId: string;
  /**
   * Requester id (cookie- or signed-token-derived) when known, or `null`
   * when the request failed before authentication resolved.
   */
  requesterId: string | null;
}

export function logFileViewSuccess(
  ctx: FileViewContext,
  bytes: number,
): void {
  viewLogger.info(
    {
      event: "view.success",
      route: ctx.route,
      fileId: ctx.fileId,
      requesterId: ctx.requesterId,
      bytes,
    },
    "view.success",
  );
}

export function logFileViewFailure(
  ctx: FileViewContext,
  err: unknown,
  bytes: number,
): void {
  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const reason = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof HttpError &&
    typeof err.details === "object" &&
    err.details !== null
      ? ((err.details as Record<string, unknown>).code as string | undefined) ??
        null
      : null;
  viewLogger.warn(
    {
      event: "view.fail",
      route: ctx.route,
      fileId: ctx.fileId,
      requesterId: ctx.requesterId,
      statusCode,
      code,
      reason,
      bytes,
    },
    "view.fail",
  );
}

/**
 * Sentinel reason emitted on view.fail when the response socket closed
 * before the storage read stream finished. Used so dashboards can distinguish
 * "user navigated away from a slow PDF" from a real backend failure.
 */
export const VIEW_FAIL_REASON_CLIENT_ABORTED = "client_aborted";

class FileViewClientAbortError extends Error {
  constructor(bytesStreamed: number) {
    super(
      `${VIEW_FAIL_REASON_CLIENT_ABORTED}: connection closed after ${bytesStreamed} bytes`,
    );
    this.name = "FileViewClientAbortError";
  }
}

/**
 * Wrap a file-view handler so every request emits exactly one
 * `view.success` or `view.fail` line.
 *
 * The wrapped function receives a mutable {@link StreamStoredFileProgress}
 * counter that it threads into {@link streamStoredFileToResponse}. This
 * lets the failure path report partial bytes streamed when storage errors
 * mid-transfer or when the client disconnects before the stream
 * finishes.
 *
 * `getRequesterId` is invoked lazily so routes that authenticate
 * mid-handler (e.g. the signed-token route) can report the resolved
 * requester id once it is known, even on failures that happen later in
 * the handler.
 *
 * Client aborts (response closed before stream end) are reclassified as
 * `view.fail` with reason `client_aborted`; the abort is *not* re-thrown
 * because there is no live response left to send an error to.
 */
/**
 * Marker placed on `req` once a route handler has handed control to
 * {@link withFileViewLogging}. Read by {@link fileViewErrorLogger} so a
 * failure that originates inside the wrapped function does not get
 * double-logged by the catch-all error middleware below.
 */
const FILE_VIEW_LOGGED = Symbol.for("cadstone.fileViewLogged");

type RequestWithViewFlag = Request & { [FILE_VIEW_LOGGED]?: boolean };

export function markFileViewLogged(req: Request): void {
  (req as RequestWithViewFlag)[FILE_VIEW_LOGGED] = true;
}

export function isFileViewLogged(req: Request): boolean {
  return (req as RequestWithViewFlag)[FILE_VIEW_LOGGED] === true;
}

export async function withFileViewLogging(
  req: Request,
  ctx: { route: string; fileId: string; getRequesterId: () => string | null },
  run: (
    progress: StreamStoredFileProgress,
  ) => Promise<StreamStoredFileResult>,
): Promise<void> {
  // Mark the request immediately so any error thrown during `run` is
  // attributed here and not re-logged by the pre-route error middleware.
  markFileViewLogged(req);
  const progress: StreamStoredFileProgress = { bytesStreamed: 0 };
  try {
    const result = await run(progress);
    const finalBytes = result.bytesStreamed;
    if (result.aborted) {
      logFileViewFailure(
        {
          route: ctx.route,
          fileId: ctx.fileId,
          requesterId: ctx.getRequesterId(),
        },
        new FileViewClientAbortError(finalBytes),
        finalBytes,
      );
      return;
    }
    logFileViewSuccess(
      {
        route: ctx.route,
        fileId: ctx.fileId,
        requesterId: ctx.getRequesterId(),
      },
      finalBytes,
    );
  } catch (err) {
    logFileViewFailure(
      {
        route: ctx.route,
        fileId: ctx.fileId,
        requesterId: ctx.getRequesterId(),
      },
      err,
      progress.bytesStreamed,
    );
    throw err;
  }
}

/**
 * Matchers for the cookie- and signed-token-authenticated file view
 * routes. Used by {@link fileViewErrorLogger} to recognise a failing
 * request whose route handler has not run yet (e.g. authentication
 * rejected by `requireAuth` before the route's `withFileViewLogging`
 * had a chance to mark the request).
 *
 * `path` here is relative to the `/api` mount point, matching what
 * Express puts on `req.path` inside the API router.
 */
const FILE_VIEW_ROUTE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  route: string;
}> = [
  {
    pattern: /^\/files\/([^/]+)\/view$/,
    route: "/api/files/:id/view",
  },
  {
    pattern: /^\/files\/([^/]+)\/view-signed$/,
    route: "/api/files/:id/view-signed",
  },
  {
    pattern: /^\/folders\/[^/]+\/files\/([^/]+)\/view$/,
    route: "/api/folders/:folderId/files/:fileId/view",
  },
  {
    pattern: /^\/resources\/folders\/[^/]+\/files\/([^/]+)\/view$/,
    route: "/api/resources/folders/:folderId/files/:fileId/view",
  },
];

function matchFileViewRoute(
  method: string,
  path: string,
): { route: string; fileId: string } | null {
  if (method !== "GET") return null;
  for (const { pattern, route } of FILE_VIEW_ROUTE_PATTERNS) {
    const m = pattern.exec(path);
    if (m) {
      return { route, fileId: m[1] };
    }
  }
  return null;
}

/**
 * Express error-handling middleware that emits `view.fail` for
 * file-view requests that fail BEFORE their route handler runs — the
 * common case being `requireAuth` rejecting an unauthenticated cookie
 * session, which is exactly the "user can't open the file" report this
 * task is meant to make debuggable.
 *
 * Mount this AFTER all routes on the API router so it sees errors from
 * both pre-route middleware (auth) and the routes themselves; the
 * {@link FILE_VIEW_LOGGED} marker prevents double-logging when the
 * route handler already produced a `view.fail`.
 */
export const fileViewErrorLogger: ErrorRequestHandler = (
  err,
  req,
  _res,
  next,
) => {
  if (!isFileViewLogged(req)) {
    const matched = matchFileViewRoute(req.method, req.path);
    if (matched) {
      const requesterId = req.auth?.userId ?? null;
      logFileViewFailure(
        {
          route: matched.route,
          fileId: matched.fileId,
          requesterId,
        },
        err,
        0,
      );
      markFileViewLogged(req);
    }
  }
  next(err);
};
