import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";

import { decodeCursor, encodeCursor, isCursorModeRequested, parseCursorParams } from "../src/lib/cursor.ts";
import {
  PAT_PREFIX,
  generateRawToken,
  hashToken,
  isPatToken,
} from "../src/lib/personal-access-tokens.ts";
import { HttpError } from "../src/lib/http.ts";
import { buildProblem, PROBLEM_TYPE_BASE } from "../src/lib/problem-json.ts";

test("encodeCursor / decodeCursor round-trip preserves the payload", () => {
  const payload = {
    v: 1 as const,
    k: ["2025-04-30T10:00:00.000Z", 42, null] as Array<string | number | null>,
    id: "f3d4-77ab",
  };
  const encoded = encodeCursor(payload);
  // Cursor must be opaque + URL-safe.
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);

  const decoded = decodeCursor(encoded);
  assert.deepEqual(decoded, payload);
});

test("decodeCursor rejects garbage and wrong-version envelopes with 400", () => {
  assert.throws(
    () => decodeCursor("!!!not-base64!!!"),
    (err) => err instanceof HttpError && err.statusCode === 400,
  );

  const wrongVersion = Buffer.from(JSON.stringify({ v: 2, k: [], id: "x" }), "utf8").toString(
    "base64url",
  );
  assert.throws(
    () => decodeCursor(wrongVersion),
    (err) => err instanceof HttpError && err.statusCode === 400,
  );

  const missingId = Buffer.from(JSON.stringify({ v: 1, k: ["2025"] }), "utf8").toString(
    "base64url",
  );
  assert.throws(
    () => decodeCursor(missingId),
    (err) => err instanceof HttpError && err.statusCode === 400,
  );
});

test("parseCursorParams treats absent cursor as page-mode and clamps limit", () => {
  const result = parseCursorParams({});
  assert.equal(result.isCursorMode, false);
  assert.equal(result.cursor, null);
  assert.equal(result.limit, 25);

  const tooBig = parseCursorParams({ limit: "9999" });
  assert.equal(tooBig.limit, 100);

  assert.throws(
    () => parseCursorParams({ limit: "-2" }),
    (err) => err instanceof HttpError && err.statusCode === 400,
  );
  assert.throws(
    () => parseCursorParams({ limit: "abc" }),
    (err) => err instanceof HttpError && err.statusCode === 400,
  );
});

test("parseCursorParams flips into cursor-mode when a cursor is provided", () => {
  const cursor = encodeCursor({ v: 1, k: ["2025-04-30T10:00:00.000Z"], id: "abc" });
  const result = parseCursorParams({ cursor, limit: "10" });
  assert.equal(result.isCursorMode, true);
  assert.equal(result.limit, 10);
  assert.deepEqual(result.cursor, {
    v: 1,
    k: ["2025-04-30T10:00:00.000Z"],
    id: "abc",
  });
});

test("isCursorModeRequested gives agents two ways to bootstrap the first cursor page", () => {
  // Explicit empty cursor: ?cursor=&limit=25 → first cursor page.
  assert.equal(isCursorModeRequested({ cursor: "", limit: "25" }), true);
  // Limit-only: ?limit=25 with no page/pageSize/cursor → first cursor page.
  assert.equal(isCursorModeRequested({ limit: "25" }), true);
  // Cursor with token: ?cursor=<token> → cursor mode.
  assert.equal(isCursorModeRequested({ cursor: "abc" }), true);
  // Page-mode wins when explicit page params are present, even with a limit.
  assert.equal(isCursorModeRequested({ page: "1", pageSize: "20" }), false);
  assert.equal(isCursorModeRequested({ page: "1", limit: "20" }), false);
  // Empty query stays in page mode (default).
  assert.equal(isCursorModeRequested({}), false);
});

test("parseCursorParams supports first-page bootstrap (cursor key with empty value)", () => {
  // The agent sends `?cursor=&limit=25` to ask for the first page in cursor
  // format, then echoes the returned `nextCursor` for subsequent calls.
  const result = parseCursorParams({ cursor: "", limit: "25" });
  assert.equal(result.isCursorMode, true, "empty cursor still opts into cursor mode");
  assert.equal(result.cursor, null, "first page has no cursor payload");
  assert.equal(result.limit, 25);
});

test("parseCursorParams treats limit-only requests as cursor-mode bootstrap", () => {
  // No cursor, no page, no pageSize — but a limit. Treat as cursor mode so
  // limit-only callers also get nextCursor without needing to read the spec.
  const result = parseCursorParams({ limit: "10" });
  assert.equal(result.isCursorMode, true);
  assert.equal(result.cursor, null);
  assert.equal(result.limit, 10);
});

