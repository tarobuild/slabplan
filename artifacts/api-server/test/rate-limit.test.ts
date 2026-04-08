import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { createRateLimit } from "../src/lib/rate-limit.ts";
import { HttpError } from "../src/lib/http.ts";

function createRequest(ip: string): Request {
  return {
    ip,
    body: {},
  } as Request;
}

function createResponse() {
  const headers = new Map<string, string>();

  return {
    response: {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
    } as Response,
    headers,
  };
}

test("createRateLimit blocks requests after the configured threshold", () => {
  const middleware = createRateLimit({
    keyPrefix: "test:login",
    max: 2,
    windowMs: 60_000,
    message: "Too many attempts.",
    resolveKey: (req) => req.ip || null,
  });

  const request = createRequest("127.0.0.1");
  const { response, headers } = createResponse();
  const forwardedErrors: unknown[] = [];

  middleware(request, response, (error) => {
    forwardedErrors.push(error);
  });
  middleware(request, response, (error) => {
    forwardedErrors.push(error);
  });
  middleware(request, response, (error) => {
    forwardedErrors.push(error);
  });

  assert.deepEqual(forwardedErrors.slice(0, 2), [undefined, undefined]);
  assert.ok(forwardedErrors[2] instanceof HttpError);
  assert.equal((forwardedErrors[2] as HttpError).statusCode, 429);
  assert.equal(headers.get("Retry-After"), "60");
});
