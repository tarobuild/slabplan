import path from "node:path";

/**
 * Safe file-serving headers.
 *
 * The read path for uploaded files is a real XSS vector if we just echo
 * back whatever Content-Type the uploader claimed: a polyglot HTML/JPEG
 * served as `image/jpeg` with `Content-Disposition: inline` will run
 * scripts in the viewer's session because some browsers still sniff
 * inline responses, and the file's actual bytes can be HTML.
 *
 * This module centralises three defences that *every* file-serving
 * route in the API must apply:
 *
 *   1. The served `Content-Type` is derived from the file's extension
 *      against an allowlist (the same allowlist the upload validator
 *      enforces). Anything outside that list serves as
 *      `application/octet-stream`. The client-claimed MIME is never
 *      echoed back to other users.
 *
 *   2. `Content-Disposition: inline` is only honoured for a small set
 *      of known-safe inline types (images, video, PDF). Everything
 *      else is forced to `attachment` so the browser downloads the
 *      file instead of trying to render it (which is what would let
 *      a renamed `.html` payload run scripts).
 *
 *   3. `X-Content-Type-Options: nosniff` and a tight
 *      `Content-Security-Policy` are set on every file response so
 *      that even if a browser ignores the disposition, it will not
 *      execute scripts loaded from the response.
 *
 * SVG is intentionally absent from the allowlist: SVG is XML and can
 * carry inline `<script>`, so it is rejected at upload time (no
 * `.svg` in `photoExtensions`/`documentExtensions`) and would serve
 * here as `application/octet-stream` + `attachment` even if it ever
 * slipped through.
 */

const EXTENSION_TO_SAFE_CONTENT_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
};

const SAFE_INLINE_CONTENT_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/**
 * Tight CSP applied to every file response. `default-src 'none'`
 * blocks scripts, frames, fetches, and workers entirely; `img-src`
 * and `media-src 'self'` keep legitimate inline image/video previews
 * working when the browser renders the response in an `<img>` or
 * `<video>` element. `style-src 'unsafe-inline'` is intentionally
 * NOT included — there is no scenario where served upload bytes need
 * to ship CSS.
 */
export const FILE_RESPONSE_CSP =
  "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'none'; script-src 'none'; frame-ancestors 'none'; sandbox";

export function getServedContentType(originalName: string): string {
  const ext = path.extname(originalName ?? "").toLowerCase();
  return EXTENSION_TO_SAFE_CONTENT_TYPE[ext] ?? "application/octet-stream";
}

export function isSafeInlineContentType(contentType: string): boolean {
  // The allowlist keys are bare types (no parameters); strip any
  // `; charset=...` suffix the served type might carry before
  // checking. The current allowlist has no parameterised entries
  // but this keeps the check robust if one is added later.
  const bare = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return SAFE_INLINE_CONTENT_TYPES.has(bare);
}

export interface ResolvedFileServingHeaders {
  /** Content-Type derived from the file's extension (allowlisted). */
  contentType: string;
  /** Effective disposition. May downgrade `inline` to `attachment`
   *  when the served content-type is not on the safe-inline list. */
  disposition: "inline" | "attachment";
  /** Pre-formatted Content-Disposition header value (RFC 6266). */
  contentDispositionHeader: string;
}

export interface ResolveFileServingHeadersOptions {
  originalName: string;
  requestedDisposition: "inline" | "attachment";
}

export function resolveSafeFileServingHeaders(
  options: ResolveFileServingHeadersOptions,
): ResolvedFileServingHeaders {
  const contentType = getServedContentType(options.originalName);
  const disposition: "inline" | "attachment" =
    options.requestedDisposition === "inline" &&
    isSafeInlineContentType(contentType)
      ? "inline"
      : "attachment";

  const filename = options.originalName || "file";
  // RFC 6266: filename uses the legacy quoted form (with double-quotes
  // and backslashes stripped so they cannot terminate the header
  // early), and filename* uses RFC 5987 percent-encoding so non-ASCII
  // filenames survive intact.
  const safeFilename = filename.replace(/["\\]/g, "");
  const encoded = encodeURIComponent(filename);
  const contentDispositionHeader = `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encoded}`;

  return { contentType, disposition, contentDispositionHeader };
}
