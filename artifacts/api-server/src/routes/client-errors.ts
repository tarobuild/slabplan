import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { ClientErrorsPostClientErrorBody } from "@workspace/api-zod";
import { asyncHandler, HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { createRateLimit } from "../lib/rate-limit";
import { readBearerToken } from "../middleware/require-auth";
import { verifyAccessToken } from "../lib/auth";
import { isPatToken } from "../lib/personal-access-tokens";

const router: IRouter = Router();

const MAX_STACK_BYTES = 8 * 1024;
const MAX_STRING_LEN = 2_000;

// IP-keyed limiter so a buggy client can't flood the log sink. Anonymous on
// purpose — a render crash may happen before the auth state hydrates, so the
// boundary needs to be able to POST without a Bearer token. Authenticated
// crashes are still scoped under the per-IP bucket, which is fine for an
// observability sink (the per-account /api limiter mounted later in the chain
// would not see this route since it sits before requireAuth).
const clientErrorRateLimit = createRateLimit({
  keyPrefix: "clientError:ip",
  max: Number(process.env.CLIENT_ERROR_PER_IP_MAX ?? 30),
  windowMs: Number(process.env.CLIENT_ERROR_PER_IP_WINDOW_MS ?? 60_000),
  message: "Too many client error reports from this network. Please slow down.",
  resolveKey: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || null;
    return ip ? `ip:${ip}` : null;
  },
});

function truncate(value: string | null | undefined, maxBytes: number): string | null {
  if (typeof value !== "string") return null;
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  // Slice by chars first as a coarse cut, then trim further until the byte
  // length fits — handles multi-byte chars without splitting code points.
  let out = value.slice(0, maxBytes);
  while (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = out.slice(0, -1);
  }
  return `${out}…[truncated]`;
}

function sanitizeUrl(raw: string): string {
  // Strip query strings and fragments — they may contain ids, tokens, or
  // search terms that the user did not intend to ship to the log sink.
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Not a parseable URL — just lop off anything after `?` or `#`.
    return raw.split(/[?#]/, 1)[0];
  }
}

function tryReadUserId(req: Request): string | null {
  // Best-effort: if a valid Bearer token is present, attribute the report.
  // We never reject on bad auth here — the boundary fires anonymously by
  // design.
  const token = readBearerToken(req);
  if (!token || isPatToken(token)) return null;
  try {
    const auth = verifyAccessToken(token);
    return auth?.userId ?? null;
  } catch {
    return null;
  }
}

router.post(
  "/_client-error",
  clientErrorRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = ClientErrorsPostClientErrorBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(
        400,
        "Invalid client error payload.",
        parsed.error.flatten(),
        "validation",
      );
    }

    const { message, stack, componentStack, url, userAgent, releaseSha } =
      parsed.data;

    const userId = tryReadUserId(req);
    const sanitized = {
      errorCode: "CLIENT_RENDER_CRASH" as const,
      userId,
      message: truncate(message, MAX_STRING_LEN),
      stack: truncate(stack, MAX_STACK_BYTES),
      componentStack: truncate(componentStack, MAX_STACK_BYTES),
      url: sanitizeUrl(url),
      userAgent: truncate(userAgent, MAX_STRING_LEN),
      releaseSha: truncate(releaseSha, 64),
      ip: req.ip ?? null,
    };

    logger.warn(sanitized, "client render crash reported");

    res.status(204).end();
  }),
);

// Re-export the schema in case other modules want to validate the same shape.
export const clientErrorPayloadSchema: z.ZodTypeAny =
  ClientErrorsPostClientErrorBody;

export default router;
