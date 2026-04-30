import type { NextFunction, Request, RequestHandler, Response } from "express";

export class HttpError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  readonly type?: string;

  constructor(statusCode: number, message: string, details?: unknown, type?: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.details = details;
    this.type = type;
  }
}

export function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
