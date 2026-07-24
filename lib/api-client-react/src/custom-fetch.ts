import {
  DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES,
  DIRECT_UPLOAD_EDGE_LIMIT_BYTES,
  formatUploadSize,
} from "@workspace/api-zod";

export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;
export type AuthRefreshHandler = () => Promise<string | null>;
export type AuthFailureHandler = () => void;
export type ForbiddenHandler = (context: {
  method: string;
  url: string;
}) => void;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _authRefreshHandler: AuthRefreshHandler | null = null;
let _authFailureHandler: AuthFailureHandler | null = null;
let _forbiddenHandler: ForbiddenHandler | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Register a session refresh handler used after a generated-client request
 * receives a 401. When the handler returns a token, customFetch retries the
 * original request once with that token before surfacing the error.
 */
export function setAuthRefreshHandler(handler: AuthRefreshHandler | null): void {
  _authRefreshHandler = handler;
}

/**
 * Register a handler called when generated-client auth refresh cannot recover
 * from a 401.
 */
export function setAuthFailureHandler(handler: AuthFailureHandler | null): void {
  _authFailureHandler = handler;
}

/**
 * Register a handler called for generated-client 403 responses.
 */
export function setForbiddenHandler(handler: ForbiddenHandler | null): void {
  _forbiddenHandler = handler;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(
  input: RequestInfo | URL,
  explicitMethod?: string,
): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  const value = resolveUrl(input);
  const base =
    _baseUrl ??
    (typeof globalThis.location !== "undefined"
      ? globalThis.location.origin
      : undefined);

  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

function isAuthEndpoint(input: RequestInfo | URL): boolean {
  const rawUrl = resolveUrl(input);
  if (rawUrl.startsWith("/")) {
    return rawUrl.includes("/auth/");
  }

  const requestUrl = resolveRequestUrl(input);
  return requestUrl ? requestUrl.pathname.includes("/auth/") : false;
}

function shouldAttachAuthHeader(input: RequestInfo | URL): boolean {
  const rawUrl = resolveUrl(input);
  const isAbsolute = /^[a-z][a-z\d+\-.]*:/i.test(rawUrl);

  if (!_baseUrl && typeof globalThis.location === "undefined" && !isAbsolute) {
    return true;
  }

  const requestUrl = resolveRequestUrl(input);

  if (!requestUrl) {
    return false;
  }

  if (_baseUrl) {
    return requestUrl.origin === new URL(_baseUrl).origin;
  }

  if (typeof globalThis.location !== "undefined") {
    return requestUrl.origin === globalThis.location.origin;
  }

  return !isAbsolute;
}

function shouldManageAuthForRequest(input: RequestInfo | URL): boolean {
  return shouldAttachAuthHeader(input) && !isAuthEndpoint(input);
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

/** @public Used by generated request functions that Knip intentionally excludes. */
export function mergeRequestHeaders(
  ...sources: Array<HeadersInit | undefined>
): Headers {
  return mergeHeaders(...sources);
}

export function jsonContentTypeHeaders(headersInit?: HeadersInit): Headers {
  const headers = mergeHeaders(headersInit);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return (
    mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"))
  );
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
    (mediaType.startsWith("text/") ||
      mediaType === "application/xml" ||
      mediaType === "text/xml" ||
      mediaType.endsWith("+xml") ||
      mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(
  response: Response,
  method: string,
): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function"
      ? response.blob()
      : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            'Use responseType "json" or "text" instead.',
        );
      }
      return response.blob();
  }
}

function notifyForbiddenResponse(
  response: Response,
  requestInfo: { method: string; url: string },
  shouldManageAuth: boolean,
) {
  if (response.status !== 403 || !shouldManageAuth) {
    return;
  }

  _forbiddenHandler?.(requestInfo);
}

function isFormDataBody(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function formDataFileSize(value: FormDataEntryValue): number | null {
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return value.size;
  }
  if (typeof value === "object" && value !== null && "size" in value) {
    const size = (value as { size?: unknown }).size;
    return typeof size === "number" && Number.isSafeInteger(size) && size >= 0
      ? size
      : null;
  }
  return null;
}