test("generateRawToken produces a stable cs_pat_ shape with deterministic SHA-256 hash", () => {
  const a = generateRawToken();
  const b = generateRawToken();

  assert.ok(a.secret.startsWith(PAT_PREFIX), "secret must use cs_pat_ prefix");
  assert.equal(a.prefix, a.secret.slice(0, 11), "prefix is the first 11 chars of the secret");
  assert.equal(a.lastFour, a.secret.slice(-4), "lastFour echoes the last four chars");
  assert.equal(a.tokenHash.length, 64, "token hash is 64 hex chars (sha256)");
  assert.equal(a.tokenHash, hashToken(a.secret), "tokenHash matches hashToken(secret)");

  // Two calls must not collide.
  assert.notEqual(a.secret, b.secret);
  assert.notEqual(a.tokenHash, b.tokenHash);
});

test("isPatToken only recognizes the cs_pat_ prefix", () => {
  assert.equal(isPatToken("cs_pat_abc.def"), true);
  assert.equal(isPatToken("eyJhbGciOiJIUzI1NiJ9.payload.sig"), false, "JWTs are not PATs");
  assert.equal(isPatToken(""), false);
});

test("buildProblem emits an RFC 7807 envelope with type/title/status/detail/instance", () => {
  const err = new HttpError(404, "Job not found", { jobId: "abc" }, "not-found");
  const req = { originalUrl: "/api/jobs/abc" } as unknown as Parameters<typeof buildProblem>[1];

  const body = buildProblem(err, req);

  assert.equal(body.type, `${PROBLEM_TYPE_BASE}/not-found`);
  assert.equal(body.title, "Not Found");
  assert.equal(body.status, 404);
  assert.equal(body.detail, "Job not found");
  assert.equal(body.instance, "/api/jobs/abc");
  // Legacy mirror of detail.
  assert.equal(body.message, "Job not found");
  assert.deepEqual(body.errors, { jobId: "abc" });
});

test("buildProblem falls back to a default type slug when none is provided", () => {
  const err = new HttpError(429, "Too many requests");
  const req = { originalUrl: "/api/jobs" } as unknown as Parameters<typeof buildProblem>[1];

  const body = buildProblem(err, req);
  assert.equal(body.type, `${PROBLEM_TYPE_BASE}/rate-limited`);
  assert.equal(body.title, "Too Many Requests");
  assert.equal(body.errors, undefined);
});

