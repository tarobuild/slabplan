/**
 * Upload size and count limits shared between the API server and any clients
 * that talk to it. Both the frontend file picker and the backend multer
 * middleware MUST read these values so the two cannot drift out of sync —
 * historically the frontend let users pick a 200 MB file that the server
 * then rejected at 100 MB, surfacing a generic 500 instead of a clean 413.
 *
 * Out of scope here: changing the actual ceiling. If the limit needs to
 * grow, change the value once below.
 */
export const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 100;

/** Maximum number of files allowed in a single multipart request. */
export const MAX_UPLOAD_FILE_COUNT = 20;

/**
 * Human-friendly rendering of a byte limit (e.g. "100 MB", "256 KB",
 * "500 B"). Used in user-facing error messages on both sides of the wire.
 *
 * We deliberately drop to KB / B for sub-MB values so messages stay
 * unambiguous when callers configure smaller per-route limits — rounding
 * everything to MB used to render "0 MB" for those cases.
 */
export function formatUploadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`;
  const MB = 1024 * 1024;
  const KB = 1024;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}