function resolveLeadAttachmentDirectUploadLeadId(input: RequestInfo | URL): string | null {
  const rawUrl = resolveUrl(input);
  const rawPath = rawUrl.startsWith("/") ? rawUrl.split("?", 1)[0] : null;
  const pathname = rawPath ?? resolveRequestUrl(input)?.pathname ?? null;
  const match = pathname?.match(/^\/api\/leads\/([^/]+)\/attachments\/?$/i);
  return match?.[1] ?? null;
}

function throwOversizedLeadAttachmentDirectUpload(
  leadId: string,
  filesBytes: number,
  requestInfo: { method: string; url: string },
): never {
  const uploadPolicyEndpoint = `/api/leads/${leadId}/attachments/upload-policy`;
  const chunkedStartEndpoint = `/api/leads/${leadId}/attachments/chunked`;
  const data = {
    type: "https://slabplan.com/errors/payload-too-large",
    title: "Payload Too Large",
    status: 413,
    detail:
      `Direct lead attachment multipart uploads are limited to ${formatUploadSize(DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES)} ` +
      `to stay below the production edge cap. Use chunked upload for this file.`,
    errors: {
      code: "LEAD_ATTACHMENT_USE_CHUNKED_UPLOAD",
      contentLengthEstimate: filesBytes,
      edgeRequestLimitBytes: DIRECT_UPLOAD_EDGE_LIMIT_BYTES,
      maxRecommendedBytes: DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES,
      multipartFieldName: "files",
      uploadPolicyEndpoint,
      chunkedStartEndpoint,
      chunkedUploadSupported: true,
    },
  };
  const response = new Response(JSON.stringify(data), {
    status: 413,
    statusText: "Payload Too Large",
    headers: { "content-type": "application/problem+json" },
  });
  throw new ApiError(response, data, requestInfo);
}

function guardLeadAttachmentDirectUpload(
  input: RequestInfo | URL,
  method: string,
  body: BodyInit | null | undefined,
  requestInfo: { method: string; url: string },
) {
  if (method !== "POST" || !isFormDataBody(body)) {
    return;
  }

  const leadId = resolveLeadAttachmentDirectUploadLeadId(input);
  if (!leadId) {
    return;
  }

  let filesBytes = 0;
  for (const entry of body.getAll("files")) {
    const size = formDataFileSize(entry);
    if (size != null) filesBytes += size;
  }

  if (filesBytes > DIRECT_UPLOAD_CHUNKING_THRESHOLD_BYTES) {
    throwOversizedLeadAttachmentDirectUpload(leadId, filesBytes, requestInfo);
  }
}

async function throwApiError(
  response: Response,
  requestInfo: { method: string; url: string },
  shouldManageAuth: boolean,
): Promise<never> {
  notifyForbiddenResponse(response, requestInfo, shouldManageAuth);
  const errorData = await parseErrorBody(response, requestInfo.method);
  throw new ApiError(response, errorData, requestInfo);
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(
    isRequest(input) ? input.headers : undefined,
    headersInit,
  );
  const shouldManageAuth = shouldManageAuthForRequest(input);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // CSRF protection: state-changing requests must declare themselves as
  // XHR so the API server's CSRF middleware lets them through. Browsers
  // forbid scripts from setting this header on cross-site simple requests,
  // so its presence proves the call originated from same-origin JS.
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    !headers.has("x-requested-with")
  ) {
    headers.set("x-requested-with", "XMLHttpRequest");
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  const usesManagedAuthorization =
    Boolean(_authTokenGetter) &&
    !headers.has("authorization") &&
    shouldManageAuth;

  if (usesManagedAuthorization && _authTokenGetter) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };
  guardLeadAttachmentDirectUpload(input, method, init.body, requestInfo);

  let response = await fetch(input, { ...init, method, headers });

  if (
    response.status === 401 &&
    _authRefreshHandler &&
    shouldManageAuth
  ) {
    const refreshedToken = await _authRefreshHandler();

    let authFailureNotified = false;

    if (refreshedToken) {
      const retryHeaders = new Headers(headers);
      retryHeaders.set("authorization", `Bearer ${refreshedToken}`);
      response = await fetch(input, { ...init, method, headers: retryHeaders });
    } else {
      _authFailureHandler?.();
      authFailureNotified = true;
    }

    if (response.status === 401 && !authFailureNotified) {
      _authFailureHandler?.();
    }
  }

  if (!response.ok) {
    await throwApiError(response, requestInfo, shouldManageAuth);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
