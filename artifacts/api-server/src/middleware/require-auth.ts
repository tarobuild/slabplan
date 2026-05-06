import type { NextFunction, Request, Response } from "express";
import { isAdmin, isManagerOrAbove, type AppRole } from "../lib/authorization";
import { HttpError } from "../lib/http";
import { verifyAccessToken } from "../lib/auth";
import { isPatToken, resolvePersonalAccessToken } from "../lib/personal-access-tokens";
import { assertActiveAuthUser } from "../lib/active-user";

export function readBearerToken(req: Request) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearerToken(req);

  if (!token) {
    next(new HttpError(401, "Authentication required.", undefined, "unauthorized"));
    return;
  }

  if (isPatToken(token)) {
    resolvePersonalAccessToken(token)
      .then((pat) => {
        if (
          pat.patScope === "read" &&
          WRITE_METHODS.has(req.method.toUpperCase()) &&
          !isReadOnlyExempt(req)
        ) {
          throw new HttpError(
            403,
            "This personal access token is read-only.",
            undefined,
            "insufficient-scope",
          );
        }

        req.auth = {
          type: "access",
          userId: pat.userId,
          email: pat.email,
          role: pat.role,
          patId: pat.patId,
          patScope: pat.patScope,
        };
        next();
      })
      .catch((error) => {
        next(error);
      });
    return;
  }

  try {
    const auth = verifyAccessToken(token);
    assertActiveAuthUser(auth)
      .then(() => {
        req.auth = auth;
        next();
      })
      .catch((error) => {
        next(error);
      });
  } catch (error) {
    next(error);
  }
}

// Some POST endpoints are intentionally side-effect-free reads (e.g. token
// introspection in the future). Currently none — kept as an extension point.
function isReadOnlyExempt(_req: Request): boolean {
  return false;
}

function requireRole(...roles: AppRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;

    if (!auth || !roles.includes(auth.role as AppRole)) {
      next(new HttpError(403, "You do not have permission to perform that action.", undefined, "forbidden"));
      return;
    }

    next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const auth = req.auth;

  if (!auth || !isAdmin(auth)) {
    next(new HttpError(403, "You do not have permission to perform that action.", undefined, "forbidden"));
    return;
  }

  next();
}

export function requireManagerOrAbove(req: Request, _res: Response, next: NextFunction) {
  const auth = req.auth;

  if (!auth || !isManagerOrAbove(auth)) {
    next(new HttpError(403, "You do not have permission to perform that action.", undefined, "forbidden"));
    return;
  }

  next();
}
