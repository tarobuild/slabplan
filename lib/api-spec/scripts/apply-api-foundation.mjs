#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(__dirname, "../openapi.yaml");

const raw = readFileSync(specPath, "utf8");
const doc = YAML.parse(raw);

const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

// Authoritative query-param sets for cursor-pagination GET endpoints.
// Each entry must mirror the route's actual zod query schema EXACTLY —
// the script REPLACES op.parameters for these paths so stale params from
// older spec revisions are scrubbed out. Path parameters are handled
// separately and preserved.
const QUERY_PARAMS_BY_PATH = {
  "/activity": [
    { name: "jobId", schema: { type: "string", format: "uuid" }, description: "Filter to activity rows for a specific job." },
    { name: "mediaType", schema: { type: "string", enum: ["document", "photo", "video"] }, description: "Filter to a media type." },
    { name: "folderId", schema: { type: "string", format: "uuid" }, description: "Filter to a specific folder." },
    { name: "entityType", schema: { type: "string" }, description: "Filter to a specific entity type. Must be paired with entityId." },
    { name: "entityId", schema: { type: "string", format: "uuid" }, description: "Filter to a specific entity. Must be paired with entityType." },
    { name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied." },
    { name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size. Default 50; max 100." },
    { ref: "#/components/parameters/CursorParam" },
  ],
  "/jobs": [
    { name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied." },
    { name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size for offset pagination. Ignored when `cursor` is supplied." },
    { name: "search", schema: { type: "string" }, description: "Optional free-text filter (job name, address, etc.)." },
    { name: "status", schema: { type: "string" }, description: "Optional status filter." },
    { ref: "#/components/parameters/CursorParam" },
    { ref: "#/components/parameters/CursorLimitParam" },
  ],
  "/leads": [
    { name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied." },
    { name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size for offset pagination. Ignored when `cursor` is supplied." },
    { name: "search", schema: { type: "string" }, description: "Optional free-text filter." },
    { name: "status", schema: { type: "string" }, description: "Optional status filter." },
    { ref: "#/components/parameters/CursorParam" },
    { ref: "#/components/parameters/CursorLimitParam" },
  ],
  "/folders/{id}/files": [
    { name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied." },
    { name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size. Default 100; max 100." },
    { name: "sortBy", schema: { type: "string" }, description: "Sort key (e.g. `modified_newest`, `modified_oldest`, `name_asc`, `name_desc`). Default `modified_newest`." },
    { name: "includeDeleted", schema: { type: "boolean" }, description: "Include soft-deleted files. Default false." },
    { ref: "#/components/parameters/CursorParam" },
  ],
  "/jobs/{jobId}/schedule": [
    { name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied." },
    { name: "limit", schema: { type: "integer", minimum: 1, maximum: 200 }, description: "Page size." },
    { ref: "#/components/parameters/CursorParam" },
  ],
  "/daily-logs/mine": [
    { name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied." },
    { name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size for offset pagination. Ignored when `cursor` is supplied." },
    { name: "keywords", schema: { type: "string" }, description: "Free-text filter across log title, notes, weather notes, and job title." },
    { name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size for cursor pagination. Default 25; max 100." },
    { ref: "#/components/parameters/CursorParam" },
  ],
  "/jobs/{jobId}/daily-logs": [
    { name: "page", schema: { type: "integer", minimum: 1 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied." },
    { name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 500 }, description: "Page size for offset pagination. Ignored when `cursor` is supplied." },
    { name: "keywords", schema: { type: "string" }, description: "Free-text filter across log title, notes, and weather notes." },
    { name: "createdBy", schema: { type: "string", format: "uuid" }, description: "Filter to logs authored by a specific user." },
    { name: "from", schema: { type: "string", format: "date" }, description: "Inclusive lower bound on log date (YYYY-MM-DD)." },
    { name: "to", schema: { type: "string", format: "date" }, description: "Inclusive upper bound on log date (YYYY-MM-DD)." },
    { name: "tag", schema: { type: "string" }, description: "Filter to logs that include this tag (case-insensitive)." },
    { name: "tags", schema: { type: "string" }, description: "Comma-separated tag list; logs must include every tag (case-insensitive)." },
    { name: "sharedWith", schema: { type: "string", enum: ["internal", "subs_vendors", "client", "private", "estimators", "installers"] }, description: "Filter by visibility audience." },
    { name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size for cursor pagination. Default 25; max 100." },
    { ref: "#/components/parameters/CursorParam" },
  ],
  "/search": [
    { name: "q", schema: { type: "string", minLength: 1, maxLength: 100 }, description: "Search query string (1–100 chars). Required on the first request. On follow-up requests that pass `?cursor=<token>` the query is taken from the cursor, so `q` may be omitted; if supplied alongside a cursor it must equal the cursor's embedded query." },
    { name: "page", schema: { type: "integer", minimum: 1, maximum: 20 }, description: "Page number (1-based) for offset pagination. Ignored when `cursor` is supplied. Capped at 20." },
    { name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 25 }, description: "Page size for offset pagination. Ignored when `cursor` is supplied. Max 25." },
    { name: "limit", schema: { type: "integer", minimum: 1, maximum: 25 }, description: "Page size for cursor pagination. Default 10; max 25." },
    { ref: "#/components/parameters/CursorParam" },
  ],
};

function ensureRefList(arr, ref) {
  if (!Array.isArray(arr)) return [{ $ref: ref }];
  if (arr.some((p) => p && p.$ref === ref)) return arr;
  return [...arr, { $ref: ref }];
}

function ensureQueryParam(arr, name, schema, description) {
  if (!Array.isArray(arr)) arr = [];
  const has = arr.some((p) => p && p.in === "query" && p.name === name);
  if (has) return arr;
  return [...arr, { name, in: "query", required: false, description, schema }];
}

function attachRateLimitHeaders(response) {
  if (!response || typeof response !== "object") return;
  const headers = response.headers ?? {};
  headers["X-RateLimit-Limit"] = { $ref: "#/components/headers/X-RateLimit-Limit" };
  headers["X-RateLimit-Remaining"] = { $ref: "#/components/headers/X-RateLimit-Remaining" };
  headers["X-RateLimit-Reset"] = { $ref: "#/components/headers/X-RateLimit-Reset" };
  response.headers = headers;
}

function rewriteErrorContent(response, status) {
  if (!response || typeof response !== "object") return;
  const content = response.content;
  if (!content || typeof content !== "object") return;
  const jsonEntry = content["application/json"];
  if (!jsonEntry) return;
  const schema = jsonEntry.schema;
  const isErrorRef =
    schema &&
    typeof schema === "object" &&
    typeof schema.$ref === "string" &&
    (schema.$ref.endsWith("/Error") || schema.$ref.endsWith("/Problem"));
  if (!isErrorRef) return;

  delete content["application/json"];
  content["application/problem+json"] = {
    schema: { $ref: "#/components/schemas/Problem" },
  };
  response.content = content;

  if (status === "429") {
    const headers = response.headers ?? {};
    headers["Retry-After"] = { $ref: "#/components/headers/Retry-After" };
    response.headers = headers;
  }
}

const paths = doc.paths ?? {};
let touchedOps = 0;

for (const [pathKey, pathItem] of Object.entries(paths)) {
  if (!pathItem || typeof pathItem !== "object") continue;
  for (const [method, op] of Object.entries(pathItem)) {
    if (!op || typeof op !== "object") continue;
    if (!["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) continue;

    const responses = op.responses ?? {};
    for (const [status, resp] of Object.entries(responses)) {
      const code = parseInt(status, 10);
      if (Number.isFinite(code) && code >= 400) {
        rewriteErrorContent(resp, status);
      }
      if (Number.isFinite(code) && code >= 200 && code < 500) {
        attachRateLimitHeaders(resp);
      }
    }

    if (WRITE_METHODS.has(method)) {
      op.parameters = ensureRefList(op.parameters, "#/components/parameters/IdempotencyKey");
    }

    if (method === "get") {
      const queryParams = QUERY_PARAMS_BY_PATH[pathKey];
      if (queryParams) {
        // REPLACE op.parameters wholesale: drop any existing query params
        // (which may be stale from earlier spec revisions) and rebuild from
        // the authoritative map. Path-level params and non-query params
        // are preserved.
        const existing = Array.isArray(op.parameters) ? op.parameters : [];
        const preserved = existing.filter((p) => {
          if (!p || typeof p !== "object") return false;
          if (typeof p.$ref === "string") {
            return !p.$ref.startsWith("#/components/parameters/Cursor");
          }
          return p.in !== "query";
        });
        const built = queryParams.map((pp) => {
          if (pp.ref) return { $ref: pp.ref };
          return {
            name: pp.name,
            in: "query",
            required: pp.required === true,
            description: pp.description,
            schema: pp.schema,
          };
        });
        op.parameters = [...preserved, ...built];
      }
    }

    touchedOps++;
  }
}

const out = YAML.stringify(doc, { lineWidth: 0, indent: 2 });
writeFileSync(specPath, out, "utf8");
console.log(`Touched ${touchedOps} operations.`);
