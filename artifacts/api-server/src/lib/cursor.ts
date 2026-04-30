import { HttpError } from "./http";

/**
 * Opaque cursor encoding for stable cursor-based pagination.
 *
 * Cursors are an opaque, base64url-encoded JSON envelope containing the values
 * of the sort key for the *last* row of the previous page. The server then
 * filters `(sort_key, id) > (cursorSortKey, cursorId)` (or `<` for descending)
 * to fetch the next page.
 *
 * Stability: every cursor payload includes the `id` of the last row as a
 * tie-breaker so duplicate sort values cannot drop or duplicate rows across
 * pages.
 *
 * Versioning: the envelope carries a `v` field so we can change the encoding
 * later without misinterpreting old cursors.
 */
export type CursorPayload = {
  v: 1;
  /**
   * The serialized values of the leading sort columns for the row that ended
   * the previous page. Always followed implicitly by the row's `id` as the
   * tie-breaker.
   */
  k: Array<string | number | null>;
  /** Last row id — universal tie-breaker. */
  id: string;
};

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): CursorPayload {
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw new HttpError(400, "Invalid cursor.", undefined, "validation");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new HttpError(400, "Invalid cursor.", undefined, "validation");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new HttpError(400, "Invalid cursor.", undefined, "validation");
  }

  const candidate = parsed as { v?: unknown; k?: unknown; id?: unknown };
  if (candidate.v !== 1 || !Array.isArray(candidate.k) || typeof candidate.id !== "string") {
    throw new HttpError(400, "Invalid cursor.", undefined, "validation");
  }

  return {
    v: 1,
    k: candidate.k.map((entry) => {
      if (entry === null) return null;
      if (typeof entry === "string" || typeof entry === "number") return entry;
      throw new HttpError(400, "Invalid cursor.", undefined, "validation");
    }),
    id: candidate.id,
  };
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Cursor mode is opt-in by the *presence* of the `cursor` query key — even
 * when it has no value. That gives external clients a discoverable path to the
 * first page in cursor format: `GET /things?cursor=&limit=25` returns the
 * initial page along with `pagination.nextCursor`. Subsequent calls echo the
 * cursor back: `GET /things?cursor=<token>`.
 *
 * `?limit=N` alone (no `cursor` key) stays in page mode so callers always
 * receive the visibility-scoped `totalItems`/`totalPages` they need to render
 * counts. Silently flipping limit-only requests into cursor mode used to drop
 * those totals and produced wrong list counts in the UI.
 */
export function isCursorModeRequested(query: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(query, "cursor");
}

export function parseCursorParams(query: Record<string, unknown>): {
  cursor: CursorPayload | null;
  limit: number;
  isCursorMode: boolean;
} {
  const rawCursor = typeof query.cursor === "string" ? query.cursor.trim() : "";
  const rawLimit = query.limit ?? query.pageSize;
  let limit = DEFAULT_LIMIT;

  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== "") {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      throw new HttpError(400, "limit must be a positive integer.", undefined, "validation");
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  const isCursorMode = isCursorModeRequested(query);
  const cursor = rawCursor.length > 0 ? decodeCursor(rawCursor) : null;

  return { cursor, limit, isCursorMode };
}
