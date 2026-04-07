import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/http";
import { verifyAccessToken } from "../lib/auth";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    next(new HttpError(401, "Authentication required."));
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    next(new HttpError(401, "Authentication required."));
    return;
  }

  req.auth = verifyAccessToken(token);
  next();
}
