import { Router, type IRouter, type Request, type Response } from "express";
import { assertCanViewFile, type AuthContext } from "../lib/authorization";
import { assertActiveAuthUser } from "../lib/active-user";
import { attachOrganizationContext } from "../lib/auth-organization";
import { verifyFileViewToken } from "../lib/auth";
import { getFileOrThrow } from "../lib/file-manager";
import { withFileViewLogging } from "../lib/file-view-log";
import { HttpError, asyncHandler } from "../lib/http";
import { streamPreparedStoredFileToResponse } from "../lib/storage";

const router: IRouter = Router();

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

function signedFileErrorCopy(error: unknown): {
  status: number;
  title: string;
  message: string;
} {
  const status = error instanceof HttpError ? error.statusCode : 500;

  if (status === 401) {
    return {
      status,
      title: "File link expired",
      message: "Reopen the file from SlabPlan and try again.",
    };
  }

  if (status === 403) {
    return {
      status,
      title: "File access denied",
      message: "Your account does not currently have access to this file.",
    };
  }

  if (status === 404) {
    return {
      status,
      title: "File unavailable",
      message: "This file is no longer available in storage.",
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    title: "File temporarily unavailable",
    message: "We could not open this file just now. Please refresh and try again.",
  };
}

function sendSignedFileErrorPage(res: Response, error: unknown): void {
  if (res.headersSent) return;

  const { status, title, message } = signedFileErrorCopy(error);
  const requestId = String((res.req as { id?: unknown } | undefined)?.id ?? "")
    .replace(/[^\w.-]/g, "")
    .slice(0, 64);
  const reference = requestId
    ? `\n      <p class="reference">Reference: <code>${requestId}</code></p>`
    : "";
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f8fafc;
        color: #0f172a;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
        line-height: 1.2;
      }
      p {
        margin: 0;
        color: #475569;
        line-height: 1.5;
      }
      .reference {
        margin-top: 0.75rem;
        font-size: 0.875rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>${reference}
    </main>
  </body>
</html>`;

  res.removeHeader("Content-Length");
  res.removeHeader("Content-Disposition");
  res.removeHeader("Content-Security-Policy");
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

async function serveSignedFile(
  req: Request,
  res: Response,
  params: {
    disposition: "inline" | "attachment";
    route: string;
  },
) {
  const fileId = getParam(req.params.id, "file id");
  let requesterId: string | null = null;
  await withFileViewLogging(
    req,
    {
      route: params.route,
      fileId,
      getRequesterId: () => requesterId,
    },
    async (progress) => {
      const tokenRaw = req.query.token;
      const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;

      if (typeof token !== "string" || !token) {
        throw new HttpError(401, "Missing signed token.");
      }

      const verified = verifyFileViewToken(token);
      // Identify the requester as soon as the token's signature
      // verifies, so failures triggered by a token/file mismatch (or
      // by a since-deactivated user) still report who tried.
      requesterId = verified.userId;

      if (verified.fileId !== fileId) {
        throw new HttpError(401, "Token does not match this file.");
      }

      // Signed links are idempotent within their 5-minute TTL: re-fetching the
      // same view URL (React strict-mode double-render, image src
      // re-attachment, fast tab switches) must succeed instead of failing
      // mid-render with "already used". The TTL + per-request authorization
      // re-check below are what enforce safety; the JTI is no longer
      // consumed, only inspected for shape.

      // Confirm the user still exists & is active. If they were deactivated
      // since the token was issued, deny access.
      await assertActiveAuthUser(verified);

      // Re-check access using the same authorization model that `/files/:id/view`
      // uses, so revoked permissions take effect even within the token TTL window.
      const auth: AuthContext = {
        userId: verified.userId,
        email: verified.email,
        role: verified.role,
        type: "access",
        organizationId: verified.organizationId,
        iat: verified.iat,
        authTime: verified.authTime,
      };

      const authWithOrganization = await attachOrganizationContext(auth);
      await assertCanViewFile(authWithOrganization, fileId);

      const file = await getFileOrThrow(fileId);

      if (!file.fileUrl) {
        throw new HttpError(404, "Stored file missing.");
      }

      const displayName = file.originalName ?? file.filename;
      return streamPreparedStoredFileToResponse(
        res,
        file.fileUrl,
        {
          disposition: params.disposition,
          filename: displayName,
          contentType: file.mimeType,
          cacheControl: "private, no-store",
          rangeHeader: req.headers.range ?? null,
        },
        progress,
      );
    },
  );
}

async function serveSignedFileRoute(
  req: Request,
  res: Response,
  params: {
    disposition: "inline" | "attachment";
    route: string;
  },
) {
  try {
    await serveSignedFile(req, res, params);
  } catch (error) {
    if (res.headersSent) {
      throw error;
    }
    sendSignedFileErrorPage(res, error);
  }
}

router.get(
  "/files/:id/view-signed",
  asyncHandler(async (req, res) => {
    await serveSignedFileRoute(req, res, {
      disposition: "inline",
      route: "/api/files/:id/view-signed",
    });
  }),
);

router.get(
  "/files/:id/download-signed",
  asyncHandler(async (req, res) => {
    await serveSignedFileRoute(req, res, {
      disposition: "attachment",
      route: "/api/files/:id/download-signed",
    });
  }),
);

export default router;