test("openapi.yaml is valid YAML and parses to an OpenAPI 3 document", async () => {
  // Regression for the bug where /openapi.json did `JSON.parse` on a YAML
  // file, returning 500 to unauthenticated AI clients trying to discover
  // the API.
  const candidates = [
    path.resolve(process.cwd(), "../../lib/api-spec/openapi.yaml"),
    path.resolve(process.cwd(), "lib/api-spec/openapi.yaml"),
  ];

  let raw: string | null = null;
  for (const candidate of candidates) {
    try {
      raw = await fs.readFile(candidate, "utf8");
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  assert.ok(raw, "openapi.yaml not found");

  // JSON.parse must fail (proves it really is YAML, not JSON).
  assert.throws(() => JSON.parse(raw!), /Unexpected token|JSON/);

  // YAML.parse must succeed and yield an OpenAPI 3 document.
  const doc = YAML.parse(raw!);
  assert.equal(typeof doc, "object");
  assert.match(String((doc as { openapi?: unknown }).openapi ?? ""), /^3\./);
  assert.equal(typeof (doc as { paths?: unknown }).paths, "object");
});

test("ai-plugin manifest exposes auth_info_url + mcp_server_url placeholders", async () => {
  // Static check on the public-spec route: verify the manifest payload
  // includes the discovery fields AI clients look for (auth-info URL +
  // placeholder MCP server URL). We import the source and inspect the
  // template literals rather than booting an HTTP server.
  const specSrc = await fs.readFile(
    path.resolve(import.meta.dirname, "../src/routes/public-spec.ts"),
    "utf8",
  );
  assert.match(specSrc, /auth_info_url:/);
  assert.match(specSrc, /mcp_server_url:/);
});

test("listFilesForFolder cursor key matches the cursor filter column (updatedAt)", async () => {
  // Regression: an earlier rev filtered on updatedAt but encoded the next
  // cursor using createdAt, so any file with createdAt !== updatedAt could
  // skip or duplicate rows across pages.
  const src = await fs.readFile(
    path.resolve(import.meta.dirname, "../src/lib/file-manager.ts"),
    "utf8",
  );

  const block = src.match(/if \(isCursorMode\) \{[\s\S]*?const fetched = await rowsPromise[\s\S]*?return \{[\s\S]*?\};\s*\}/);
  assert.ok(block, "Could not locate the cursor-mode block in file-manager.ts");

  // Filter must use updatedAt.
  assert.match(block![0], /files\.updatedAt/);
  // Cursor next-key encode must also use updatedAt (the bug emitted createdAt).
  assert.match(block![0], /last\.updatedAt\.toISOString\(\)/);
  assert.doesNotMatch(block![0], /last\.createdAt/);
});

test("idempotency middleware is mounted after requireAuth so it always has a userId", async () => {
  // Regression: an earlier rev mounted idempotencyMiddleware BEFORE
  // requireAuth, which silently no-ops on every protected write because
  // req.auth.userId is not yet attached. The contract "POST + same
  // Idempotency-Key replays" only works when the middleware sits below
  // the auth gate.
  const src = await fs.readFile(
    path.resolve(import.meta.dirname, "../src/routes/index.ts"),
    "utf8",
  );
  const requireAuthAt = src.indexOf("router.use(requireAuth)");
  const idempotencyAt = src.indexOf("router.use(idempotencyMiddleware()");
  assert.ok(requireAuthAt > 0, "requireAuth mount not found");
  assert.ok(idempotencyAt > 0, "idempotency mount not found");
  assert.ok(
    idempotencyAt > requireAuthAt,
    "idempotencyMiddleware must be mounted AFTER requireAuth",
  );
});

test("idempotency middleware persists final responses regardless of status code", async () => {
  // Regression: an earlier rev only persisted 2xx responses, so a
  // POST that returned 422 (validation) would release its reservation
  // and let a retry re-execute the failing handler instead of replaying
  // the same 422 body. The contract is "same key → same response".
  const src = await fs.readFile(
    path.resolve(import.meta.dirname, "../src/middleware/idempotency.ts"),
    "utf8",
  );
  // The settle() branch that writes to DB must NOT gate on a 2xx range.
  assert.doesNotMatch(
    src,
    /res\.statusCode\s*>=\s*200[\s\S]{0,80}res\.statusCode\s*<\s*300/,
  );
  // It must persist whenever the response actually finished with a status.
  assert.match(src, /finished\s*&&\s*res\.statusCode\s*>\s*0/);
});

test("openapi.yaml documents the exact query parameter sets for cursor list endpoints", async () => {
  // Regression: an earlier rev blanket-added page/pageSize/search/status to
  // every list with a cursor, producing drift on /activity (uses limit not
  // pageSize) and /folders/{id}/files (mistyped path key in the patch
  // script). This guards the spec against re-divergence from the routes.
  const YAML = (await import("yaml")).default;
  const specRaw = await fs.readFile(
    path.resolve(import.meta.dirname, "../../../lib/api-spec/openapi.yaml"),
    "utf8",
  );
  const spec = YAML.parse(specRaw);

  const expected = {
    "/activity": ["jobId", "mediaType", "folderId", "entityType", "entityId", "page", "limit", "cursor"],
    "/jobs": ["page", "pageSize", "search", "status", "cursor", "limit"],
    "/leads": ["page", "pageSize", "search", "status", "cursor", "limit"],
    "/folders/{id}/files": ["id", "page", "limit", "sortBy", "includeDeleted", "cursor"],
    "/jobs/{jobId}/schedule": ["jobId", "page", "limit", "cursor"],
    "/daily-logs/mine": ["page", "pageSize", "keywords", "limit", "cursor"],
    "/jobs/{jobId}/daily-logs": [
      "jobId",
      "page",
      "pageSize",
      "keywords",
      "createdBy",
      "from",
      "to",
      "tag",
      "tags",
      "sharedWith",
      "limit",
      "cursor",
    ],
    "/search": ["q", "page", "pageSize", "limit", "cursor"],
  };

  for (const [pathKey, wantNames] of Object.entries(expected)) {
    const op = spec.paths?.[pathKey]?.get;
    assert.ok(op, `Missing GET ${pathKey} in openapi.yaml`);
    const params = (op.parameters ?? []).map((p) => {
      if (p?.$ref) {
        const slug = String(p.$ref).split("/").pop();
        if (slug === "CursorParam") return "cursor";
        if (slug === "CursorLimitParam") return "limit";
        return slug;
      }
      return p?.name;
    });
    for (const name of wantNames) {
      assert.ok(
        params.includes(name),
        `GET ${pathKey} missing query parameter '${name}'. Got: ${JSON.stringify(params)}`,
      );
    }
  }
});

test("/search cursor is fully self-contained: follow-up requests echo just `cursor`", async () => {
  // Regression: a `?q=x&limit=25` first request followed by just
  // `?cursor=<token>` must continue at offset 25 with q="x" — not fall
  // back to schema defaults and not 400 on a missing q. Cursor envelope
  // must embed (page, limit, q); `q` must be optional on the wire.
  const src = await fs.readFile(
    path.resolve(import.meta.dirname, "../src/routes/search.ts"),
    "utf8",
  );
  const specRaw = await fs.readFile(
    path.resolve(import.meta.dirname, "../../../lib/api-spec/openapi.yaml"),
    "utf8",
  );
  const spec = (await import("yaml")).default.parse(specRaw);

  // OpenAPI `q` must not be required, or generated client types force it.
  const searchOp = spec.paths?.["/search"]?.get;
  assert.ok(searchOp, "GET /search not found in openapi.yaml");
  const qParam = (searchOp.parameters ?? []).find((p) => p?.name === "q");
  assert.ok(qParam, "GET /search must declare a `q` query parameter");
  assert.notEqual(
    qParam.required,
    true,
    "`q` must NOT be `required: true` — cursor follow-ups omit it. Documented as required-on-first-request only.",
  );

  assert.match(
    src,
    /q:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(100\)\.optional\(\)/,
    "/search querySchema must mark `q` optional",
  );
  assert.match(
    src,
    /encodeCursor\(\{[\s\S]{0,200}k:\s*\[page \+ 1,\s*pageSize,\s*effectiveQ\][\s\S]{0,200}id:\s*queryFingerprint/,
    "/search nextCursor must encode `[page + 1, pageSize, effectiveQ]` in `k`",
  );
  assert.match(
    src,
    /const encodedLimit = Number\(cursorPayload\.k\[1\][\s\S]*?\)/,
    "/search must read the encoded limit from cursor.k[1]",
  );
  assert.match(
    src,
    /const encodedQRaw = cursorPayload\.k\[2\]/,
    "/search must read the encoded q from cursor.k[2]",
  );
  assert.match(src, /cursorLimit = encodedLimit;/);
  assert.match(src, /effectiveQ = encodedQ;/);
  assert.match(
    src,
    /query\.data\.limit !== undefined && query\.data\.limit !== encodedLimit/,
    "/search must reject `cursor + limit` mismatch",
  );
  assert.match(
    src,
    /query\.data\.q !== undefined && query\.data\.q !== encodedQ/,
    "/search must reject `cursor + q` mismatch",
  );
  assert.match(
    src,
    /Search requires `q` on the first request, or a `cursor` from a previous response/,
  );

  // Cursor envelope round-trip locks in (page, limit, q) preservation.
  const cursor = encodeCursor({ v: 1, k: [2, 25, "hello"], id: "fp" });
  const decoded = decodeCursor(cursor);
  assert.equal(decoded.k[0], 2);
  assert.equal(decoded.k[1], 25);
  assert.equal(decoded.k[2], "hello");
});

test("daily-logs cursor mode does SQL-side tag filtering and a single bounded read", async () => {
  // Regression: an earlier rev applied tag filtering in memory after a
  // capped batched scan, which could silently truncate sparse matches.
  // Cursor branch must filter tags in SQL and fetch `limit + 1` once.
  const src = await fs.readFile(
    path.resolve(import.meta.dirname, "../src/routes/daily-logs.ts"),
    "utf8",
  );

  const cursorBlockMatch = src.match(
    /if \(isCursorMode\) \{[\s\S]*?const fetched = await fetchDailyLogRows\([\s\S]*?\);[\s\S]*?const hasMore = fetched\.length > cursorLimit;/,
  );
  assert.ok(cursorBlockMatch, "Could not locate the cursor-mode block in daily-logs.ts");
  const cursorBlock = cursorBlockMatch[0];

  assert.match(
    cursorBlock,
    /for \(const tag of requestedTags\) \{[\s\S]*?EXISTS \(SELECT 1 FROM \$\{dailyLogTags\}/,
    "Tag filtering must be SQL-side per-tag EXISTS",
  );
  assert.match(
    cursorBlock,
    /lower\(\$\{dailyLogTags\.tagName\}\) = \$\{tag\}/,
    "Tag EXISTS must use lower() for case-insensitive match",
  );
  assert.match(
    cursorBlock,
    /fetchDailyLogRows\([^,]+,\s*cursorLimit \+ 1\)/,
    "Must fetch cursorLimit + 1 rows",
  );
  assert.doesNotMatch(
    cursorBlock,
    /MAX_ITERATIONS|for \(let iter\b/,
    "No iteration loop — that path can silently truncate sparse matches",
  );
  assert.match(
    cursorBlock,
    /const hasMore = fetched\.length > cursorLimit;/,
    "hasMore must be derived from fetched.length",
  );
});
