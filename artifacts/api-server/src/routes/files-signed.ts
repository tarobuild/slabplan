import { Router, type IRouter } from "express";
import { assertCanViewFile, type AuthContext } from "../lib/authorization";
import { assertActiveUserById } from "../lib/active-user";
import { verifyFileViewToken } from "../lib/auth";
import { getFileOrThrow } from "../lib/file-manager";
import { HttpError, asyncHandler } from "../lib/http";
import { streamStoredFileToResponse } from "../lib/storage";

const router: IRouter = Router();

function getParam(value: string | string[] | undefined, label: string) {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) {
    throw new HttpError(400, `Missing ${label}.`);
  }

  return normalized;
}

router.get(
  "/files/:id/view-signed",
  asyncHandler(async (req, res) => {
    const fileId = getParam(req.params.id, "file id");
    const tokenRaw = req.query.token;
    const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;

    if (typeof token !== "string" || !token) {
      throw new HttpError(401, "Missing signed token.");
    }

    const verified = verifyFileViewToken(token);

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
    await assertActiveUserById(verified.userId);

    // Re-check access using the same authorization model that `/files/:id/view`
    // uses, so revoked permissions take effect even within the token TTL window.
    const auth: AuthContext = {
      userId: verified.userId,
      email: verified.email,
      role: verified.role,
      type: "access",
    };

    await assertCanViewFile(auth, fileId);

    const file = await getFileOrThrow(fileId);

    if (!file.fileUrl) {
      throw new HttpError(404, "Stored file missing.");
    }

    const displayName = file.originalName ?? file.filename;
    await streamStoredFileToResponse(res, file.fileUrl, {
      disposition: "inline",
      filename: displayName,
      contentType: file.mimeType,
    });
  }),
);

export default router;
