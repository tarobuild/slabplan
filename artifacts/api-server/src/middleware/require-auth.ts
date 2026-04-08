import type { NextFunction, Request, Response } from "express";
import { isAdmin, isManagerOrAbove, type AppRole } from "../lib/authorization";
import { HttpError } from "../lib/http";
import { verifyAccessToken } from "../lib/auth";

export function readBearerToken(req: Request) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearerToken(req);

  if (!token) {
    next(new HttpError(401, "Authentication required."));
    return;
  }

  req.auth = verifyAccessToken(token);
  next();
}

export function requireRole(...roles: AppRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes(req.auth.role as AppRole)) {
      next(new HttpError(403, "You do not have permission to perform that action."));
      return;
    }

    next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!isAdmin(req.auth)) {
    next(new HttpError(403, "You do not have permission to perform that action."));
    return;
  }

  next();
}

export function requireManagerOrAbove(req: Request, _res: Response, next: NextFunction) {
  if (!isManagerOrAbove(req.auth)) {
    next(new HttpError(403, "You do not have permission to perform that action."));
    return;
  }

  next();
}
